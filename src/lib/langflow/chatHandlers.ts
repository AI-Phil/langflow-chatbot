import http from 'http';
import { LangflowClient } from '@datastax/langflow-client';
import { sendJsonError, parseJsonBody } from '../request-utils';

export async function handleChatMessageRequest(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    flowId: string,
    enableStream: boolean,
    langflowClient: LangflowClient | undefined
): Promise<void> {
    if (!langflowClient) {
        sendJsonError(res, 503, "RequestHandler: LangflowClient not available. Check server logs.");
        return;
    }

    try {
        const body = await parseJsonBody(req);
        const userMessage = body.message;
        const clientSessionId = body.sessionId;
        const clientWantsStream = body.stream === true;
        const useStream = enableStream && clientWantsStream;

        if (!userMessage || typeof userMessage !== 'string') {
            sendJsonError(res, 400, "Message is required and must be a string.");
            return;
        }
        
        const runOptions: any = {
            input_type: 'chat',
            output_type: 'chat',
            session_id: clientSessionId || undefined,
        };
        if (runOptions.session_id === undefined) delete runOptions.session_id;

        const flow = langflowClient.flow(flowId);

        if (useStream) {
            console.log(`RequestHandler: Streaming request for Flow '${flowId}', session: ${runOptions.session_id || 'new'}, message: "${userMessage.substring(0, 50)}..."`);
            res.setHeader('Content-Type', 'application/x-ndjson');
            res.setHeader('Transfer-Encoding', 'chunked');

            try {
                const streamResponse = await flow.stream(userMessage, runOptions);
                for await (const event of streamResponse) {
                    res.write(JSON.stringify(event) + '\n');
                }
                res.end();
            } catch (streamError: any) {
                console.error(`RequestHandler: Error during Langflow stream for flow '${flowId}':`, streamError);
                if (!res.headersSent) {
                    sendJsonError(res, 500, "Failed to process stream.", streamError.message || 'Unknown stream error');
                } else {
                    res.write(JSON.stringify({ event: 'error', data: { message: "Error during streaming.", detail: streamError.message || 'Unknown error on stream' } }) + '\n');
                    res.end();
                }
            }
        } else {
            let logMessage = `RequestHandler: Non-streaming request for Flow '${flowId}'`;
            if (clientSessionId) logMessage += `, session: ${runOptions.session_id}`;
            logMessage += `, input_type: ${runOptions.input_type}, message: "${userMessage.substring(0,50)}..."`;
            console.log(logMessage);
            
            const langflowResponse = await flow.run(userMessage, runOptions);
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
             console.warn(`RequestHandler: Invalid JSON body for flow '${flowId}'. Error: ${error.message}`);
             sendJsonError(res, 400, "Invalid JSON body provided.", error.message);
        } else {
            console.error(`RequestHandler: Error handling chat message for flow '${flowId}':`, error);
            if (!res.headersSent) {
                sendJsonError(res, 500, "Failed to process chat message.", error.message);
            } else if (!res.writableEnded) {
                res.end();
            }
        }
    }
} 