import http from 'http';
import { LangflowClient } from '@datastax/langflow-client';
// We'll define or infer types like LangflowClientOptions, LangflowRunOptions, LangflowStreamEvent as needed.
// For now, let's use 'any' where specific types from the client aren't readily available or are complex.

export interface LangflowProxyConfig {
    langflowEndpointUrl: string;
    langflowApiKey?: string;
    langflowDefaultFlowId: string;
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
    private defaultFlowId: string;
    private langflowEndpointUrl: string;

    constructor(config: LangflowProxyConfig) {
        this.defaultFlowId = config.langflowDefaultFlowId;
        this.langflowEndpointUrl = config.langflowEndpointUrl;

        const clientConfig: { baseUrl: string; apiKey?: string } = {
            baseUrl: config.langflowEndpointUrl,
        };

        if (config.langflowApiKey && config.langflowApiKey.trim() !== '') {
            clientConfig.apiKey = config.langflowApiKey;
        }
        
        try {
            this.langflowClient = new LangflowClient(clientConfig);
            console.log(`LangflowProxyService: LangflowClient initialized. Configured Endpoint: ${this.langflowEndpointUrl}, Default Flow ID: ${this.defaultFlowId}`);
        } catch (error) {
            console.error("LangflowProxyService: Failed to initialize LangflowClient:", error);
            // Propagate the error to allow the calling application to handle it, e.g., by not starting the server.
            throw error; 
        }
    }

    public async handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
        if (!this.langflowClient) {
            // This case should ideally be prevented by the constructor throwing an error if client init fails.
            res.statusCode = 503; // Service Unavailable
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: "LangflowProxyService: LangflowClient not initialized. Check server logs." }));
            return;
        }

        try {
            const body = await parseJsonBody(req);
            const userMessage = body.message;
            const clientSessionId = body.sessionId;
            const userId = body.user_id; // Extract user_id
            const wantsStream = body.stream === true; // Check for the stream flag
            const flowIdToUse = body.flowId || this.defaultFlowId; // Allow overriding flowId from request

            if (!userMessage || typeof userMessage !== 'string') {
                res.statusCode = 400;
                res.setHeader('Content-Type', 'application/json');
                res.end(JSON.stringify({ error: "Message is required and must be a string." }));
                return;
            }

            const runOptions: any = { // Consider defining a specific type for runOptions if available from the client lib
                input_type: 'chat',
                output_type: 'chat',
                session_id: clientSessionId || undefined,
                // Pass user_id if available. The LangflowClient might have a specific way to pass this,
                // but often custom parameters can be passed directly in runOptions.
                // Assuming the underlying Langflow flow is designed to accept a 'user_id' input.
                user_id: userId || undefined 
            };
            
            if (runOptions.session_id === undefined) {
                delete runOptions.session_id; // Remove if undefined to let Langflow handle session creation
            }
            if (runOptions.user_id === undefined) { // Remove user_id if undefined
                delete runOptions.user_id;
            }

            const flow = this.langflowClient.flow(flowIdToUse);

            if (wantsStream) {
                console.log(`LangflowProxyService: Streaming request for Flow (${flowIdToUse}), session: ${runOptions.session_id || 'new'}, user: ${userId || 'anonymous'}, message: "${userMessage.substring(0, 50)}..."`);
                res.setHeader('Content-Type', 'application/x-ndjson');
                res.setHeader('Transfer-Encoding', 'chunked'); // Necessary for streaming

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
                        // If headers are already sent, try to send an error event within the stream
                        res.write(JSON.stringify({ event: 'error', data: { message: "Error during streaming.", detail: streamError.message || 'Unknown error on stream' } }) + '\n');
                        res.end(); // Terminate the chunked response
                    }
                }

            } else {
                // Non-streaming logic
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

                // Attempt to extract the reply from various possible structures in the Langflow response
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
                        if (reply !== "Sorry, I could not process that.") break; // Found reply
                        if (outputComponent && typeof outputComponent === 'object' && Array.isArray(outputComponent.outputs)) {
                            for (const innerDocOutput of outputComponent.outputs) {
                                if (reply !== "Sorry, I could not process that.") break; // Found reply
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
                if (reply === '') { // Ensure we don't send an empty reply string
                    reply = "Received an empty message from Bot.";
                }

                res.statusCode = 200;
                res.setHeader('Content-Type', 'application/json');
                res.end(JSON.stringify({ reply: reply, sessionId: responseSessionId }));
            }

        } catch (error: any) {
            console.error(`LangflowProxyService: Error handling request for flow ${this.defaultFlowId}:`, error);
            // Ensure we don't try to set headers if they were already sent (e.g. in a failed stream attempt)
            if (!res.headersSent) {
                res.statusCode = 500;
                res.setHeader('Content-Type', 'application/json');
                // Avoid sending back verbose internal error messages to the client unless necessary for debugging
                const clientErrorDetail = (error instanceof Error && error.message.includes('Invalid JSON body')) ? 
                                          error.message : 'An internal error occurred.';
                res.end(JSON.stringify({ error: "Failed to process chat message.", detail: clientErrorDetail }));
            } else {
                // If headers are sent, it implies a streaming error happened post-initialization.
                // The specific error handling for streaming above should manage this.
                // This is a fallback, but res.end() might have already been called.
                console.error("LangflowProxyService: Attempted to send error response, but headers were already sent.");
            }
        }
    }
} 