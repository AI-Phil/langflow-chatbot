import http from 'http';
import { LangflowClient } from '@datastax/langflow-client';
import { handleChatMessageRequest } from '../../../src/lib/langflow/chatHandlers';
import * as requestUtils from '../../../src/lib/request-utils';

// Mocks
jest.mock('@datastax/langflow-client');
jest.mock('../../../src/lib/request-utils', () => ({
    parseJsonBody: jest.fn(),
    sendJsonError: jest.fn(),
}));

const mockLangflowClient = LangflowClient as jest.MockedClass<typeof LangflowClient>;
const mockParseJsonBody = requestUtils.parseJsonBody as jest.MockedFunction<typeof requestUtils.parseJsonBody>;
const mockSendJsonError = requestUtils.sendJsonError as jest.MockedFunction<typeof requestUtils.sendJsonError>;

describe('handleChatMessageRequest', () => {
    let req: http.IncomingMessage;
    let res: http.ServerResponse;
    let mockFlow: any;
    let mockLangflowInstance: any;
    let defaultPreParsedBody: any | undefined; // For new params
    let defaultIsBodyPreParsed: boolean;    // For new params

    const flowId = 'test-flow-id';
    const userMessage = 'hello';
    const clientSessionId = 'client-session-123';

    // Example Langflow non-streaming response based on user provided data
    const mockLangflowRunResponse = {
        sessionId: "70d372b0-8822-434b-9d98-29c89aa1fc7d",
        outputs: [
            {
                inputs: {
                    input_value: "hello"
                },
                outputs: [
                    {
                        results: {
                            message: {
                                text: "Hello! How can I assist you today?", // Primary extraction path
                            }
                        },
                        artifacts: { // Fallback path
                            message: "Hello from artifacts!",
                        },
                        outputs: { // Fallback path
                            message: { // Another fallback path (nested)
                                message: "Hello from outputs.message.message!",
                            },
                            text: "Hello from outputs.text!", // Fallback path
                            chat: "Hello from outputs.chat!" // Fallback path
                        },
                    }
                ]
            }
        ]
    };


    beforeEach(() => {
        jest.clearAllMocks();

        req = {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            url: `/api/v1/chat/${flowId}`,
        } as http.IncomingMessage;

        res = {
            statusCode: 0,
            setHeader: jest.fn(),
            write: jest.fn(),
            end: jest.fn(),
            writableEnded: false,
        } as unknown as http.ServerResponse;
        Object.defineProperty(res, 'headersSent', {
            value: false,
            writable: true,
            configurable: true
        });

        mockFlow = {
            run: jest.fn(),
            stream: jest.fn(),
        };
        mockLangflowInstance = {
            flow: jest.fn().mockReturnValue(mockFlow),
        };
        (mockLangflowClient as any).mockImplementation(() => mockLangflowInstance);

        // Default body if parseJsonBody is called
        mockParseJsonBody.mockResolvedValue({ message: userMessage, sessionId: clientSessionId, stream: false });
        mockFlow.run.mockResolvedValue(JSON.parse(JSON.stringify(mockLangflowRunResponse)));

        // Defaults for new parameters
        defaultPreParsedBody = undefined;
        defaultIsBodyPreParsed = false;
    });

    // New tests for body parsing logic
    describe('Body Parsing Logic', () => {
        it('should use preParsedBody and not call parseJsonBody if isBodyPreParsed is true', async () => {
            const preParsed = { message: 'from pre-parsed', sessionId: 'pre-session-789', stream: false };
            await handleChatMessageRequest(req, res, flowId, false, new LangflowClient({}), preParsed, true);
            
            expect(mockParseJsonBody).not.toHaveBeenCalled();
            expect(mockLangflowInstance.flow).toHaveBeenCalledWith(flowId);
            expect(mockFlow.run).toHaveBeenCalledWith(preParsed.message, {
                input_type: 'chat',
                output_type: 'chat',
                session_id: preParsed.sessionId,
            });
            expect(res.statusCode).toBe(200);
        });

        it('should call parseJsonBody if isBodyPreParsed is false', async () => {
            // defaultIsBodyPreParsed is false, defaultPreParsedBody is undefined
            const parsedBodyByFunc = { message: 'from parseJsonBody func', sessionId: 'session-from-func' };
            mockParseJsonBody.mockResolvedValueOnce(parsedBodyByFunc); // Override default for this test

            await handleChatMessageRequest(req, res, flowId, false, new LangflowClient({}), defaultPreParsedBody, defaultIsBodyPreParsed);
            
            expect(mockParseJsonBody).toHaveBeenCalledTimes(1);
            expect(mockParseJsonBody).toHaveBeenCalledWith(req);
            expect(mockLangflowInstance.flow).toHaveBeenCalledWith(flowId);
            expect(mockFlow.run).toHaveBeenCalledWith(parsedBodyByFunc.message, {
                input_type: 'chat',
                output_type: 'chat',
                session_id: parsedBodyByFunc.sessionId,
            });
            expect(res.statusCode).toBe(200);
        });

        it('should use parseJsonBody if isBodyPreParsed is true BUT preParsedBody is null/undefined (edge case, defensive)', async () => {
            const parsedBodyByFunc = { message: 'from parseJsonBody func for edge case', sessionId: 'session-from-func-edge' };
            mockParseJsonBody.mockResolvedValueOnce(parsedBodyByFunc); 

            // isBodyPreParsed is true, but preParsedBody is undefined
            await handleChatMessageRequest(req, res, flowId, false, new LangflowClient({}), undefined, true);
            
            expect(mockParseJsonBody).toHaveBeenCalledTimes(1);
            expect(mockParseJsonBody).toHaveBeenCalledWith(req);
            expect(mockFlow.run).toHaveBeenCalledWith(parsedBodyByFunc.message, {
                input_type: 'chat',
                output_type: 'chat',
                session_id: parsedBodyByFunc.sessionId,
            });
        });
    });

    describe('Non-streaming requests', () => {
        it('should return 503 if LangflowClient is not available', async () => {
            await handleChatMessageRequest(req, res, flowId, false, undefined, defaultPreParsedBody, defaultIsBodyPreParsed);
            expect(mockSendJsonError).toHaveBeenCalledWith(res, 503, expect.stringContaining("LangflowClient not available"));
        });

        it('should return 400 if message is not provided in body (via parseJsonBody)', async () => {
            mockParseJsonBody.mockResolvedValueOnce({ sessionId: clientSessionId }); // No message
            await handleChatMessageRequest(req, res, flowId, false, new LangflowClient({}), defaultPreParsedBody, defaultIsBodyPreParsed);
            expect(mockSendJsonError).toHaveBeenCalledWith(res, 400, "Message is required and must be a string.");
        });

        it('should return 400 if message is not provided in body (via preParsedBody)', async () => {
            const preParsedMissingMessage = { sessionId: clientSessionId }; // No message
            await handleChatMessageRequest(req, res, flowId, false, new LangflowClient({}), preParsedMissingMessage, true);
            expect(mockParseJsonBody).not.toHaveBeenCalled(); // Ensure parseJsonBody not called
            expect(mockSendJsonError).toHaveBeenCalledWith(res, 400, "Message is required and must be a string.");
        });

        it('should return 400 if message is not a string (via parseJsonBody)', async () => {
            mockParseJsonBody.mockResolvedValueOnce({ message: 123, sessionId: clientSessionId });
            await handleChatMessageRequest(req, res, flowId, false, new LangflowClient({}), defaultPreParsedBody, defaultIsBodyPreParsed);
            expect(mockSendJsonError).toHaveBeenCalledWith(res, 400, "Message is required and must be a string.");
        });

        it('should return 400 if message is not a string (via preParsedBody)', async () => {
            const preParsedNonStringMessage = { message: 123, sessionId: clientSessionId };
            await handleChatMessageRequest(req, res, flowId, false, new LangflowClient({}), preParsedNonStringMessage, true);
            expect(mockParseJsonBody).not.toHaveBeenCalled();
            expect(mockSendJsonError).toHaveBeenCalledWith(res, 400, "Message is required and must be a string.");
        });
        
        it('should return 400 for invalid JSON body (when parseJsonBody is used)', async () => {
            const error = new Error("Invalid JSON body");
            mockParseJsonBody.mockRejectedValueOnce(error);
            // defaultIsBodyPreParsed is false, so parseJsonBody will be attempted
            await handleChatMessageRequest(req, res, flowId, false, new LangflowClient({}), defaultPreParsedBody, defaultIsBodyPreParsed);
            expect(mockSendJsonError).toHaveBeenCalledWith(res, 400, "Invalid JSON body provided.", error.message);
        });

        it('should call Langflow flow.run with correct parameters for non-streaming request (using parseJsonBody path)', async () => {
            // Relies on default mockParseJsonBody value: { message: userMessage, sessionId: clientSessionId, stream: false }
            await handleChatMessageRequest(req, res, flowId, false, new LangflowClient({}), defaultPreParsedBody, defaultIsBodyPreParsed);
            expect(mockParseJsonBody).toHaveBeenCalledTimes(1);
            expect(mockLangflowInstance.flow).toHaveBeenCalledWith(flowId);
            expect(mockFlow.run).toHaveBeenCalledWith(userMessage, {
                input_type: 'chat',
                output_type: 'chat',
                session_id: clientSessionId,
            });
            expect(res.statusCode).toBe(200);
            expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'application/json');
        });

        it('should call Langflow flow.run without session_id if not provided (parseJsonBody path)', async () => {
            mockParseJsonBody.mockResolvedValueOnce({ message: userMessage, stream: false }); // No sessionId
            await handleChatMessageRequest(req, res, flowId, false, new LangflowClient({}), defaultPreParsedBody, defaultIsBodyPreParsed);
            expect(mockParseJsonBody).toHaveBeenCalledTimes(1);
            expect(mockFlow.run).toHaveBeenCalledWith(userMessage, {
                input_type: 'chat',
                output_type: 'chat',
            });
            expect(mockFlow.run.mock.calls[0][1].session_id).toBeUndefined();
        });
        
        it('should extract reply from primary path (results.message.text) (parseJsonBody path)', async () => {
            const specificResponse = JSON.parse(JSON.stringify(mockLangflowRunResponse));
            mockFlow.run.mockResolvedValueOnce(specificResponse);
            await handleChatMessageRequest(req, res, flowId, false, new LangflowClient({}), defaultPreParsedBody, defaultIsBodyPreParsed);
            const expectedReply = specificResponse.outputs[0].outputs[0].results.message.text;
            expect(res.end).toHaveBeenCalledWith(JSON.stringify({ reply: expectedReply, sessionId: specificResponse.sessionId }));
        });

        it('should extract reply from fallback path (outputs.message.message) (parseJsonBody path)', async () => {
            const specificResponse = JSON.parse(JSON.stringify(mockLangflowRunResponse));
            specificResponse.outputs[0].outputs[0].results.message = null;
            specificResponse.outputs[0].outputs[0].outputs.message.message = "Custom reply from outputs.message.message";
            mockFlow.run.mockResolvedValueOnce(specificResponse);
            await handleChatMessageRequest(req, res, flowId, false, new LangflowClient({}), defaultPreParsedBody, defaultIsBodyPreParsed);
            const expectedReply = specificResponse.outputs[0].outputs[0].outputs.message.message;
            expect(res.end).toHaveBeenCalledWith(JSON.stringify({ reply: expectedReply, sessionId: specificResponse.sessionId }));
        });

        it('should return "Sorry, I could not process that." if no reply found (parseJsonBody path)', async () => {
            const emptyResponse = { sessionId: 'empty-session', outputs: [{ outputs: [{ results: {}, outputs: {}, artifacts: {} }] }] }; 
            mockFlow.run.mockResolvedValueOnce(emptyResponse);
            await handleChatMessageRequest(req, res, flowId, false, new LangflowClient({}), defaultPreParsedBody, defaultIsBodyPreParsed);
            expect(res.end).toHaveBeenCalledWith(JSON.stringify({ reply: "Sorry, I could not process that.", sessionId: 'empty-session' }));
        });

        it('should return whitespace string as-is if reply is only whitespace', async () => {
            const responseWithWhitespaceText = JSON.parse(JSON.stringify(mockLangflowRunResponse));
            // Clear other potential reply paths to ensure this is the one picked up
            responseWithWhitespaceText.outputs[0].outputs[0].outputs = null;
            responseWithWhitespaceText.outputs[0].outputs[0].artifacts = null;
            responseWithWhitespaceText.outputs[0].outputs[0].results.message.text = "   "; // Whitespace string
            mockFlow.run.mockResolvedValueOnce(responseWithWhitespaceText);
        
            await handleChatMessageRequest(req, res, flowId, false, new LangflowClient({}), defaultPreParsedBody, defaultIsBodyPreParsed);
            // expect(res.end).toHaveBeenCalledWith(JSON.stringify({ reply: "Received an empty message from Bot.", sessionId: responseWithWhitespaceText.sessionId }));
            expect(res.end).toHaveBeenCalledWith(JSON.stringify({ reply: "   ", sessionId: responseWithWhitespaceText.sessionId }));
        });

        it('should return "Received an empty message from Bot." if reply is an actual empty string', async () => {
            const responseWithActualEmptyText = JSON.parse(JSON.stringify(mockLangflowRunResponse));
            // Clear other potential reply paths
            responseWithActualEmptyText.outputs[0].outputs[0].outputs = null;
            responseWithActualEmptyText.outputs[0].outputs[0].artifacts = null;
            responseWithActualEmptyText.outputs[0].outputs[0].results.message.text = ""; // Actual empty string
            mockFlow.run.mockResolvedValueOnce(responseWithActualEmptyText);

            await handleChatMessageRequest(req, res, flowId, false, new LangflowClient({}), defaultPreParsedBody, defaultIsBodyPreParsed);
            expect(res.end).toHaveBeenCalledWith(JSON.stringify({ reply: "Received an empty message from Bot.", sessionId: responseWithActualEmptyText.sessionId }));
        });

        it('should extract reply from deep fallback path (e.g., second component, componentOutputs.chat)', async () => {
            const deepFallbackResponse: any = {
                sessionId: "deep-fallback-session",
                outputs: [
                    { // First output component, primary extraction will fail here
                        inputs: { input_value: "hello" },
                        outputs: [
                            { // First inner output, results.message.text and outputs object are missing/empty
                                results: { message: null }, // No .text here
                                outputs: null, // No .outputs.message or .outputs.text here
                                artifacts: null
                            }
                        ]
                    },
                    { // Second output component, where fallback should look
                        inputs: {},
                        outputs: [
                            { // Inner document output of the second component
                                results: { message: { text: "Should not pick this"} }, // make sure primary paths here are not chosen first
                                outputs: { // componentOutputs
                                    chat: "  Deep chat reply  ", // This should be picked (and not trimmed by old logic)
                                    text: "Deep text reply, but chat is first"
                                },
                                artifacts: { message: "Deep artifact reply" }
                            }
                        ]
                    }
                ]
            };
            mockFlow.run.mockResolvedValueOnce(deepFallbackResponse);
            await handleChatMessageRequest(req, res, flowId, false, new LangflowClient({}), defaultPreParsedBody, defaultIsBodyPreParsed);
            expect(res.end).toHaveBeenCalledWith(JSON.stringify({ reply: "  Deep chat reply  ", sessionId: "deep-fallback-session" }));
        });

        it('should extract reply from deep fallback path (componentOutputs.text)', async () => {
            const deepFallbackResponse: any = {
                sessionId: "deep-fallback-session-text",
                outputs: [
                    { outputs: [ { results: {}, outputs: {}, artifacts: {} } ] }, // Primary fails
                    { outputs: [ { results: {}, outputs: { chat: null, text: "Deep text only" }, artifacts: {} } ] } // Fallback finds text
                ]
            };
            mockFlow.run.mockResolvedValueOnce(deepFallbackResponse);
            await handleChatMessageRequest(req, res, flowId, false, new LangflowClient({}), defaultPreParsedBody, defaultIsBodyPreParsed);
            expect(res.end).toHaveBeenCalledWith(JSON.stringify({ reply: "Deep text only", sessionId: "deep-fallback-session-text" }));
        });

        it('should extract reply from deep fallback path (innerDocOutput.results.message.text)', async () => {
            const deepFallbackResponse: any = {
                sessionId: "deep-fallback-session-results",
                outputs: [
                    { outputs: [ { results: {}, outputs: {}, artifacts: {} } ] }, // Primary fails
                    { outputs: [ { results: { message: { text: "Deep results text" } }, outputs: { chat: null, text: null }, artifacts: {} } ] } // Fallback finds results.message.text
                ]
            };
            mockFlow.run.mockResolvedValueOnce(deepFallbackResponse);
            await handleChatMessageRequest(req, res, flowId, false, new LangflowClient({}), defaultPreParsedBody, defaultIsBodyPreParsed);
            expect(res.end).toHaveBeenCalledWith(JSON.stringify({ reply: "Deep results text", sessionId: "deep-fallback-session-results" }));
        });

        it('should extract reply from deep fallback path (innerDocOutput.artifacts.message)', async () => {
            const deepFallbackResponse: any = {
                sessionId: "deep-fallback-session-artifacts",
                outputs: [
                    { outputs: [ { results: {}, outputs: {}, artifacts: {} } ] }, // Primary fails
                    { outputs: [ { results: {}, outputs: {}, artifacts: { message: "Deep artifacts message" } } ] } // Fallback finds artifacts.message
                ]
            };
            mockFlow.run.mockResolvedValueOnce(deepFallbackResponse);
            await handleChatMessageRequest(req, res, flowId, false, new LangflowClient({}), defaultPreParsedBody, defaultIsBodyPreParsed);
            expect(res.end).toHaveBeenCalledWith(JSON.stringify({ reply: "Deep artifacts message", sessionId: "deep-fallback-session-artifacts" }));
        });

        it('should prioritize an empty string from primary innerComponentOutputs.message over default sorry message', async () => {
            const responseWithEmptyPrimary: any = {
                sessionId: "empty-primary-message",
                outputs: [
                    {
                        inputs: { input_value: "hello" },
                        outputs: [
                            {
                                results: { message: null }, 
                                outputs: { 
                                    message: { message: "" }, // Empty string here
                                    text: "Some other text"
                                },
                                artifacts: null
                            }
                        ]
                    }
                ]
            };
            mockFlow.run.mockResolvedValueOnce(responseWithEmptyPrimary);
            await handleChatMessageRequest(req, res, flowId, false, new LangflowClient({}), defaultPreParsedBody, defaultIsBodyPreParsed);
            expect(res.end).toHaveBeenCalledWith(JSON.stringify({ reply: "Received an empty message from Bot.", sessionId: "empty-primary-message" }));
        });

        it('should prioritize an empty string from primary innerComponentOutputs.text over default sorry message', async () => {
            const responseWithEmptyPrimary: any = {
                sessionId: "empty-primary-text",
                outputs: [
                    {
                        inputs: { input_value: "hello" },
                        outputs: [
                            {
                                results: { message: null }, 
                                outputs: { 
                                    message: null, // No message object
                                    text: "" // Empty string here
                                },
                                artifacts: null
                            }
                        ]
                    }
                ]
            };
            mockFlow.run.mockResolvedValueOnce(responseWithEmptyPrimary);
            await handleChatMessageRequest(req, res, flowId, false, new LangflowClient({}), defaultPreParsedBody, defaultIsBodyPreParsed);
            expect(res.end).toHaveBeenCalledWith(JSON.stringify({ reply: "Received an empty message from Bot.", sessionId: "empty-primary-text" }));
        });

        it('should prioritize an empty string from deep fallback componentOutputs.chat', async () => {
            const deepFallbackEmptyChat: any = {
                sessionId: "deep-empty-chat",
                outputs: [
                    { outputs: [ { results: {}, outputs: {}, artifacts: {} } ] }, // Primary fails
                    { outputs: [ { results: {}, outputs: { chat: "", text: "Not this" }, artifacts: {} } ] } // Fallback finds empty chat
                ]
            };
            mockFlow.run.mockResolvedValueOnce(deepFallbackEmptyChat);
            await handleChatMessageRequest(req, res, flowId, false, new LangflowClient({}), defaultPreParsedBody, defaultIsBodyPreParsed);
            expect(res.end).toHaveBeenCalledWith(JSON.stringify({ reply: "Received an empty message from Bot.", sessionId: "deep-empty-chat" }));
        });

        it('should prioritize an empty string from deep fallback innerDocOutput.artifacts.message', async () => {
            const deepFallbackEmptyArtifact: any = {
                sessionId: "deep-empty-artifact",
                outputs: [
                    { outputs: [ { results: {}, outputs: {}, artifacts: {} } ] }, // Primary fails
                    { outputs: [ { results: {}, outputs: { chat: null, text: null}, artifacts: { message: "" } } ] } // Fallback finds empty artifact
                ]
            };
            mockFlow.run.mockResolvedValueOnce(deepFallbackEmptyArtifact);
            await handleChatMessageRequest(req, res, flowId, false, new LangflowClient({}), defaultPreParsedBody, defaultIsBodyPreParsed);
            expect(res.end).toHaveBeenCalledWith(JSON.stringify({ reply: "Received an empty message from Bot.", sessionId: "deep-empty-artifact" }));
        });

        it('should prioritize an empty string from deep fallback componentOutputs.message.message', async () => {
            const deepFallbackEmptyMsg: any = {
                sessionId: "deep-empty-msg-msg",
                outputs: [
                    { outputs: [ { results: {}, outputs: {}, artifacts: {} } ] }, // Primary fails
                    { outputs: [ { results: {}, outputs: { chat: null, text: null, message: { message: "" } }, artifacts: {} } ] } // Fallback finds empty message.message
                ]
            };
            mockFlow.run.mockResolvedValueOnce(deepFallbackEmptyMsg);
            await handleChatMessageRequest(req, res, flowId, false, new LangflowClient({}), defaultPreParsedBody, defaultIsBodyPreParsed);
            expect(res.end).toHaveBeenCalledWith(JSON.stringify({ reply: "Received an empty message from Bot.", sessionId: "deep-empty-msg-msg" }));
        });

        it('should use clientSessionId if langflowResponse.sessionId is missing', async () => {
            const responseWithoutSessionId = JSON.parse(JSON.stringify(mockLangflowRunResponse));
            delete responseWithoutSessionId.sessionId;
            mockFlow.run.mockResolvedValueOnce(responseWithoutSessionId);

            await handleChatMessageRequest(req, res, flowId, false, new LangflowClient({}), defaultPreParsedBody, defaultIsBodyPreParsed);
            const expectedReply = responseWithoutSessionId.outputs[0].outputs[0].results.message.text;
            expect(res.end).toHaveBeenCalledWith(JSON.stringify({ reply: expectedReply, sessionId: clientSessionId }));
        });
        
        it('should handle general error during flow.run', async () => {
            const error = new Error("Langflow run failed");
            mockFlow.run.mockRejectedValueOnce(error);
            // Ensure headersSent is false for this test, so sendJsonError is called
            Object.defineProperty(res, 'headersSent', { value: false, configurable: true }); 
            await handleChatMessageRequest(req, res, flowId, false, new LangflowClient({}), defaultPreParsedBody, defaultIsBodyPreParsed);
            expect(mockSendJsonError).toHaveBeenCalledWith(res, 500, "Failed to process chat message.", error.message);
        });

        it('should handle error during flow.run and not send error if headers already sent', async () => {
            const error = new Error("Langflow run failed");
            mockFlow.run.mockRejectedValueOnce(error);
            Object.defineProperty(res, 'headersSent', { value: true, configurable: true });
            await handleChatMessageRequest(req, res, flowId, false, new LangflowClient({}), defaultPreParsedBody, defaultIsBodyPreParsed);
            expect(mockSendJsonError).not.toHaveBeenCalled();
            expect(res.end).toHaveBeenCalled(); // Should still try to end the response
        });
         it('should correctly log non-streaming request without session ID', async () => {
            const consoleSpy = jest.spyOn(console, 'log');
            mockParseJsonBody.mockResolvedValueOnce({ message: userMessage, stream: false }); // No sessionId
            await handleChatMessageRequest(req, res, flowId, false, new LangflowClient({}), defaultPreParsedBody, defaultIsBodyPreParsed);
            expect(consoleSpy).toHaveBeenCalledWith(
                expect.stringContaining(`RequestHandler: Non-streaming request for Flow '${flowId}'`)
            );
            expect(consoleSpy).toHaveBeenCalledWith(
                expect.stringContaining(`input_type: chat, message: "${userMessage.substring(0,50)}..."`)
            );
             expect(consoleSpy.mock.calls.find(call => call[0].includes(clientSessionId))).toBeUndefined();
            consoleSpy.mockRestore();
        });

        it('should correctly log non-streaming request with session ID', async () => {
            const consoleSpy = jest.spyOn(console, 'log');
            await handleChatMessageRequest(req, res, flowId, false, new LangflowClient({}), defaultPreParsedBody, defaultIsBodyPreParsed);
            expect(consoleSpy).toHaveBeenCalledWith(
                expect.stringContaining(`RequestHandler: Non-streaming request for Flow '${flowId}', session: ${clientSessionId}`)
            );
            consoleSpy.mockRestore();
        });
    });

    // More tests for streaming requests will be added here
    describe('Streaming requests', () => {
        const mockStreamEvents = [
            { event: "add_message", data: { text: "hello user" } },
            { event: "token", data: { chunk: "Hel" } },
            { event: "token", data: { chunk: "lo " } },
            { event: "token", data: { chunk: "World" } },
            { event: "end", data: { result: { outputs: [] } } },
        ];

        async function* mockStreamGenerator(events: any[]) {
            for (const event of events) {
                yield event;
            }
        }

        beforeEach(() => {
            // Ensure `stream: true` is part of the parsed body for streaming tests
            mockParseJsonBody.mockResolvedValue({ message: userMessage, sessionId: clientSessionId, stream: true });
            mockFlow.stream.mockImplementation(() => mockStreamGenerator(mockStreamEvents));
        });

        it('should set correct headers for streaming response', async () => {
            await handleChatMessageRequest(req, res, flowId, true, new LangflowClient({}), defaultPreParsedBody, defaultIsBodyPreParsed);
            expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'application/x-ndjson');
            expect(res.setHeader).toHaveBeenCalledWith('Transfer-Encoding', 'chunked');
        });

        it('should call Langflow flow.stream with correct parameters', async () => {
            await handleChatMessageRequest(req, res, flowId, true, new LangflowClient({}), defaultPreParsedBody, defaultIsBodyPreParsed);
            expect(mockLangflowInstance.flow).toHaveBeenCalledWith(flowId);
            expect(mockFlow.stream).toHaveBeenCalledWith(userMessage, {
                input_type: 'chat',
                output_type: 'chat',
                session_id: clientSessionId,
            });
        });

        it('should write each event from the stream to the response', async () => {
            await handleChatMessageRequest(req, res, flowId, true, new LangflowClient({}), defaultPreParsedBody, defaultIsBodyPreParsed);
            for (const event of mockStreamEvents) {
                expect(res.write).toHaveBeenCalledWith(JSON.stringify(event) + '\n');
            }
            expect(res.end).toHaveBeenCalled();
        });
        
        it('should correctly log streaming request with session ID', async () => {
            const consoleSpy = jest.spyOn(console, 'log');
            await handleChatMessageRequest(req, res, flowId, true, new LangflowClient({}), defaultPreParsedBody, defaultIsBodyPreParsed);
            expect(consoleSpy).toHaveBeenCalledWith(
                `RequestHandler: Streaming request for Flow '${flowId}', session: ${clientSessionId}, message: "${userMessage.substring(0, 50)}..."`
            );
            consoleSpy.mockRestore();
        });

        it('should correctly log streaming request without session ID', async () => {
            const consoleSpy = jest.spyOn(console, 'log');
            mockParseJsonBody.mockResolvedValueOnce({ message: userMessage, stream: true }); // No sessionId
            await handleChatMessageRequest(req, res, flowId, true, new LangflowClient({}), defaultPreParsedBody, defaultIsBodyPreParsed);
            expect(consoleSpy).toHaveBeenCalledWith(
                `RequestHandler: Streaming request for Flow '${flowId}', session: new, message: "${userMessage.substring(0, 50)}..."`
            );
            consoleSpy.mockRestore();
        });
        
        it('should not stream if enableStream is false, even if client requests it', async () => {
            mockParseJsonBody.mockResolvedValue({ message: userMessage, sessionId: clientSessionId, stream: true });
            mockFlow.run.mockResolvedValue(JSON.parse(JSON.stringify(mockLangflowRunResponse)));
            
            await handleChatMessageRequest(req, res, flowId, false, new LangflowClient({}), defaultPreParsedBody, defaultIsBodyPreParsed); // enableStream is false

            expect(mockFlow.stream).not.toHaveBeenCalled();
            expect(mockFlow.run).toHaveBeenCalled(); // Should fall back to non-streaming
            expect(res.setHeader).not.toHaveBeenCalledWith('Content-Type', 'application/x-ndjson');
            const expectedReply = mockLangflowRunResponse.outputs[0].outputs[0].results.message.text;
            expect(res.end).toHaveBeenCalledWith(JSON.stringify({ reply: expectedReply, sessionId: mockLangflowRunResponse.sessionId }));
        });

        it('should handle error during stream setup (before headersSent)', async () => {
            const streamError = new Error("Stream setup failed");
            mockFlow.stream.mockRejectedValueOnce(streamError);
            Object.defineProperty(res, 'headersSent', { value: false, configurable: true });

            await handleChatMessageRequest(req, res, flowId, true, new LangflowClient({}), defaultPreParsedBody, defaultIsBodyPreParsed);

            expect(mockSendJsonError).toHaveBeenCalledWith(res, 500, "Failed to process stream.", streamError.message);
            expect(res.write).not.toHaveBeenCalled();
            expect(res.end).not.toHaveBeenCalled(); // sendJsonError should handle ending the response
        });

        it('should handle error during streaming (after headersSent)', async () => {
            const streamError = new Error("Mid-stream error");
            async function* errorStreamGenerator() {
                yield mockStreamEvents[0];
                throw streamError;
            }
            mockFlow.stream.mockImplementationOnce(() => errorStreamGenerator());
            Object.defineProperty(res, 'headersSent', { value: true, configurable: true }); // Simulate headers are sent after first write

            await handleChatMessageRequest(req, res, flowId, true, new LangflowClient({}), defaultPreParsedBody, defaultIsBodyPreParsed);

            expect(mockSendJsonError).not.toHaveBeenCalled(); // Should not call sendJsonError if headers are sent
            expect(res.write).toHaveBeenCalledWith(JSON.stringify(mockStreamEvents[0]) + '\n');
            expect(res.write).toHaveBeenCalledWith(JSON.stringify({ event: 'error', data: { message: "Error during streaming.", detail: streamError.message } }) + '\n');
            expect(res.end).toHaveBeenCalled();
        });
        
        it('should handle stream error with unknown message if streamError.message is undefined', async () => {
            const streamError = new Error(); // No message
            (streamError as any).message = undefined;
            async function* errorStreamGenerator() {
                yield mockStreamEvents[0];
                throw streamError;
            }
            mockFlow.stream.mockImplementationOnce(() => errorStreamGenerator());
            Object.defineProperty(res, 'headersSent', { value: true, configurable: true });

            await handleChatMessageRequest(req, res, flowId, true, new LangflowClient({}), defaultPreParsedBody, defaultIsBodyPreParsed);
            expect(res.write).toHaveBeenCalledWith(JSON.stringify({ event: 'error', data: { message: "Error during streaming.", detail: 'Unknown error on stream' } }) + '\n');
            expect(res.end).toHaveBeenCalled();
        });
         it('should handle stream setup error with unknown message if streamError.message is undefined and headers not sent', async () => {
            const streamError = new Error();
            (streamError as any).message = undefined;
            mockFlow.stream.mockRejectedValueOnce(streamError);
            Object.defineProperty(res, 'headersSent', { value: false, configurable: true });

            await handleChatMessageRequest(req, res, flowId, true, new LangflowClient({}), defaultPreParsedBody, defaultIsBodyPreParsed);

            expect(mockSendJsonError).toHaveBeenCalledWith(res, 500, "Failed to process stream.", 'Unknown stream error');
        });

    });

});

describe('extractReplyFromLangflowResponse (direct tests if needed, though covered by handler tests)', () => {
    // Minimal tests for direct invocation if complex logic isn't fully covered above
    // This function is largely tested via handleChatMessageRequest tests for non-streaming cases.
    // Adding a specific test for an edge case like completely empty or malformed langflowResponse.
    it('should return default message for null or undefined response', () => {
        // Accessing the exported function directly would require it to be exported from chatHandlers.ts
        // For now, this logic is tested via the handleChatMessageRequest tests.
        // If we export extractReplyFromLangflowResponse, we can test it directly:
        // expect(extractReplyFromLangflowResponse(null)).toBe("Sorry, I could not process that.");
        // expect(extractReplyFromLangflowResponse(undefined)).toBe("Sorry, I could not process that.");
        // expect(extractReplyFromLangflowResponse({})).toBe("Sorry, I could not process that.");
        // expect(extractReplyFromLangflowResponse({ outputs: [] })).toBe("Sorry, I could not process that.");
    });
}); 