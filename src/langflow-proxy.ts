import http from 'http';
import { LangflowClient } from '@datastax/langflow-client';
import { 
    PROXY_CHAT_PATH, 
    PROXY_MESSAGES_PATH, 
    PROXY_FLOWS_PATH
} from './config/apiPaths';

const LANGFLOW_API_BASE_PATH_V1 = '/api/v1';

export interface LangflowProxyConfig {
    langflowEndpointUrl: string;
    langflowApiKey?: string;
}

// Helper to parse JSON body (adapted from server.ts)
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
    private langflowClient: LangflowClient;
    // private defaultFlowId: string;
    private langflowEndpointUrl: string;
    private langflowApiKey?: string;

    constructor(config: LangflowProxyConfig) {
        this.langflowEndpointUrl = config.langflowEndpointUrl;
        this.langflowApiKey = config.langflowApiKey;

        const clientConfig: { baseUrl: string; apiKey?: string } = {
            baseUrl: config.langflowEndpointUrl,
        };

        if (config.langflowApiKey && config.langflowApiKey.trim() !== '') {
            clientConfig.apiKey = config.langflowApiKey;
        }
        
        try {
            this.langflowClient = new LangflowClient(clientConfig);
            console.log(`LangflowProxyService: LangflowClient initialized. Configured Endpoint: ${this.langflowEndpointUrl}`);
        } catch (error) {
            console.error("LangflowProxyService: Failed to initialize LangflowClient:", error);
            throw error; 
        }
    }

    private async _makeDirectLangflowApiRequest(
        res: http.ServerResponse,
        path: string,
        method: 'GET', // Currently only GET is used for direct calls
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

        // The actual fetch call is done here. The caller will handle response status and body.
        // Errors from fetch (network errors, etc.) will propagate and should be caught by the caller.
        return fetch(targetUrl.toString(), {
            method: method,
            headers: headers,
        });
    }

    public async handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
        if (req.method === 'GET' && req.url?.startsWith(PROXY_MESSAGES_PATH)) {
            await this.handleGetMessagesRequest(req, res);
        } else if (req.method === 'POST' && req.url === PROXY_CHAT_PATH) {
            await this.handleChatMessageRequest(req, res);
        } else if (req.method === 'GET' && req.url === PROXY_FLOWS_PATH) {
            await this.handleGetFlowsRequest(req, res);
        } else {
            res.statusCode = 404;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: "Endpoint not found or method not supported." }));
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

            if (!langflowApiResponse) { // Helper already sent a response (e.g., 503)
                return;
            }

            console.log(`LangflowProxyService: Response status from Langflow server for flows config: ${langflowApiResponse.status} ${langflowApiResponse.statusText}`);

            let langflowResponseData: any;
            try {
                langflowResponseData = await langflowApiResponse.json(); // Handles decompression
                console.log(`LangflowProxyService: Successfully parsed JSON response from Langflow server for flows.`);
            } catch (jsonError: any) {
                console.error(`LangflowProxyService: Failed to parse JSON response from Langflow server (flows). Status: ${langflowApiResponse.status}. Error: ${jsonError.message}`);
                // Attempt to log raw text only on error, and keep it brief
                try {
                    const rawText = await langflowApiResponse.text(); 
                    console.error(`LangflowProxyService: Raw text snippet from Langflow server (flows, on JSON parse error): ${rawText.substring(0, 200)}...`);
                } catch (textError: any) {
                    // Silent if reading text also fails
                }
                
                if (!res.headersSent) {
                    res.statusCode = 502; 
                    res.setHeader('Content-Type', 'application/json');
                    res.end(JSON.stringify({ error: "Proxy received an invalid JSON response from Langflow server.", detail: jsonError.message }));
                }
                return;
            }

            res.setHeader('Content-Type', 'application/json');
            // No need to relay original content-encoding or content-length from Langflow
            // as we are sending newly stringified JSON.
            langflowApiResponse.headers.forEach((value, name) => {
                const lowerName = name.toLowerCase();
                if (lowerName !== 'transfer-encoding' && 
                    lowerName !== 'content-length' && 
                    lowerName !== 'content-encoding' &&
                    lowerName !== 'content-type') { // We set our own content-type
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

    private async handleGetMessagesRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
        console.log(`LangflowProxyService: Received GET request for messages: ${req.url}`);

        const incomingUrl = new URL(req.url!, `http://${req.headers.host}`);
        const flowId = incomingUrl.searchParams.get('flow_id');
        const sessionId = incomingUrl.searchParams.get('session_id');

        if (!flowId || !sessionId) {
            res.statusCode = 400;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: "flow_id and session_id are required query parameters." }));
            return;
        }

        const targetPath = `${LANGFLOW_API_BASE_PATH_V1}/monitor/messages`; 
        const queryParams = new URLSearchParams();
        queryParams.append('flow_id', flowId);
        queryParams.append('session_id', sessionId);
        
        try {
            const langflowApiResponse = await this._makeDirectLangflowApiRequest(res, targetPath, 'GET', queryParams);

            if (!langflowApiResponse) { // Helper already sent a response (e.g., 503)
                return;
            }
            
            console.log(`LangflowProxyService: Response status from Langflow server for messages: ${langflowApiResponse.status} ${langflowApiResponse.statusText}`);

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
            console.error(`LangflowProxyService: Error forwarding GET request to Langflow for messages:`, error);
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
    
    private async handleChatMessageRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
        if (!this.langflowClient) {
            res.statusCode = 503;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: "LangflowProxyService: LangflowClient not initialized. Check server logs." }));
            return;
        }

        try {
            const body = await parseJsonBody(req);
            const userMessage = body.message;
            const clientSessionId = body.sessionId;
            const userId = body.user_id;
            const wantsStream = body.stream === true;
            const flowIdToUse = body.flowId;

            if (!userMessage || typeof userMessage !== 'string') {
                res.statusCode = 400;
                res.setHeader('Content-Type', 'application/json');
                res.end(JSON.stringify({ error: "Message is required and must be a string." }));
                return;
            }

            if (!flowIdToUse || typeof flowIdToUse !== 'string' || flowIdToUse.trim() === '') {
                res.statusCode = 400;
                res.setHeader('Content-Type', 'application/json');
                res.end(JSON.stringify({ error: "flowId is required in the request body and must be a non-empty string." }));
                return;
            }

            const runOptions: any = {
                input_type: 'chat',
                output_type: 'chat',
                session_id: clientSessionId || undefined,
                user_id: userId || undefined 
            };
            
            if (runOptions.session_id === undefined) {
                delete runOptions.session_id;
            }
            if (runOptions.user_id === undefined) {
                delete runOptions.user_id;
            }

            const flow = this.langflowClient.flow(flowIdToUse);

            if (wantsStream) {
                console.log(`LangflowProxyService: Streaming request for Flow (${flowIdToUse}), session: ${runOptions.session_id || 'new'}, user: ${userId || 'anonymous'}, message: "${userMessage.substring(0, 50)}..."`);
                res.setHeader('Content-Type', 'application/x-ndjson');
                res.setHeader('Transfer-Encoding', 'chunked');

                try {
                    const streamResponse = await flow.stream(userMessage, runOptions);
                    for await (const event of streamResponse) {
                        res.write(JSON.stringify(event) + '\n');
                    }
                    res.end();
                } catch (streamError: any) {
                    console.error(`LangflowProxyService: Error during Langflow stream for flow ${flowIdToUse}:`, streamError);
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
                let logMessage = `LangflowProxyService: Non-streaming request for Flow (${flowIdToUse})`;
                if (clientSessionId) {
                    logMessage += `, session: ${runOptions.session_id}`;
                }
                if (userId) {
                    logMessage += `, user: ${userId}`;
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
            console.error(`LangflowProxyService: Error handling request:`, error);
            if (!res.headersSent) {
                res.statusCode = 500;
                res.setHeader('Content-Type', 'application/json');
                const clientErrorDetail = (error instanceof Error && error.message.includes('Invalid JSON body')) ? 
                                          error.message : 'An internal error occurred.';
                res.end(JSON.stringify({ error: "Failed to process chat message.", detail: clientErrorDetail }));
            } else {
                console.error("LangflowProxyService: Attempted to send error response, but headers were already sent.");
            }
        }
    }
} 