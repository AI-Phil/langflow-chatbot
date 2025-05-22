import http from 'http';
import { LangflowClient } from '@datastax/langflow-client';
import { sendJsonError, parseJsonBody } from '../request-utils';

// Helper function to extract reply from Langflow's response
function extractReplyFromLangflowResponse(langflowResponse: any): string {
    let reply = "Sorry, I could not process that.";

    if (langflowResponse && Array.isArray(langflowResponse.outputs) && langflowResponse.outputs.length > 0) {
        const firstOutputComponent = langflowResponse.outputs[0];
        if (firstOutputComponent && Array.isArray(firstOutputComponent.outputs) && firstOutputComponent.outputs.length > 0) {
            const innerOutput = firstOutputComponent.outputs[0];
            if (innerOutput) {
                let textFromResults: string | null = null;
                if (innerOutput.results?.message && typeof innerOutput.results.message.text === 'string') {
                    textFromResults = innerOutput.results.message.text;
                }

                if (textFromResults !== null) { // If results.message.text was present
                    reply = textFromResults;
                } else if (innerOutput.outputs && typeof innerOutput.outputs === 'object') {
                    const innerComponentOutputs = innerOutput.outputs as Record<string, any>;
                    if (innerComponentOutputs.message && typeof innerComponentOutputs.message === 'object' && typeof innerComponentOutputs.message.message === 'string') {
                        if (innerComponentOutputs.message.message !== '') {
                           reply = innerComponentOutputs.message.message;
                        } else if (reply === "Sorry, I could not process that.") {
                            reply = '';
                        }
                    } else if (typeof innerComponentOutputs.text === 'string') {
                        if (innerComponentOutputs.text !== '') {
                           reply = innerComponentOutputs.text;
                        } else if (reply === "Sorry, I could not process that.") {
                            reply = '';
                        }
                    }
                }
            }
        }

        if (reply === "Sorry, I could not process that.") {
            console.log("RequestHandler: Primary reply extraction failed or yielded no usable primary value, attempting fallback...");
            for (const outputComponent of langflowResponse.outputs) {
                if (reply !== "Sorry, I could not process that.") break;
                if (outputComponent && typeof outputComponent === 'object' && Array.isArray(outputComponent.outputs)) {
                    for (const innerDocOutput of outputComponent.outputs) {
                        if (reply !== "Sorry, I could not process that.") break;
                        if (innerDocOutput && typeof innerDocOutput === 'object') {
                            if (innerDocOutput.outputs && typeof innerDocOutput.outputs === 'object') {
                                const componentOutputs = innerDocOutput.outputs as Record<string, any>;
                                if (componentOutputs.chat && typeof componentOutputs.chat === 'string' && componentOutputs.chat !== '') {
                                    reply = componentOutputs.chat; break;
                                } else if (componentOutputs.chat === '' && reply === "Sorry, I could not process that.") { reply = ''; break;}

                                if (componentOutputs.text && typeof componentOutputs.text === 'string' && componentOutputs.text !== '') {
                                    reply = componentOutputs.text; break;
                                } else if (componentOutputs.text === '' && reply === "Sorry, I could not process that.") { reply = ''; break;}
                                
                                if (componentOutputs.message && typeof componentOutputs.message === 'object' && typeof componentOutputs.message.message === 'string' && componentOutputs.message.message !== '') {
                                    reply = componentOutputs.message.message; break;
                                } else if (componentOutputs.message?.message === '' && reply === "Sorry, I could not process that.") { reply = ''; break;}
                            }
                            if (innerDocOutput.results && innerDocOutput.results.message && typeof innerDocOutput.results.message.text === 'string') {
                                if (innerDocOutput.results.message.text !== '') {
                                    reply = innerDocOutput.results.message.text; break;
                                } else if (reply === "Sorry, I could not process that.") { reply = ''; break; }
                            }
                            if (innerDocOutput.artifacts && typeof innerDocOutput.artifacts.message === 'string') {
                                 if (innerDocOutput.artifacts.message !== '') {
                                    reply = innerDocOutput.artifacts.message; break;
                                } else if (reply === "Sorry, I could not process that.") { reply = ''; break; }
                            }
                        }
                    }
                }
            }
        }
    }

    if (reply === '') {
        reply = "Received an empty message from Bot.";
    }
    return reply;
}

export async function handleChatMessageRequest(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    flowId: string,
    enableStream: boolean,
    langflowClient: LangflowClient | undefined,
    preParsedBody: any | undefined,
    isBodyPreParsed: boolean
): Promise<void> {
    if (!langflowClient) {
        sendJsonError(res, 503, "RequestHandler: LangflowClient not available. Check server logs.");
        return;
    }

    try {
        let actualBody: any;
        if (isBodyPreParsed && preParsedBody) {
            console.log("[Debug ChatHandler] Using pre-parsed body provided by adapter:", preParsedBody);
            actualBody = preParsedBody;
        } else {
            console.log("[Debug ChatHandler] Pre-parsed body not available or not indicated. Attempting to parse JSON body via parseJsonBody.");
            actualBody = await parseJsonBody(req);
            console.log("[Debug ChatHandler] JSON body parsed successfully via parseJsonBody:", actualBody);
        }

        const userMessage = actualBody.message;
        const clientSessionId = actualBody.sessionId;
        const clientWantsStream = actualBody.stream === true;
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
            const reply = extractReplyFromLangflowResponse(langflowResponse);
            const sessionId = langflowResponse && langflowResponse.sessionId ? langflowResponse.sessionId : clientSessionId;

            res.statusCode = 200;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ reply: reply, sessionId: sessionId }));
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