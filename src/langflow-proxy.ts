import http from 'http';
import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';
import { LangflowClient } from '@datastax/langflow-client';
import { 
    PROXY_BASE_API_PATH,      
    PROXY_CONFIG_ENDPOINT_PREFIX, 
    PROXY_CHAT_MESSAGES_ENDPOINT_PREFIX, 
    PROXY_FLOWS_PATH,
    PROXY_PROFILES_PATH
} from './config/apiPaths';

const LANGFLOW_API_BASE_PATH_V1 = '/api/v1';

export interface LangflowProxyConfig {
    baseConfigPath: string;
    instanceConfigPath: string;
}

export interface ChatbotProfile {
    proxyEndpointId: string; 
    flowId: string;
    enableStream?: boolean;
    useFloating?: boolean;
    floatPosition?: "bottom-right" | "bottom-left" | "top-right" | "top-left";
    widgetTitle?: string;
    userSender?: string;
    botSender?: string;
    errorSender?: string; 
    systemSender?: string;
    messageTemplate?: string;
    mainContainerTemplate?: string;
    inputAreaTemplate?: string;
}

interface BaseConfigFile {
    langflow_connection: {
        endpoint_url: string;
        api_key?: string;
    };
    chatbot_defaults?: Partial<Omit<ChatbotProfile, 'proxyEndpointId' | 'flowId'>>;
}

interface InstanceConfigFile {
    chatbots: Array<Partial<ChatbotProfile> & { proxyEndpointId: string; flowId: string }>;
}

async function parseJsonBody(req: http.IncomingMessage): Promise<any> {
    return new Promise((resolve, reject) => {
        let body = '';
        req.on('data', chunk => {
            body += chunk.toString();
        });
        req.on('end', () => {
            try {
                resolve(JSON.parse(body));
            } catch (e) {
                reject(new Error('Invalid JSON body'));
            }
        });
        req.on('error', reject);
    });
}

export class LangflowProxyService {
    private langflowClient!: LangflowClient;
    private langflowEndpointUrl!: string;
    private langflowApiKey?: string;
    private chatbotConfigurations: Map<string, ChatbotProfile> = new Map();

    constructor(config: LangflowProxyConfig) {
        try {
            const { langflowConnection, chatbotDefaults } = this._loadBaseConfig(config.baseConfigPath);
            
            this.langflowEndpointUrl = langflowConnection.endpoint_url;
            this.langflowApiKey = langflowConnection.api_key || undefined;

            const clientConfig: { baseUrl: string; apiKey?: string } = {
                baseUrl: this.langflowEndpointUrl,
            };
            if (this.langflowApiKey && this.langflowApiKey.trim() !== '') {
                clientConfig.apiKey = this.langflowApiKey;
            }
            
            this.langflowClient = new LangflowClient(clientConfig);
            console.log(`LangflowProxyService: LangflowClient initialized. Configured Endpoint: ${this.langflowEndpointUrl}`);

            const chatbotInstanceProfiles = this._loadInstanceConfig(config.instanceConfigPath);

            this._processChatbotProfiles(chatbotDefaults, chatbotInstanceProfiles);

        } catch (error: any) {
            console.error(`LangflowProxyService: CRITICAL - Failed to initialize due to configuration error: ${error.message}`);
            throw error; 
        }
    }

    private _loadBaseConfig(baseConfigPath: string): {
        langflowConnection: { endpoint_url: string; api_key?: string };
        chatbotDefaults: Partial<Omit<ChatbotProfile, 'proxyEndpointId' | 'flowId'>>;
    } {
        const absolutePath = path.resolve(baseConfigPath);
        console.log(`LangflowProxyService: Loading base configuration from: ${absolutePath}`);
        if (!fs.existsSync(absolutePath)) {
            throw new Error(`Base configuration file (YAML) not found at ${absolutePath}.`);
        }
        const fileContents = fs.readFileSync(absolutePath, 'utf-8');
        const parsedConfig = yaml.load(fileContents) as BaseConfigFile;

        if (!parsedConfig.langflow_connection || !parsedConfig.langflow_connection.endpoint_url) {
            throw new Error(`Base YAML config missing required 'langflow_connection.endpoint_url'. Path: ${absolutePath}`);
        }
        return {
            langflowConnection: parsedConfig.langflow_connection,
            chatbotDefaults: parsedConfig.chatbot_defaults || {},
        };
    }

    private _loadInstanceConfig(instanceConfigPath: string): Array<Partial<ChatbotProfile> & { proxyEndpointId: string; flowId: string }> {
        const absolutePath = path.resolve(instanceConfigPath);
        console.log(`LangflowProxyService: Loading instance-specific chatbot profiles from: ${absolutePath}`);
        if (!fs.existsSync(absolutePath)) {
            throw new Error(`Instance configuration file (YAML) not found at ${absolutePath}.`);
        }
        const fileContents = fs.readFileSync(absolutePath, 'utf-8');
        const parsedConfig = yaml.load(fileContents) as InstanceConfigFile;

        if (!parsedConfig.chatbots || !Array.isArray(parsedConfig.chatbots)) {
            throw new Error(`Instance YAML config missing required 'chatbots' array. Path: ${absolutePath}`);
        }
        return parsedConfig.chatbots;
    }

    private _processChatbotProfiles(
        defaults: Partial<Omit<ChatbotProfile, 'proxyEndpointId' | 'flowId'>>,
        profiles: Array<Partial<ChatbotProfile> & { proxyEndpointId: string; flowId: string }>
    ): void {
        console.log(`LangflowProxyService: Using chatbot default configurations: ${Object.keys(defaults).join(', ') || 'none'}`);
        let loadedCount = 0;
        for (const partialProfile of profiles) {
            if (partialProfile.proxyEndpointId && partialProfile.flowId) {
                const completeProfile: ChatbotProfile = {
                    ...defaults,
                    ...partialProfile,
                    proxyEndpointId: partialProfile.proxyEndpointId,
                    flowId: partialProfile.flowId // This might be a name or UUID initially
                };
                this.chatbotConfigurations.set(completeProfile.proxyEndpointId, completeProfile);
                loadedCount++;
                // Initial log will show the configured ID (name or UUID)
                console.log(`LangflowProxyService: Loaded chatbot profile: '${completeProfile.proxyEndpointId}' configured with flow identifier \'${completeProfile.flowId}\'.`);
            } else {
                console.warn(`LangflowProxyService: Skipping chatbot profile due to missing 'proxyEndpointId' or 'flowId' in instance config. Profile: ${JSON.stringify(partialProfile)}`);
            }
        }
        console.log(`LangflowProxyService: Successfully processed ${loadedCount} chatbot profile(s) from instance configuration.`);
    }

    public async initializeFlowMappings(): Promise<void> {
        console.log("LangflowProxyService: Initializing flow mappings. Fetching all flows from Langflow...");
        const targetPath = `${LANGFLOW_API_BASE_PATH_V1}/flows/`;
        const queryParams = new URLSearchParams();
        queryParams.append('remove_example_flows', 'true');

        try {
            const fetchUrl = new URL(targetPath, this.langflowEndpointUrl);
            fetchUrl.search = queryParams.toString(); // Append query params

            const headers: HeadersInit = { 'Accept': 'application/json' };
            if (this.langflowApiKey) {
                headers['Authorization'] = `Bearer ${this.langflowApiKey}`;
            }

            console.log(`LangflowProxyService: Fetching all flows from Langflow: ${fetchUrl.toString()}`);
            const langflowApiResponse = await fetch(fetchUrl.toString(), { method: 'GET', headers });

            if (!langflowApiResponse.ok) {
                const errorBody = await langflowApiResponse.text();
                throw new Error(`Failed to fetch flows from Langflow. Status: ${langflowApiResponse.status} ${langflowApiResponse.statusText}. Body: ${errorBody}`);
            }

            const responseJson = await langflowApiResponse.json();
            let actualFlowsArray: Array<{ id: string; name: string; [key: string]: any }> = [];

            // Langflow's /api/v1/flows/ endpoint (especially with get_all=true)
            // might return an object like { records: [], total_count: X }
            // or directly an array, or { flows: [] }
            if (Array.isArray(responseJson)) {
                actualFlowsArray = responseJson;
            } else if (responseJson && Array.isArray(responseJson.records)) { // Common pattern for paginated/detailed lists
                actualFlowsArray = responseJson.records;
            } else if (responseJson && Array.isArray(responseJson.flows)) { // Another possible structure
                actualFlowsArray = responseJson.flows;
            } else {
                console.error("LangflowProxyService: Unexpected response structure for flows list. Expected an array, or {records: [...]}, or {flows: [...]}. Response:", responseJson);
                throw new Error("Unexpected response structure for flows list from Langflow.");
            }
            
            const flowNameToIdMap = new Map<string, string>();
            for (const flow of actualFlowsArray) {
                // Use endpoint_name for mapping if available and non-empty
                if (flow && typeof flow.endpoint_name === 'string' && flow.endpoint_name.trim() !== '' && typeof flow.id === 'string') {
                    flowNameToIdMap.set(flow.endpoint_name, flow.id);
                } else if (flow && typeof flow.name === 'string' && typeof flow.id === 'string'){
                    // Fallback or secondary log: if endpoint_name isn't suitable, what was its primary name?
                    // This helps in debugging if a flow was expected to be found via endpoint_name but wasn't.
                    console.warn(`LangflowProxyService: Flow '${flow.name}' (ID: ${flow.id}) does not have a suitable endpoint_name for mapping. Received endpoint_name: '${flow.endpoint_name}'. It will not be directly addressable by endpoint_name.`);
                } else {
                    console.warn("LangflowProxyService: Skipping a flow entry from Langflow due to missing or invalid id, or unusable name/endpoint_name:", flow);
                }
            }
            
            console.log(`LangflowProxyService: Processed ${actualFlowsArray.length} flow entries, successfully mapped ${flowNameToIdMap.size} flows by endpoint_name.`);

            const resolvedProfiles: string[] = [];
            const unresolvedProfiles: string[] = [];

            for (const [proxyId, profile] of this.chatbotConfigurations.entries()) {
                const configuredFlowId = profile.flowId;
                const isLikelyUuid = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(configuredFlowId);

                if (isLikelyUuid) {
                    console.log(`LangflowProxyService: Profile '${proxyId}' uses a UUID for flowId '${configuredFlowId}'. No resolution needed.`);
                    continue;
                }

                // Treat as a name if not a UUID
                const resolvedUuid = flowNameToIdMap.get(configuredFlowId);
                if (resolvedUuid) {
                    console.log(`LangflowProxyService: Resolved flow name '${configuredFlowId}' to UUID '${resolvedUuid}' for profile '${proxyId}'.`);
                    profile.flowId = resolvedUuid; // Update the profile's flowId
                    resolvedProfiles.push(proxyId);
                } else {
                    console.error(`LangflowProxyService: CRITICAL - Could not resolve flow name '${configuredFlowId}' for profile '${proxyId}'. This profile will not function correctly.`);
                    unresolvedProfiles.push(proxyId);
                    // Optionally, remove or mark the profile as invalid:
                    // this.chatbotConfigurations.delete(proxyId);
                }
            }

            if (unresolvedProfiles.length > 0) {
                console.warn(`LangflowProxyService: Finished flow resolution. ${resolvedProfiles.length} profiles resolved. ${unresolvedProfiles.length} profiles had unresolved flow names: ${unresolvedProfiles.join(', ')}.`);
            } else {
                console.log(`LangflowProxyService: Finished flow resolution. All ${resolvedProfiles.length} flow names (if any) were resolved successfully.`);
            }

        } catch (error: any) {
            console.error(`LangflowProxyService: CRITICAL - Error during flow ID resolution: ${error.message}`);
            // Depending on policy, you might want to re-throw or handle this more gracefully
            // For now, the service will continue but profiles with unresolved names will fail.
        }
    }

    private async _makeDirectLangflowApiRequest(
        res: http.ServerResponse,
        path: string,
        method: 'GET', 
        queryParams?: URLSearchParams
    ): Promise<Response | null> { 
        if (!this.langflowEndpointUrl) {
            console.warn(`LangflowProxyService: Attempted API call to "${path}" when Langflow endpoint URL is not configured.`);
            res.statusCode = 503;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: "Langflow endpoint URL not configured in proxy." }));
            return null;
        }

        const targetUrl = new URL(path, this.langflowEndpointUrl);
        if (queryParams) {
            queryParams.forEach((value, key) => {
                targetUrl.searchParams.append(key, value);
            });
        }

        console.log(`LangflowProxyService: Forwarding ${method} request to Langflow: ${targetUrl.toString()}`);

        const headers: HeadersInit = {
            'Accept': 'application/json',
        };
        if (this.langflowApiKey) {
            headers['Authorization'] = `Bearer ${this.langflowApiKey}`;
        }
        return fetch(targetUrl.toString(), {
            method: method,
            headers: headers,
        });
    }

    public async handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
        const { method, url: rawUrl } = req;
        if (!rawUrl) {
            res.statusCode = 400;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: "URL is required." }));
            return;
        }

        const base = `http://${req.headers.host || 'localhost'}`;
        const parsedUrl = new URL(rawUrl, base); 
        const pathname = parsedUrl.pathname;

        const configRequestPathPrefix = PROXY_BASE_API_PATH + PROXY_CONFIG_ENDPOINT_PREFIX + '/';
        const chatRequestPathPrefix = PROXY_BASE_API_PATH + PROXY_CHAT_MESSAGES_ENDPOINT_PREFIX + '/';

        if (method === 'GET' && pathname.startsWith(configRequestPathPrefix)) {
            const proxyEndpointId = pathname.substring(configRequestPathPrefix.length);
            await this.handleGetChatbotConfigRequest(proxyEndpointId, res);
        } else if (pathname.startsWith(chatRequestPathPrefix)) {
            const remainingPath = pathname.substring(chatRequestPathPrefix.length);
            const parts = remainingPath.split('/').filter(p => p.length > 0);
            const proxyEndpointId = parts[0];

            if (!proxyEndpointId) {
                res.statusCode = 400;
                res.setHeader('Content-Type', 'application/json');
                res.end(JSON.stringify({ error: "proxyEndpointId missing in chat URL." }));
                return;
            }

            if (method === 'POST' && parts.length === 1) {
                await this.handleChatMessageRequest(req, res, proxyEndpointId);
            } else if (method === 'GET' && parts.length === 2 && parts[1] === 'history') {
                const sessionId = parsedUrl.searchParams.get('session_id');
                await this.handleGetChatHistoryRequest(req, res, proxyEndpointId, sessionId);
            } else {
                res.statusCode = 404;
                res.setHeader('Content-Type', 'application/json');
                res.end(JSON.stringify({ error: "Chat endpoint not found or method not supported for the path." }));
            }
        } else if (method === 'GET' && pathname === PROXY_FLOWS_PATH) {
            await this.handleGetFlowsRequest(req, res);
        } else if (method === 'GET' && pathname === PROXY_PROFILES_PATH) {
            await this.handleListChatbotProfilesRequest(req, res);
        } else {
            res.statusCode = 404;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: "Endpoint not found or method not supported." }));
        }
    }

    private async handleGetChatbotConfigRequest(proxyEndpointId: string, res: http.ServerResponse): Promise<void> {
        console.log(`LangflowProxyService: Received GET request for chatbot configuration: '${proxyEndpointId}'`);
        const fullProfile = this.chatbotConfigurations.get(proxyEndpointId);

        if (fullProfile) {
            const { flowId, ...clientSafeProfile } = fullProfile;
            res.statusCode = 200;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify(clientSafeProfile));
        } else {
            res.statusCode = 404;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: `Chatbot configuration with proxyEndpointId '${proxyEndpointId}' not found.` }));
        }
    }
    
    private async handleGetChatHistoryRequest(req: http.IncomingMessage, res: http.ServerResponse, proxyEndpointId: string, sessionId: string | null): Promise<void> {
        console.log(`LangflowProxyService: Received GET request for chat history for profile '${proxyEndpointId}', session '${sessionId}'`);

        const profile = this.chatbotConfigurations.get(proxyEndpointId);
        if (!profile) {
            res.statusCode = 404;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: `Chatbot profile with proxyEndpointId '${proxyEndpointId}' not found.` }));
            return;
        }

        if (!sessionId) {
            res.statusCode = 400;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: "session_id is a required query parameter for history." }));
            return;
        }

        const flowIdToUse = profile.flowId;
        const targetPath = `${LANGFLOW_API_BASE_PATH_V1}/monitor/messages`; 
        const queryParams = new URLSearchParams();
        queryParams.append('flow_id', flowIdToUse);
        queryParams.append('session_id', sessionId);
        
        try {
            const langflowApiResponse = await this._makeDirectLangflowApiRequest(res, targetPath, 'GET', queryParams);

            if (!langflowApiResponse) { 
                return;
            }
            
            console.log(`LangflowProxyService: Response status from Langflow server for history (Profile '${proxyEndpointId}'): ${langflowApiResponse.status} ${langflowApiResponse.statusText}`);

            res.statusCode = langflowApiResponse.status;
            res.setHeader('Content-Type', langflowApiResponse.headers.get('Content-Type') || 'application/json');
            
            const responseBody = await langflowApiResponse.text();
            if (responseBody) {
                res.end(responseBody);
            } else {
                if (!res.writableEnded) {
                    res.end();
                }
            }

        } catch (error: any) {
            console.error(`LangflowProxyService: Error forwarding GET request to Langflow for history (Profile '${proxyEndpointId}'):`, error);
            if (!res.headersSent) {
                res.statusCode = 500;
                res.setHeader('Content-Type', 'application/json');
                res.end(JSON.stringify({ error: "Failed to fetch message history from Langflow.", detail: error.message }));
            } else {
                if (!res.writableEnded) {
                    res.end();
                }
            }
        }
    }

    private async handleGetFlowsRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
        console.log(`LangflowProxyService: Received GET request for flows configuration: ${req.url}`);
        const targetPath = `${LANGFLOW_API_BASE_PATH_V1}/flows/`;
        const queryParams = new URLSearchParams();
        queryParams.append('header_flows', 'true');
        queryParams.append('get_all', 'true'); 

        try {
            const langflowApiResponse = await this._makeDirectLangflowApiRequest(res, targetPath, 'GET', queryParams);

            if (!langflowApiResponse) { 
                return;
            }

            console.log(`LangflowProxyService: Response status from Langflow server for flows config: ${langflowApiResponse.status} ${langflowApiResponse.statusText}`);

            let langflowResponseData: any;
            try {
                langflowResponseData = await langflowApiResponse.json();
                console.log(`LangflowProxyService: Successfully parsed JSON response from Langflow server for flows.`);
            } catch (jsonError: any) {
                console.error(`LangflowProxyService: Failed to parse JSON response from Langflow server (flows). Status: ${langflowApiResponse.status}. Error: ${jsonError.message}`);
                try {
                    const rawText = await langflowApiResponse.text(); 
                    console.error(`LangflowProxyService: Raw text snippet from Langflow server (flows, on JSON parse error): ${rawText.substring(0, 200)}...`);
                } catch (textError: any) {
                }
                
                if (!res.headersSent) {
                    res.statusCode = 502; 
                    res.setHeader('Content-Type', 'application/json');
                    res.end(JSON.stringify({ error: "Proxy received an invalid JSON response from Langflow server.", detail: jsonError.message }));
                }
                return;
            }

            res.setHeader('Content-Type', 'application/json');
            langflowApiResponse.headers.forEach((value, name) => {
                const lowerName = name.toLowerCase();
                if (lowerName !== 'transfer-encoding' && 
                    lowerName !== 'content-length' && 
                    lowerName !== 'content-encoding' &&
                    lowerName !== 'content-type') { 
                    res.setHeader(name, value);
                }
            });
            res.statusCode = langflowApiResponse.status;
            
            res.end(JSON.stringify(langflowResponseData));

        } catch (error: any) {
            console.error(`LangflowProxyService: Error processing GET request for flows list:`, error);
            if (!res.headersSent) {
                res.statusCode = 500;
                res.setHeader('Content-Type', 'application/json');
                res.end(JSON.stringify({ error: "Failed to fetch flows list from Langflow.", detail: error.message }));
            } else {
                if (!res.writableEnded) {
                    res.end();
                }
            }
        }
    }

    private async handleListChatbotProfilesRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
        console.log(`LangflowProxyService: Received GET request to list chatbot profiles.`);
        const profilesList: Array<{ proxyEndpointId: string; widgetTitle?: string }> = [];
        for (const [proxyId, profile] of this.chatbotConfigurations.entries()) {
            profilesList.push({
                proxyEndpointId: proxyId,
                widgetTitle: profile.widgetTitle || proxyId // Use widgetTitle or fallback to proxyId
            });
        }

        res.statusCode = 200;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify(profilesList));
    }

    private async handleChatMessageRequest(req: http.IncomingMessage, res: http.ServerResponse, proxyEndpointId: string): Promise<void> {
        if (!this.langflowClient) {
            res.statusCode = 503;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: "LangflowProxyService: LangflowClient not initialized. Check server logs." }));
            return;
        }

        const profile = this.chatbotConfigurations.get(proxyEndpointId);
        if (!profile) {
            res.statusCode = 404;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: `Chatbot profile with proxyEndpointId '${proxyEndpointId}' not found.` }));
            return;
        }

        try {
            const body = await parseJsonBody(req);
            const userMessage = body.message;
            const clientSessionId = body.sessionId; 
            
            const serverAllowsStream = profile.enableStream !== false; 
            const clientWantsStream = body.stream === true;
            const useStream = serverAllowsStream && clientWantsStream;

            if (!userMessage || typeof userMessage !== 'string') {
                res.statusCode = 400;
                res.setHeader('Content-Type', 'application/json');
                res.end(JSON.stringify({ error: "Message is required and must be a string." }));
                return;
            }
            
            const flowIdToUse = profile.flowId; 

            const runOptions: any = {
                input_type: 'chat',
                output_type: 'chat',
                session_id: clientSessionId || undefined, 
            };
            
            if (runOptions.session_id === undefined) {
                delete runOptions.session_id;
            }

            const flow = this.langflowClient.flow(flowIdToUse);

            if (useStream) {
                console.log(`LangflowProxyService: Streaming request for Profile ('${proxyEndpointId}' -> Flow '${flowIdToUse}'), session: ${runOptions.session_id || 'new'}, message: "${userMessage.substring(0, 50)}..."`);
                res.setHeader('Content-Type', 'application/x-ndjson');
                res.setHeader('Transfer-Encoding', 'chunked');

                try {
                    const streamResponse = await flow.stream(userMessage, runOptions);
                    for await (const event of streamResponse) {
                        res.write(JSON.stringify(event) + '\n');
                    }
                    res.end();
                } catch (streamError: any) {
                    console.error(`LangflowProxyService: Error during Langflow stream for profile '${proxyEndpointId}' (Flow '${flowIdToUse}'):`, streamError);
                    if (!res.headersSent) {
                        res.statusCode = 500;
                        res.setHeader('Content-Type', 'application/json');
                        res.end(JSON.stringify({ event: 'error', data: { message: "Failed to process stream.", detail: streamError.message || 'Unknown stream error' } }));
                    } else {
                        res.write(JSON.stringify({ event: 'error', data: { message: "Error during streaming.", detail: streamError.message || 'Unknown error on stream' } }) + '\n');
                        res.end(); 
                    }
                }
            } else {
                let logMessage = `LangflowProxyService: Non-streaming request for Profile ('${proxyEndpointId}' -> Flow '${flowIdToUse}')`;
                if (clientSessionId) {
                    logMessage += `, session: ${runOptions.session_id}`;
                }
                logMessage += `, input_type: ${runOptions.input_type}, message: "${userMessage.substring(0,50)}..."`;
                console.log(logMessage);
                
                const langflowResponse = await flow.run(userMessage, runOptions);
                const responseSessionId = langflowResponse.sessionId;
                let reply = "Sorry, I could not process that."; 

                if (langflowResponse && Array.isArray(langflowResponse.outputs) && langflowResponse.outputs.length > 0) {
                    const firstOutputComponent = langflowResponse.outputs[0];
                    if (firstOutputComponent && Array.isArray(firstOutputComponent.outputs) && firstOutputComponent.outputs.length > 0) {
                        const innerOutput = firstOutputComponent.outputs[0];
                        if (innerOutput && innerOutput.results && typeof innerOutput.results === 'object' && 
                            innerOutput.results.message && typeof innerOutput.results.message === 'object' && 
                            typeof innerOutput.results.message.text === 'string') {
                            reply = innerOutput.results.message.text.trim();
                        } else if (innerOutput && innerOutput.outputs && typeof innerOutput.outputs === 'object') {
                            const innerComponentOutputs = innerOutput.outputs as Record<string, any>;
                            if (innerComponentOutputs.message && typeof innerComponentOutputs.message === 'object' && typeof innerComponentOutputs.message.message === 'string') {
                                reply = innerComponentOutputs.message.message.trim();
                            } else if (typeof innerComponentOutputs.text === 'string') {
                                reply = innerComponentOutputs.text.trim();
                            }
                        }
                    }
                }
                if (reply === "Sorry, I could not process that." && langflowResponse && Array.isArray(langflowResponse.outputs)) {
                     console.log("LangflowProxyService: Primary reply extraction failed for non-streaming, attempting broader fallback...");
                     for (const outputComponent of langflowResponse.outputs) {
                        if (reply !== "Sorry, I could not process that.") break;
                        if (outputComponent && typeof outputComponent === 'object' && Array.isArray(outputComponent.outputs)) {
                            for (const innerDocOutput of outputComponent.outputs) {
                                if (reply !== "Sorry, I could not process that.") break;
                                if (innerDocOutput && typeof innerDocOutput === 'object') {
                                    if (innerDocOutput.outputs && typeof innerDocOutput.outputs === 'object') {
                                        const componentOutputs = innerDocOutput.outputs as Record<string, any>;
                                        if (componentOutputs.chat && typeof componentOutputs.chat === 'string' && componentOutputs.chat.trim() !== '') {
                                            reply = componentOutputs.chat.trim(); break;
                                        }
                                        if (componentOutputs.text && typeof componentOutputs.text === 'string' && componentOutputs.text.trim() !== '') {
                                            reply = componentOutputs.text.trim(); break;
                                        }
                                    }
                                    if (innerDocOutput.results && innerDocOutput.results.message && typeof innerDocOutput.results.message.text === 'string') {
                                        reply = innerDocOutput.results.message.text.trim(); break;
                                    }
                                    if (innerDocOutput.artifacts && typeof innerDocOutput.artifacts.message === 'string') {
                                        reply = innerDocOutput.artifacts.message.trim(); break;
                                    }
                                }
                            }
                        }
                    }
                }
                if (reply === '') {
                    reply = "Received an empty message from Bot.";
                }

                res.statusCode = 200;
                res.setHeader('Content-Type', 'application/json');
                res.end(JSON.stringify({ reply: reply, sessionId: responseSessionId }));
            }

        } catch (error: any) {
            if (error.message.includes('Invalid JSON body')) {
                 console.warn(`LangflowProxyService: Invalid JSON body received for chat profile '${proxyEndpointId}'. Error: ${error.message}`);
                 res.statusCode = 400;
                 res.setHeader('Content-Type', 'application/json');
                 res.end(JSON.stringify({ error: "Invalid JSON body provided.", detail: error.message }));
            } else {
                console.error(`LangflowProxyService: Error handling chat message for profile '${proxyEndpointId}':`, error);
                if (!res.headersSent) {
                    res.statusCode = 500;
                    res.setHeader('Content-Type', 'application/json');
                    res.end(JSON.stringify({ error: "Failed to process chat message.", detail: error.message }));
                } else {
                    console.error("LangflowProxyService: Attempted to send error response, but headers were already sent for chat message.");
                }
            }
        }
    }
} 