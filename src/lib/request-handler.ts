import http from 'http';
import { URL } from 'url';
import { LangflowClient } from '@datastax/langflow-client';
import { ChatbotProfile } from '../types';
import {
    PROXY_BASE_API_PATH,
    PROXY_CONFIG_ENDPOINT_PREFIX,
    PROXY_CHAT_MESSAGES_ENDPOINT_PREFIX,
    PROXY_FLOWS_PATH,
    PROXY_PROFILES_PATH,
    LANGFLOW_API_BASE_PATH_V1
} from '../config/apiPaths';

// Helper function, can be part of this module or a utils module
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

// This function will be called by LangflowProxyService, passing necessary dependencies
export async function handleRequest(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    chatbotConfigurations: Map<string, ChatbotProfile>,
    langflowClient: LangflowClient | undefined, // Can be undefined if not initialized
    langflowEndpointUrl: string | undefined,
    langflowApiKey: string | undefined,
    // Function to make direct API requests, passed from the main service
    makeDirectLangflowApiRequest: (
        res: http.ServerResponse,
        path: string,
        method: 'GET',
        queryParams?: URLSearchParams
    ) => Promise<Response | null>
): Promise<void> {
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
        await handleGetChatbotConfigRequest(proxyEndpointId, res, chatbotConfigurations);
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
            await handleChatMessageRequest(req, res, proxyEndpointId, chatbotConfigurations, langflowClient);
        } else if (method === 'GET' && parts.length === 2 && parts[1] === 'history') {
            const sessionId = parsedUrl.searchParams.get('session_id');
            await handleGetChatHistoryRequest(req, res, proxyEndpointId, sessionId, chatbotConfigurations, makeDirectLangflowApiRequest);
        } else {
            res.statusCode = 404;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: "Chat endpoint not found or method not supported for the path." }));
        }
    } else if (method === 'GET' && pathname === PROXY_FLOWS_PATH) {
        await handleGetFlowsRequest(req, res, makeDirectLangflowApiRequest);
    } else if (method === 'GET' && pathname === PROXY_PROFILES_PATH) {
        await handleListChatbotProfilesRequest(req, res, chatbotConfigurations);
    } else {
        res.statusCode = 404;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ error: "Endpoint not found or method not supported." }));
    }
}

async function handleGetChatbotConfigRequest(proxyEndpointId: string, res: http.ServerResponse, chatbotConfigurations: Map<string, ChatbotProfile>): Promise<void> {
    console.log(`RequestHandler: Received GET request for chatbot configuration: '${proxyEndpointId}'`);
    const fullProfile = chatbotConfigurations.get(proxyEndpointId);

    if (fullProfile) {
        const { flowId, ...clientSafeProfile } = fullProfile; // flowId is sensitive/internal
        res.statusCode = 200;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify(clientSafeProfile));
    } else {
        res.statusCode = 404;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ error: `Chatbot configuration with proxyEndpointId '${proxyEndpointId}' not found.` }));
    }
}

async function handleGetChatHistoryRequest(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    proxyEndpointId: string,
    sessionId: string | null,
    chatbotConfigurations: Map<string, ChatbotProfile>,
    makeDirectLangflowApiRequest: (
        res: http.ServerResponse,
        path: string,
        method: 'GET',
        queryParams?: URLSearchParams
    ) => Promise<Response | null>
): Promise<void> {
    console.log(`RequestHandler: Received GET request for chat history for profile '${proxyEndpointId}', session '${sessionId}'`);
    const profile = chatbotConfigurations.get(proxyEndpointId);
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
        const langflowApiResponse = await makeDirectLangflowApiRequest(res, targetPath, 'GET', queryParams);
        if (!langflowApiResponse) return;
        
        console.log(`RequestHandler: Response status from Langflow server for history (Profile '${proxyEndpointId}'): ${langflowApiResponse.status} ${langflowApiResponse.statusText}`);
        res.statusCode = langflowApiResponse.status;
        res.setHeader('Content-Type', langflowApiResponse.headers.get('Content-Type') || 'application/json');
        const responseBody = await langflowApiResponse.text();
        if (responseBody) res.end(responseBody);
        else if (!res.writableEnded) res.end();

    } catch (error: any) {
        console.error(`RequestHandler: Error forwarding GET request to Langflow for history (Profile '${proxyEndpointId}'):`, error);
        if (!res.headersSent) {
            res.statusCode = 500;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: "Failed to fetch message history from Langflow.", detail: error.message }));
        } else if (!res.writableEnded) {
            res.end();
        }
    }
}

async function handleGetFlowsRequest(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    makeDirectLangflowApiRequest: (
        res: http.ServerResponse,
        path: string,
        method: 'GET',
        queryParams?: URLSearchParams
    ) => Promise<Response | null>
): Promise<void> {
    console.log(`RequestHandler: Received GET request for flows configuration: ${req.url}`);
    const targetPath = `${LANGFLOW_API_BASE_PATH_V1}/flows/`;
    const queryParams = new URLSearchParams();
    queryParams.append('header_flows', 'true');
    queryParams.append('get_all', 'true');

    try {
        const langflowApiResponse = await makeDirectLangflowApiRequest(res, targetPath, 'GET', queryParams);
        if (!langflowApiResponse) return;

        console.log(`RequestHandler: Response status from Langflow server for flows config: ${langflowApiResponse.status} ${langflowApiResponse.statusText}`);
        let langflowResponseData: any;
        try {
            langflowResponseData = await langflowApiResponse.json();
        } catch (jsonError: any) {
            console.error(`RequestHandler: Failed to parse JSON response from Langflow server (flows). Status: ${langflowApiResponse.status}. Error: ${jsonError.message}`);
            // ... (error handling for JSON parse)
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
            if (lowerName !== 'transfer-encoding' && lowerName !== 'content-length' && lowerName !== 'content-encoding' && lowerName !== 'content-type') {
                res.setHeader(name, value);
            }
        });
        res.statusCode = langflowApiResponse.status;
        res.end(JSON.stringify(langflowResponseData));

    } catch (error: any) {
        console.error(`RequestHandler: Error processing GET request for flows list:`, error);
        if (!res.headersSent) {
            res.statusCode = 500;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: "Failed to fetch flows list from Langflow.", detail: error.message }));
        } else if (!res.writableEnded) {
            res.end();
        }
    }
}

async function handleListChatbotProfilesRequest(req: http.IncomingMessage, res: http.ServerResponse, chatbotConfigurations: Map<string, ChatbotProfile>): Promise<void> {
    console.log(`RequestHandler: Received GET request to list chatbot profiles.`);
    const profilesList: Array<{ proxyEndpointId: string; widgetTitle?: string }> = [];
    for (const [proxyId, profile] of chatbotConfigurations.entries()) {
        profilesList.push({
            proxyEndpointId: proxyId,
            widgetTitle: profile.widgetTitle || proxyId
        });
    }
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(profilesList));
}

async function handleChatMessageRequest(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    proxyEndpointId: string,
    chatbotConfigurations: Map<string, ChatbotProfile>,
    langflowClient: LangflowClient | undefined
): Promise<void> {
    if (!langflowClient) {
        res.statusCode = 503;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ error: "RequestHandler: LangflowClient not available. Check server logs." }));
        return;
    }

    const profile = chatbotConfigurations.get(proxyEndpointId);
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
        if (runOptions.session_id === undefined) delete runOptions.session_id;

        const flow = langflowClient.flow(flowIdToUse);

        if (useStream) {
            console.log(`RequestHandler: Streaming request for Profile ('${proxyEndpointId}' -> Flow '${flowIdToUse}'), session: ${runOptions.session_id || 'new'}, message: "${userMessage.substring(0, 50)}..."`);
            res.setHeader('Content-Type', 'application/x-ndjson');
            res.setHeader('Transfer-Encoding', 'chunked');

            try {
                const streamResponse = await flow.stream(userMessage, runOptions);
                for await (const event of streamResponse) {
                    res.write(JSON.stringify(event) + '\n');
                }
                res.end();
            } catch (streamError: any) {
                console.error(`RequestHandler: Error during Langflow stream for profile '${proxyEndpointId}' (Flow '${flowIdToUse}'):`, streamError);
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
            // ... (non-streaming logic - keeping it brief for this example, full logic would be here)
            let logMessage = `RequestHandler: Non-streaming request for Profile ('${proxyEndpointId}' -> Flow '${flowIdToUse}')`;
            if (clientSessionId) logMessage += `, session: ${runOptions.session_id}`;
            logMessage += `, input_type: ${runOptions.input_type}, message: "${userMessage.substring(0,50)}..."`;
            console.log(logMessage);
            
            const langflowResponse = await flow.run(userMessage, runOptions);
            // Extract reply (full extraction logic as in original file)
            let reply = "Sorry, I could not process that."; // Default
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
            // Fallback logic for reply extraction as in original
            if (reply === "Sorry, I could not process that." && langflowResponse && Array.isArray(langflowResponse.outputs)) {
                 console.log("RequestHandler: Primary reply extraction failed, attempting fallback...");
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
            if (reply === '') reply = "Received an empty message from Bot.";

            res.statusCode = 200;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ reply: reply, sessionId: langflowResponse.sessionId }));
        }

    } catch (error: any) {
        if (error.message.includes('Invalid JSON body')) {
             console.warn(`RequestHandler: Invalid JSON body for chat profile '${proxyEndpointId}'. Error: ${error.message}`);
             res.statusCode = 400;
             res.setHeader('Content-Type', 'application/json');
             res.end(JSON.stringify({ error: "Invalid JSON body provided.", detail: error.message }));
        } else {
            console.error(`RequestHandler: Error handling chat message for profile '${proxyEndpointId}':`, error);
            if (!res.headersSent) {
                res.statusCode = 500;
                res.setHeader('Content-Type', 'application/json');
                res.end(JSON.stringify({ error: "Failed to process chat message.", detail: error.message }));
            } else if (!res.writableEnded) {
                res.end();
            }
        }
    }
} 