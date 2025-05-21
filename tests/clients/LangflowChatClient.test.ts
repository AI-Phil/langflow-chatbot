/** @jest-environment jsdom */

import { TextDecoder, TextEncoder } from 'util';
import { LangflowChatClient, BotResponse, StreamEvent, ChatMessageData } from '../../src/clients/LangflowChatClient';
import { Logger } from '../../src/utils/logger';
import { PROXY_BASE_API_PATH, PROXY_CHAT_MESSAGES_ENDPOINT_PREFIX } from '../../src/config/apiPaths';

// Polyfill TextDecoder/TextEncoder if not present in JSDOM
if (typeof global.TextDecoder === 'undefined') {
  (global as any).TextDecoder = TextDecoder;
}
if (typeof global.TextEncoder === 'undefined') {
  (global as any).TextEncoder = TextEncoder;
}

// Mock global fetch
global.fetch = jest.fn();

// Mock crypto.randomUUID
const mockUUID = '123e4567-e89b-12d3-a456-426614174000';
if (!(global as any).crypto) {
  (global as any).crypto = {};
}
const randomUUIDMock = jest.fn(() => mockUUID);
(global.crypto as any).randomUUID = randomUUIDMock;

// Mock Logger
const mockLoggerInstance = {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
    setLogLevel: jest.fn(),
    getLogLevel: jest.fn(() => 'info'),
};
jest.mock('../../src/utils/logger', () => {
    return {
        Logger: jest.fn().mockImplementation(() => mockLoggerInstance)
    };
});

describe('LangflowChatClient', () => {
    const profileId = 'test-flow';
    const customBaseApiUrl = 'http://custom.api';
    let client: LangflowChatClient;

    beforeEach(() => {
        // Reset mocks before each test
        jest.clearAllMocks();
        // (fetch as jest.Mock).mockClear(); // Redundant due to jest.clearAllMocks()
        // randomUUIDMock.mockClear(); // Redundant due to jest.clearAllMocks()
        
        // Re-initialize client for each test to ensure clean state
        client = new LangflowChatClient(profileId);
    });

    describe('constructor', () => {
        it('should throw an error if profileId is empty', () => {
            expect(() => new LangflowChatClient('')).toThrow("profileId is required and cannot be empty.");
        });

        it('should throw an error if profileId is whitespace', () => {
            expect(() => new LangflowChatClient('   ')).toThrow("profileId is required and cannot be empty.");
        });

        it('should initialize with default baseApiUrl and new Logger if not provided', () => {
            const newClient = new LangflowChatClient(profileId);
            expect(newClient['baseApiUrl']).toBe(PROXY_BASE_API_PATH);
            expect(newClient['chatEndpoint']).toBe(`${PROXY_BASE_API_PATH}${PROXY_CHAT_MESSAGES_ENDPOINT_PREFIX}/${profileId}`);
            expect(newClient['historyEndpoint']).toBe(`${PROXY_BASE_API_PATH}${PROXY_CHAT_MESSAGES_ENDPOINT_PREFIX}/${profileId}/history`);
            expect(Logger).toHaveBeenCalledWith('info', 'LangflowChatClient');
            expect(newClient['logger']).toBe(mockLoggerInstance);
        });

        it('should initialize with provided baseApiUrl and remove trailing slash', () => {
            const newClient = new LangflowChatClient(profileId, `${customBaseApiUrl}/`);
            expect(newClient['baseApiUrl']).toBe(customBaseApiUrl);
            expect(newClient['chatEndpoint']).toBe(`${customBaseApiUrl}${PROXY_CHAT_MESSAGES_ENDPOINT_PREFIX}/${profileId}`);
            expect(newClient['historyEndpoint']).toBe(`${customBaseApiUrl}${PROXY_CHAT_MESSAGES_ENDPOINT_PREFIX}/${profileId}/history`);
        });

        it('should initialize with provided logger', () => {
            const customLogger = new Logger('debug');
            const newClient = new LangflowChatClient(profileId, undefined, customLogger);
            expect(newClient['logger']).toBe(customLogger);
        });
    });

    describe('generateSessionId', () => {
        it('should return a UUID', () => {
            (randomUUIDMock as jest.Mock).mockReturnValue('specific-uuid');
            const sessionId = client['generateSessionId']();
            expect(sessionId).toBe('specific-uuid');
            expect(randomUUIDMock).toHaveBeenCalledTimes(1);
        });
    });

    describe('sendMessage', () => {
        const message = "Hello Langflow";
        const mockBotResponse: BotResponse = { reply: "Hi there!", sessionId: mockUUID };

        it('should send a message and return BotResponse with a new sessionId if none provided', async () => {
            (fetch as jest.Mock).mockResolvedValueOnce({
                ok: true,
                json: async () => mockBotResponse,
            });
            (randomUUIDMock as jest.Mock).mockReturnValueOnce(mockUUID);

            const response = await client.sendMessage(message);

            expect(fetch).toHaveBeenCalledTimes(1);
            expect(fetch).toHaveBeenCalledWith(
                client['chatEndpoint'],
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ message, sessionId: mockUUID, stream: false }),
                }
            );
            expect(response).toEqual(mockBotResponse);
            expect(randomUUIDMock).toHaveBeenCalledTimes(1);
            expect(mockLoggerInstance.error).not.toHaveBeenCalled();
        });

        it('should send a message and return BotResponse with the provided sessionId', async () => {
            const existingSessionId = 'existing-session-id-5678';
            const botResponseWithExistingSessionId = { ...mockBotResponse, sessionId: existingSessionId };
            (fetch as jest.Mock).mockResolvedValueOnce({
                ok: true,
                json: async () => botResponseWithExistingSessionId,
            });

            const response = await client.sendMessage(message, existingSessionId);

            expect(fetch).toHaveBeenCalledTimes(1);
            expect(fetch).toHaveBeenCalledWith(
                client['chatEndpoint'],
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ message, sessionId: existingSessionId, stream: false }),
                }
            );
            expect(response).toEqual(botResponseWithExistingSessionId);
            expect(randomUUIDMock).not.toHaveBeenCalled();
            expect(mockLoggerInstance.error).not.toHaveBeenCalled();
        });

        it('should handle API error with JSON response', async () => {
            const errorResponse = { error: "API Error", detail: "Something went wrong", sessionId: mockUUID };
            (fetch as jest.Mock).mockResolvedValueOnce({
                ok: false,
                status: 500,
                statusText: "Internal Server Error",
                json: async () => errorResponse,
            });
            (randomUUIDMock as jest.Mock).mockReturnValueOnce(mockUUID);

            const response = await client.sendMessage(message);

            expect(response.error).toBe("API Error");
            expect(response.detail).toBe("Something went wrong");
            expect(response.sessionId).toBe(mockUUID);
            expect(mockLoggerInstance.error).toHaveBeenCalledWith("API Error:", 500, errorResponse);
        });

        it('should handle API error with non-JSON response', async () => {
            (fetch as jest.Mock).mockResolvedValueOnce({
                ok: false,
                status: 404,
                statusText: "Not Found",
                json: async () => { throw new Error('Not JSON'); }, // Simulate non-JSON response
            });
            (randomUUIDMock as jest.Mock).mockReturnValueOnce(mockUUID);

            const response = await client.sendMessage(message);

            expect(response.error).toBe("API request failed with status 404");
            expect(response.detail).toBeUndefined();
            expect(response.sessionId).toBe(mockUUID);
            expect(mockLoggerInstance.error).toHaveBeenCalledWith("API Error:", 404, { error: 'API request failed with status 404' });
        });

        it('should handle API error where response.json() also fails for ok:false', async () => {
            (fetch as jest.Mock).mockResolvedValueOnce({
                ok: false,
                status: 503,
                statusText: "Service Unavailable",
                json: jest.fn().mockRejectedValueOnce(new Error("Failed to parse error JSON")),
            });
            (randomUUIDMock as jest.Mock).mockReturnValueOnce(mockUUID);

            const response = await client.sendMessage(message);

            expect(response.error).toBe("API request failed with status 503");
            expect(response.detail).toBeUndefined();
            expect(response.sessionId).toBe(mockUUID);
            expect(mockLoggerInstance.error).toHaveBeenCalledWith("API Error:", 503, { error: "API request failed with status 503" });
        });

        it('should handle network error (fetch throws)', async () => {
            const networkError = new Error("Network connection lost");
            (fetch as jest.Mock).mockRejectedValueOnce(networkError);
            (randomUUIDMock as jest.Mock).mockReturnValueOnce(mockUUID);

            const response = await client.sendMessage(message);

            expect(response.error).toBe("Network error or invalid response from server.");
            expect(response.detail).toBe("Network connection lost");
            expect(response.sessionId).toBe(mockUUID);
            expect(mockLoggerInstance.error).toHaveBeenCalledWith("Failed to send message or parse response:", networkError);
        });

        it('should ensure sessionId is included in response even if API does not return it', async () => {
            const apiResponseWithoutSessionId = { reply: "Hello" }; // No sessionId here
            (fetch as jest.Mock).mockResolvedValueOnce({
                ok: true,
                json: async () => apiResponseWithoutSessionId,
            });
            (randomUUIDMock as jest.Mock).mockReturnValueOnce(mockUUID);

            const response = await client.sendMessage(message);
            expect(response.sessionId).toBe(mockUUID);
        });
    });

    describe('streamMessage', () => {
        const message = "Stream this message";
        const mockStreamSessionId = 'stream-session-id-9012';

        // Helper to simulate ReadableStream with NDJSON
        const mockReadableStream = (lines: string[], options?: { simulateDoneError?: boolean }) => {
            let lineIndex = 0;
            return {
                getReader: () => ({
                    read: jest.fn(async () => {
                        if (lineIndex < lines.length) {
                            const line = lines[lineIndex++];
                            return { done: false, value: new TextEncoder().encode(line + '\n') };
                        }
                        if (options?.simulateDoneError) { // for testing the final decoder.decode() without {stream: true}
                            return { done: true, value: new TextEncoder().encode('some final bytes') };
                        }
                        return { done: true, value: undefined };
                    })
                })
            };
        };

        const mockReadableStreamWithPartialLastLine = (lines: string[], partialLastLine: string) => {
            let lineIndex = 0;
            let sentPartial = false;
            return {
                getReader: () => ({
                    read: jest.fn(async () => {
                        if (lineIndex < lines.length) {
                            const line = lines[lineIndex++];
                            return { done: false, value: new TextEncoder().encode(line + '\n') };
                        }
                        if (!sentPartial && partialLastLine) {
                            sentPartial = true;
                            return { done: false, value: new TextEncoder().encode(partialLastLine) };
                        }
                        return { done: true, value: undefined };
                    })
                })
            };
        };

        it('should yield stream_started, token, and end events successfully with a new sessionId', async () => {
            const streamEvents: StreamEvent[] = [
                { event: 'token', data: { chunk: 'Hello' } },
                { event: 'end', data: { flowResponse: { reply: 'Hello World' } } }
            ];
            const ndjsonLines = streamEvents.map(event => JSON.stringify(event));

            (fetch as jest.Mock).mockResolvedValueOnce({
                ok: true,
                body: mockReadableStream(ndjsonLines),
                headers: new Headers({ 'Content-Type': 'application/x-ndjson' }),
            });
            (randomUUIDMock as jest.Mock).mockReturnValueOnce(mockStreamSessionId);

            const collectedEvents: StreamEvent[] = [];
            for await (const event of client.streamMessage(message)) {
                collectedEvents.push(event);
            }

            expect(randomUUIDMock).toHaveBeenCalledTimes(1);
            expect(fetch).toHaveBeenCalledWith(
                client['chatEndpoint'],
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Accept': 'application/x-ndjson' },
                    body: JSON.stringify({ message, sessionId: mockStreamSessionId, stream: true }),
                }
            );
            expect(collectedEvents.length).toBe(3);
            expect(collectedEvents[0]).toEqual({ event: 'stream_started', data: { sessionId: mockStreamSessionId } });
            expect(collectedEvents[1]).toEqual(streamEvents[0]);
            // End event should have sessionId injected
            expect(collectedEvents[2].event).toEqual('end');
            expect((collectedEvents[2].data as any).flowResponse.sessionId).toEqual(mockStreamSessionId);
            expect(mockLoggerInstance.error).not.toHaveBeenCalled();
        });

        it('should use provided sessionId and yield events', async () => {
            const existingSessionId = 'existing-stream-session-4321';
            const streamEvents: StreamEvent[] = [
                { event: 'token', data: { chunk: 'Test' } },
                { event: 'end', data: { flowResponse: { reply: 'Test Complete' } } }
            ];
            const ndjsonLines = streamEvents.map(event => JSON.stringify(event));

            (fetch as jest.Mock).mockResolvedValueOnce({
                ok: true,
                body: mockReadableStream(ndjsonLines),
                headers: new Headers({ 'Content-Type': 'application/x-ndjson' }),
            });

            const collectedEvents: StreamEvent[] = [];
            for await (const event of client.streamMessage(message, existingSessionId)) {
                collectedEvents.push(event);
            }

            expect(randomUUIDMock).not.toHaveBeenCalled();
            expect(fetch).toHaveBeenCalledWith(
                client['chatEndpoint'],
                expect.objectContaining({
                    body: JSON.stringify({ message, sessionId: existingSessionId, stream: true }),
                })
            );
            expect(collectedEvents.length).toBe(3);
            expect(collectedEvents[0]).toEqual({ event: 'stream_started', data: { sessionId: existingSessionId } });
            expect(collectedEvents[1]).toEqual(streamEvents[0]);
            expect((collectedEvents[2].data as any).flowResponse.sessionId).toEqual(existingSessionId);
        });

        it('should handle API error (non-ok response) with JSON error details', async () => {
            const errorResponse = { error: "Stream Setup Failed", detail: "Auth error", sessionId: mockStreamSessionId };
            (fetch as jest.Mock).mockResolvedValueOnce({
                ok: false,
                status: 401,
                statusText: "Unauthorized",
                json: async () => errorResponse,
            });
            (randomUUIDMock as jest.Mock).mockReturnValueOnce(mockStreamSessionId);

            const collectedEvents: StreamEvent[] = [];
            for await (const event of client.streamMessage(message)) {
                collectedEvents.push(event);
            }

            expect(collectedEvents.length).toBe(2); // stream_started, error
            expect(collectedEvents[0]).toEqual({ event: 'stream_started', data: { sessionId: mockStreamSessionId } });
            expect(collectedEvents[1].event).toBe('error');
            expect((collectedEvents[1].data as any).message).toBe("Stream Setup Failed");
            expect((collectedEvents[1].data as any).detail).toBe("Auth error");
            expect((collectedEvents[1].data as any).code).toBe(401);
            expect((collectedEvents[1].data as any).sessionId).toBe(mockStreamSessionId);
            expect(mockLoggerInstance.error).toHaveBeenCalledWith("API Stream Error:", 401, errorResponse);
        });

        it('should handle API error (non-ok response) with non-JSON error details', async () => {
            (fetch as jest.Mock).mockResolvedValueOnce({
                ok: false,
                status: 500,
                statusText: "Server Error",
                json: async () => { throw new Error('Not JSON'); },
            });
            (randomUUIDMock as jest.Mock).mockReturnValueOnce(mockStreamSessionId);

            const collectedEvents: StreamEvent[] = [];
            for await (const event of client.streamMessage(message)) {
                collectedEvents.push(event);
            }

            expect(collectedEvents.length).toBe(2);
            expect(collectedEvents[0]).toEqual({ event: 'stream_started', data: { sessionId: mockStreamSessionId } });
            expect(collectedEvents[1].event).toBe('error');
            expect((collectedEvents[1].data as any).message).toBe('API request failed with status 500');
            expect((collectedEvents[1].data as any).detail).toBe("Server Error");
            expect((collectedEvents[1].data as any).sessionId).toBe(mockStreamSessionId);
            expect(mockLoggerInstance.error).toHaveBeenCalled();
        });

        it('should yield an error event if response body is null', async () => {
            (fetch as jest.Mock).mockResolvedValueOnce({
                ok: true,
                body: null, // Simulate null body
            });
            (randomUUIDMock as jest.Mock).mockReturnValueOnce(mockStreamSessionId);

            const collectedEvents: StreamEvent[] = [];
            for await (const event of client.streamMessage(message)) {
                collectedEvents.push(event);
            }

            expect(collectedEvents.length).toBe(2); // stream_started, error
            expect(collectedEvents[1].event).toBe('error');
            expect((collectedEvents[1].data as any).message).toBe("Response body is null");
            expect((collectedEvents[1].data as any).sessionId).toBe(mockStreamSessionId);
            expect(mockLoggerInstance.error).toHaveBeenCalledWith("Response body is null");
        });

        it('should handle parsing errors for individual lines and continue processing', async () => {
            const validEvent = { event: 'token', data: { chunk: 'Good data' } };
            const ndjsonLines = [
                JSON.stringify(validEvent),
                "this is not json",
                JSON.stringify({ event: 'end', data: { flowResponse: { reply: 'Finished' } } }),
            ];

            (fetch as jest.Mock).mockResolvedValueOnce({
                ok: true,
                body: mockReadableStream(ndjsonLines),
            });
            (randomUUIDMock as jest.Mock).mockReturnValueOnce(mockStreamSessionId);

            const collectedEvents: StreamEvent[] = [];
            for await (const event of client.streamMessage(message)) {
                collectedEvents.push(event);
            }

            expect(collectedEvents.length).toBe(4); // stream_started, token, error, end
            expect(collectedEvents[1]).toEqual(validEvent);
            expect(collectedEvents[2].event).toBe('error');
            expect((collectedEvents[2].data as any).message).toBe('Failed to parse JSON line');
            expect((collectedEvents[2].data as any).sessionId).toBe(mockStreamSessionId);
            expect((collectedEvents[3].data as any).flowResponse.sessionId).toBe(mockStreamSessionId);
            expect(mockLoggerInstance.error).toHaveBeenCalledWith("[Stream] Error parsing line:", JSON.stringify("this is not json"), expect.any(Error));
        });

        it('should handle general network error (fetch throws)', async () => {
            const networkError = new Error("Connection Refused");
            (fetch as jest.Mock).mockRejectedValueOnce(networkError);
            (randomUUIDMock as jest.Mock).mockReturnValueOnce(mockStreamSessionId);

            const collectedEvents: StreamEvent[] = [];
            for await (const event of client.streamMessage(message)) {
                collectedEvents.push(event);
            }

            expect(collectedEvents.length).toBe(2); // stream_started, error
            expect(collectedEvents[1].event).toBe('error');
            expect((collectedEvents[1].data as any).message).toBe("General stream error");
            expect((collectedEvents[1].data as any).detail).toBe("Connection Refused");
            expect((collectedEvents[1].data as any).sessionId).toBe(mockStreamSessionId);
            expect(mockLoggerInstance.error).toHaveBeenCalledWith("General stream error:", networkError);
        });

        it('should correctly process multiple JSON objects in a single chunk', async () => {
            const event1 = { event: 'token', data: { chunk: 'chunk1' } };
            const event2 = { event: 'add_message', data: { message: 'message1' } };
            const singleChunk = JSON.stringify(event1) + '\n' + JSON.stringify(event2);

            (fetch as jest.Mock).mockResolvedValueOnce({
                ok: true,
                body: mockReadableStream([singleChunk]), // Note: mockReadableStream adds a newline
            });
            (randomUUIDMock as jest.Mock).mockReturnValueOnce(mockStreamSessionId);

            const collectedEvents: StreamEvent[] = [];
            for await (const event of client.streamMessage(message)) {
                collectedEvents.push(event);
            }

            expect(collectedEvents.length).toBe(3); // stream_started, event1, event2
            expect(collectedEvents[1]).toEqual(event1);
            expect(collectedEvents[2]).toEqual(event2);
        });

        it('should correctly process JSON object spanning multiple chunks', async () => {
            const event = { event: 'token', data: { chunk: 'long chunk data' } };
            const jsonEvent = JSON.stringify(event);
            const part1 = jsonEvent.substring(0, 10);
            const part2 = jsonEvent.substring(10);

            // Custom mock stream for this specific test
            const customStream = {
                getReader: () => {
                    let calls = 0;
                    return {
                        read: jest.fn(async () => {
                            calls++;
                            if (calls === 1) return { done: false, value: new TextEncoder().encode(part1) };
                            if (calls === 2) return { done: false, value: new TextEncoder().encode(part2 + '\n') };
                            return { done: true, value: undefined };
                        }),
                    };
                }
            };

            (fetch as jest.Mock).mockReset(); // Reset fetch mock for new setup
            (fetch as jest.Mock).mockResolvedValueOnce({
                ok: true,
                body: customStream, // Using the custom stream
                headers: new Headers({ 'Content-Type': 'application/x-ndjson' }),
            });
            (randomUUIDMock as jest.Mock).mockClear();
            (randomUUIDMock as jest.Mock).mockReturnValueOnce(mockStreamSessionId);
            
            const collectedEvents: StreamEvent[] = []; // Reset collected events
            for await (const evt of client.streamMessage(message)) {
                collectedEvents.push(evt);
            }

            expect(collectedEvents.length).toBe(2); // stream_started, event
            expect(collectedEvents[1]).toEqual(event);
        });

        it('should process remaining buffer content after stream is done', async () => {
            const event = { event: 'token', data: { chunk: 'final chunk data' } };
            const jsonEvent = JSON.stringify(event); // No newline at the end

            (fetch as jest.Mock).mockResolvedValueOnce({
                ok: true,
                body: mockReadableStreamWithPartialLastLine([], jsonEvent), // Send as a partial line that becomes the final buffer
            });
            (randomUUIDMock as jest.Mock).mockReturnValueOnce(mockStreamSessionId);

            const collectedEvents: StreamEvent[] = [];
            for await (const ev of client.streamMessage(message)) {
                collectedEvents.push(ev);
            }

            expect(collectedEvents.length).toBe(2); // stream_started, event
            expect(collectedEvents[1]).toEqual(event);
        });

        it('should handle parsing error in remaining buffer content', async () => {
            const invalidJsonSuffix = "not valid json at end" ;
            (fetch as jest.Mock).mockResolvedValueOnce({
                ok: true,
                body: mockReadableStreamWithPartialLastLine([], invalidJsonSuffix),
            });
            (randomUUIDMock as jest.Mock).mockReturnValueOnce(mockStreamSessionId);

            const collectedEvents: StreamEvent[] = [];
            for await (const event of client.streamMessage(message)) {
                collectedEvents.push(event);
            }

            expect(collectedEvents.length).toBe(2); // stream_started, error
            expect(collectedEvents[1].event).toBe('error');
            expect((collectedEvents[1].data as any).message).toBe('Failed to parse final buffer content');
            expect((collectedEvents[1].data as any).sessionId).toBe(mockStreamSessionId);
            expect(mockLoggerInstance.error).toHaveBeenCalledWith("[Stream] Error parsing remaining buffer:", JSON.stringify(invalidJsonSuffix), expect.any(Error));
        });

        it('should ensure sessionId is injected into end event data even if flowResponse is minimal', async () => {
            const streamEvents: StreamEvent[] = [
                { event: 'end', data: { flowResponse: {} } as any } // Minimal flowResponse
            ];
            const ndjsonLines = streamEvents.map(event => JSON.stringify(event));

            (fetch as jest.Mock).mockResolvedValueOnce({
                ok: true,
                body: mockReadableStream(ndjsonLines),
            });
            (randomUUIDMock as jest.Mock).mockReturnValueOnce(mockStreamSessionId);

            const collectedEvents: StreamEvent[] = [];
            for await (const event of client.streamMessage(message)) {
                collectedEvents.push(event);
            }

            expect(collectedEvents.length).toBe(2); // stream_started, end
            expect((collectedEvents[1].data as any).flowResponse.sessionId).toEqual(mockStreamSessionId);
        });

        it('should ensure sessionId is injected into end event data if flowResponse is absent but data object exists', async () => {
            const streamEvents: StreamEvent[] = [
                { event: 'end', data: {} as any } // data object exists, but no flowResponse property
            ];
            const ndjsonLines = streamEvents.map(event => JSON.stringify(event));

            (fetch as jest.Mock).mockResolvedValueOnce({
                ok: true,
                body: mockReadableStream(ndjsonLines),
            });
            (randomUUIDMock as jest.Mock).mockReturnValueOnce(mockStreamSessionId);

            const collectedEvents: StreamEvent[] = [];
            for await (const event of client.streamMessage(message)) {
                collectedEvents.push(event);
            }
            expect(collectedEvents.length).toBe(2); // stream_started, end
            expect((collectedEvents[1].data as any).sessionId).toEqual(mockStreamSessionId);
        });

        it('should handle error when parsing final line segment if reader.read() returns value with done:true', async () => {
            // This scenario is slightly artificial for the mock, but tests the final block in the while(true) loop
            const eventLine = JSON.stringify({ event: 'token', data: { chunk: 'test' } });
            (fetch as jest.Mock).mockResolvedValueOnce({
                ok: true,
                body: {
                    getReader: () => ({
                        read: jest.fn()
                            .mockResolvedValueOnce({ done: false, value: new TextEncoder().encode(eventLine + '\n') })
                            .mockResolvedValueOnce({ done: true, value: new TextEncoder().encode('this is not valid json after done') })
                    })
                }
            });
            (randomUUIDMock as jest.Mock).mockReturnValueOnce(mockStreamSessionId);

            const collectedEvents: StreamEvent[] = [];
            for await (const event of client.streamMessage(message)) {
                collectedEvents.push(event);
            }
            expect(collectedEvents.length).toBe(3); // stream_started, token, error
            expect(collectedEvents[1].event).toBe('token');
            expect(collectedEvents[2].event).toBe('error');
            expect((collectedEvents[2].data as any).message).toBe('Failed to parse final buffer content');
            expect(mockLoggerInstance.error).toHaveBeenCalledWith("[Stream] Error parsing remaining buffer:", JSON.stringify("this is not valid json after done"), expect.any(Error));
        });

        it('should process payload co-arriving with done:true through main loop, including errors', async () => {
            const finalEvent = { event: 'token', data: { chunk: 'final token' } };
            const finalGoodLine = JSON.stringify(finalEvent);
            const finalBadLine = "this is not json in final chunk";
            const finalPayload = finalGoodLine + '\n' + finalBadLine + '\n';

            (fetch as jest.Mock).mockResolvedValueOnce({
                ok: true,
                body: {
                    getReader: () => {
                        let called = false;
                        return {
                            read: jest.fn(async () => {
                                if (!called) {
                                    called = true;
                                    return { done: true, value: new TextEncoder().encode(finalPayload) }; 
                                }
                                return { done: true, value: undefined }; 
                            }),
                        };
                    }
                },
                headers: new Headers({ 'Content-Type': 'application/x-ndjson' }),
            });
            (randomUUIDMock as jest.Mock).mockReturnValueOnce(mockStreamSessionId);

            const collectedEvents: StreamEvent[] = [];
            for await (const event of client.streamMessage(message)) {
                collectedEvents.push(event);
            }

            expect(collectedEvents.length).toBe(3);
            expect(collectedEvents[0].event).toBe('stream_started');
            expect(collectedEvents[1]).toEqual(finalEvent); 
            expect(collectedEvents[2].event).toBe('error');
            expect((collectedEvents[2].data as any).message).toBe('Failed to parse JSON line');
            expect((collectedEvents[2].data as any).sessionId).toBe(mockStreamSessionId);
            expect(mockLoggerInstance.error).toHaveBeenCalledWith("[Stream] Error parsing line:", JSON.stringify(finalBadLine), expect.any(Error));
        });

        it('should handle stream ending cleanly with no final chunk or empty buffer in done block', async () => {
            (fetch as jest.Mock).mockResolvedValueOnce({
                ok: true,
                body: {
                    getReader: () => {
                        let called = false;
                        return {
                            read: jest.fn(async () => {
                                if (!called) {
                                    called = true;
                                    // Simulate done:true and value that leads to empty finalChunk (e.g. undefined or empty)
                                    return { done: true, value: undefined }; 
                                }
                                return { done: true, value: undefined }; 
                            }),
                        };
                    }
                },
                headers: new Headers({ 'Content-Type': 'application/x-ndjson' }),
            });
            (randomUUIDMock as jest.Mock).mockReturnValueOnce(mockStreamSessionId);

            const collectedEvents: StreamEvent[] = [];
            // Append one valid event before the stream ends to ensure the main loop runs at least once.
            const streamEvents: StreamEvent[] = [ { event: 'token', data: { chunk: 'BeforeEnd' } } ];
            const ndjsonLines = streamEvents.map(event => JSON.stringify(event));

            // Modify the mock to first send a normal chunk, then the 'done' condition
            (fetch as jest.Mock).mockReset();
            (fetch as jest.Mock).mockResolvedValueOnce({
                ok: true,
                body: {
                    getReader: () => {
                        let callCount = 0;
                        return {
                            read: jest.fn(async () => {
                                callCount++;
                                if (callCount === 1) { // Send one normal line
                                    return { done: false, value: new TextEncoder().encode(ndjsonLines[0] + '\n') };
                                }
                                // Then, simulate done:true and value that leads to empty finalChunk
                                return { done: true, value: new TextEncoder().encode('') }; // Empty final chunk
                            }),
                        };
                    }
                },
                headers: new Headers({ 'Content-Type': 'application/x-ndjson' }),
            });

            for await (const event of client.streamMessage(message)) {
                collectedEvents.push(event);
            }
            // Expect stream_started and the one token event. No errors from the done block.
            expect(collectedEvents.length).toBe(2);
            expect(collectedEvents[0].event).toBe('stream_started');
            expect(collectedEvents[1]).toEqual(streamEvents[0]);
            expect(mockLoggerInstance.error).not.toHaveBeenCalledWith(expect.stringContaining('final'), expect.anything(), expect.anything());
        });

        it('should correctly parse and handle errors from decoder flush in done block', async () => {
            const validFinalEvent1 = { event: 'token', data: { chunk: 'flushed valid 1'}};
            const validFinalLine1 = JSON.stringify(validFinalEvent1);
            const emptyLine = "";
            const whitespaceLine = "   ";
            const invalidFinalLine = "this is bad flushed json";
            const validFinalEvent2 = { event: 'token', data: { chunk: 'flushed valid 2'}};
            const validFinalLine2 = JSON.stringify(validFinalEvent2);
            // inkluderer emptyLine, whitespaceLine, and invalidFinalLine
            const decoderFlushOutput = validFinalLine1 + '\n' + emptyLine + '\n' + whitespaceLine + '\n' + validFinalLine2 + '\n' + invalidFinalLine + '\n';

            const mockDecode = jest.fn()
                .mockImplementationOnce((value, options) => { 
                    if (value) return new TextDecoder().decode(value, options); 
                    return '';
                })
                .mockImplementationOnce(() => { 
                    return decoderFlushOutput;
                });
            const mockTextDecoderInstance = { decode: mockDecode };
            // Ensure spy is restored later
            const spy = jest.spyOn(global, 'TextDecoder').mockImplementationOnce(() => mockTextDecoderInstance as any);

            (fetch as jest.Mock).mockResolvedValueOnce({
                ok: true,
                body: {
                    getReader: () => {
                        let called = false;
                        return {
                            read: jest.fn(async () => {
                                if (!called) {
                                    called = true;
                                    return { done: false, value: new TextEncoder().encode(JSON.stringify({event: 'token', data: {chunk: 'initial'}}) + '\n') }; 
                                }
                                return { done: true, value: undefined }; 
                            }),
                        };
                    }
                },
                headers: new Headers({ 'Content-Type': 'application/x-ndjson' }),
            });
            (randomUUIDMock as jest.Mock).mockReturnValueOnce(mockStreamSessionId);

            const collectedEvents: StreamEvent[] = [];
            for await (const event of client.streamMessage(message)) {
                collectedEvents.push(event);
            }
            
            // stream_started, initial_event, validFinalEvent1, validFinalEvent2, error_for_invalidFinalLine
            // Empty and whitespace lines should be skipped silently.
            expect(collectedEvents.length).toBe(5); 
            expect(collectedEvents[0].event).toBe('stream_started');
            expect(collectedEvents[1].data).toEqual({chunk: 'initial'});
            expect(collectedEvents[2]).toEqual(validFinalEvent1);
            expect(collectedEvents[3]).toEqual(validFinalEvent2); 
            expect(collectedEvents[4].event).toBe('error');
            expect((collectedEvents[4].data as any).message).toBe('Failed to parse final JSON line segment');
            expect(mockLoggerInstance.error).toHaveBeenCalledWith("[Stream] Error parsing final line segment:", JSON.stringify(invalidFinalLine), expect.any(Error));
            
            spy.mockRestore(); // Restore TextDecoder spy
        });
    });

    describe('getMessageHistory', () => {
        const sessionId = "hist-session-123";
        const mockHistoryResponse: ChatMessageData[] = [
            { id: "msg1", text: "Hello", sender: "user", timestamp: new Date().toISOString() },
            { id: "msg2", text: "Hi back", sender: "bot", timestamp: new Date().toISOString() },
        ];

        beforeEach(() => {
            // Mock window.location.origin for URL construction if not already done globally
            // In a Jest/JSDOM environment, window.location.origin should be available.
            // If running in pure Node, you might need to mock it: 
            // global.window = { location: { origin: 'http://localhost' } } as any;
            // However, for these tests, we can spy on URL and check its input.
        });

        it('should return null and log error if sessionId is not provided', async () => {
            // @ts-ignore To test invalid input
            const history = await client.getMessageHistory(null);
            expect(history).toBeNull();
            expect(mockLoggerInstance.error).toHaveBeenCalledWith("Session ID is required to fetch message history.");
        });

        it('should fetch and return message history successfully', async () => {
            (fetch as jest.Mock).mockResolvedValueOnce({
                ok: true,
                json: async () => mockHistoryResponse,
            });

            const history = await client.getMessageHistory(sessionId);

            expect(fetch).toHaveBeenCalledTimes(1);
            const expectedUrl = new URL(client['historyEndpoint'], window.location.origin);
            expectedUrl.searchParams.append('session_id', sessionId);
            expect(fetch).toHaveBeenCalledWith(
                expectedUrl.toString(),
                {
                    method: 'GET',
                    headers: { 'Accept': 'application/json' },
                }
            );
            expect(history).toEqual(mockHistoryResponse);
            expect(mockLoggerInstance.error).not.toHaveBeenCalled();
        });

        it('should return null and log error on API failure with JSON error response', async () => {
            const errorDetail = { detail: "History not found" };
            (fetch as jest.Mock).mockResolvedValueOnce({
                ok: false,
                status: 404,
                json: async () => errorDetail,
            });

            const history = await client.getMessageHistory(sessionId);

            expect(history).toBeNull();
            expect(mockLoggerInstance.error).toHaveBeenCalledWith("API request for history failed with status 404");
            expect(mockLoggerInstance.error).toHaveBeenCalledWith(`Full error detail for history fetch: ${errorDetail.detail}`);
        });

        it('should return null and log error on API failure with non-JSON error response', async () => {
            (fetch as jest.Mock).mockResolvedValueOnce({
                ok: false,
                status: 500,
                statusText: "Internal Server Error",
                json: async () => { throw new Error('Not JSON'); },
            });

            const history = await client.getMessageHistory(sessionId);

            expect(history).toBeNull();
            expect(mockLoggerInstance.error).toHaveBeenCalledWith("API request for history failed with status 500");
            expect(mockLoggerInstance.error).toHaveBeenCalledWith(`Full error detail for history fetch: Status: 500`);
        });

        it('should return null and log error on network failure (fetch throws)', async () => {
            const networkError = new Error("Network issue");
            (fetch as jest.Mock).mockRejectedValueOnce(networkError);

            const history = await client.getMessageHistory(sessionId);

            expect(history).toBeNull();
            expect(mockLoggerInstance.error).toHaveBeenCalledWith("Failed to fetch message history:", networkError);
        });

        it('should use window.location.origin for URL construction if historyEndpoint is relative', async () => {
            // This test is more about ensuring the URL constructor behaves as expected.
            // The client internally uses new URL(this.historyEndpoint, window.location.origin)
            // We can verify the constructed URL in fetch mock.
            const relativeClient = new LangflowChatClient(profileId, "/api/v1"); // relative baseApiUrl
            const expectedHistoryEndpoint = `/api/v1${PROXY_CHAT_MESSAGES_ENDPOINT_PREFIX}/${profileId}/history`;
            
            (fetch as jest.Mock).mockResolvedValueOnce({
                ok: true,
                json: async () => mockHistoryResponse,
            });

            await relativeClient.getMessageHistory(sessionId);

            const fetchCall = (fetch as jest.Mock).mock.calls[0][0];
            // JSDOM default is http://localhost
            expect(fetchCall).toBe(`http://localhost${expectedHistoryEndpoint}?session_id=${sessionId}`); 
        });
    });
}); 