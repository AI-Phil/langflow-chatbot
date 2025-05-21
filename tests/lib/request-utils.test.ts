import http from 'http';
import { Readable } from 'stream'; // For mocking IncomingMessage
import { parseJsonBody, sendJsonError, proxyLangflowApiRequest } from '../../src/lib/request-utils';

// Mock console methods as they are used in proxyLangflowApiRequest
const mockConsoleLog = jest.fn();
const mockConsoleError = jest.fn();

global.console = {
    ...global.console,
    log: mockConsoleLog,
    error: mockConsoleError,
    // Keep other console methods if they were previously mocked for other test files
    warn: global.console.warn || jest.fn(),
    debug: global.console.debug || jest.fn(),
};

// Mock global.fetch for proxyLangflowApiRequest
global.fetch = jest.fn();

// Helper to create a mock ServerResponse
const createMockServerResponse = () => {
    const resProperties = {
        statusCode: 0,
        headersSent: false,
        writableEnded: false,
        setHeader: jest.fn(),
        end: jest.fn().mockImplementation(function(this: { writableEnded: boolean }) { // Explicitly type 'this'
            this.writableEnded = true;
            return this;
        }),
    };
    return resProperties as unknown as http.ServerResponse;
};

// Helper to create a mock IncomingMessage for parseJsonBody
const createMockIncomingMessage = (body: string | object, isJson = true): http.IncomingMessage => {
    const readable = new Readable();
    readable._read = () => {}; // Noop for testing
    if (typeof body === 'object' && isJson) {
        readable.push(JSON.stringify(body));
    } else {
        readable.push(body.toString());
    }
    readable.push(null); // Signal end of data

    // Mixin properties of IncomingMessage
    const req = readable as any; // Start with Readable and cast
    req.headers = {};
    req.method = 'POST';
    req.url = '/';
    // Ensure event emitter methods are present from Readable
    return req as http.IncomingMessage;
};

describe('request-utils', () => {
    beforeEach(() => {
        mockConsoleLog.mockClear();
        mockConsoleError.mockClear();
        (global.fetch as jest.Mock).mockClear();
    });

    describe('parseJsonBody', () => {
        test('should parse a valid JSON body', async () => {
            const mockJson = { key: 'value', number: 123 };
            const req = createMockIncomingMessage(mockJson);
            const parsedBody = await parseJsonBody(req);
            expect(parsedBody).toEqual(mockJson);
        });

        test('should reject with an error for an invalid JSON body', async () => {
            const req = createMockIncomingMessage('this is not json', false);
            await expect(parseJsonBody(req)).rejects.toThrow('Invalid JSON body');
        });

        test('should reject with an error for an empty body (invalid JSON)', async () => {
            const req = createMockIncomingMessage('', false);
            await expect(parseJsonBody(req)).rejects.toThrow('Invalid JSON body');
        });

        test('should reject with the request error if req emits an error', async () => {
            const req = createMockIncomingMessage('any body');
            const mockError = new Error('Network issue');
            
            // Manually emit error after a short delay to simulate async event
            process.nextTick(() => {
                (req as Readable).emit('error', mockError);
            });

            await expect(parseJsonBody(req)).rejects.toThrow(mockError);
        });
    });

    describe('sendJsonError', () => {
        test('should set status code, headers, and end response with JSON error message', () => {
            const mockRes = createMockServerResponse();
            const statusCode = 400;
            const errorMessage = 'Bad Request';

            sendJsonError(mockRes, statusCode, errorMessage);

            expect(mockRes.statusCode).toBe(statusCode);
            expect(mockRes.setHeader).toHaveBeenCalledWith('Content-Type', 'application/json');
            expect(mockRes.end).toHaveBeenCalledWith(JSON.stringify({ error: errorMessage }));
        });

        test('should include detail in JSON response if provided', () => {
            const mockRes = createMockServerResponse();
            const statusCode = 500;
            const errorMessage = 'Internal Server Error';
            const errorDetail = 'Something went very wrong.';

            sendJsonError(mockRes, statusCode, errorMessage, errorDetail);

            expect(mockRes.statusCode).toBe(statusCode);
            expect(mockRes.setHeader).toHaveBeenCalledWith('Content-Type', 'application/json');
            expect(mockRes.end).toHaveBeenCalledWith(JSON.stringify({ error: errorMessage, detail: errorDetail }));
        });
    });

    describe('proxyLangflowApiRequest', () => {
        let mockRes: http.ServerResponse;
        let langflowApiCallMock: jest.Mock<Promise<Response | null>>;

        beforeEach(() => {
            mockRes = createMockServerResponse();
            langflowApiCallMock = jest.fn();
            // Reset fetch mock in case it was used directly, though langflowApiCallMock is primary here
            (global.fetch as jest.Mock).mockReset(); 
        });

        test('should proxy successful JSON response from Langflow', async () => {
            const mockLangflowData = { data: 'success' };
            const mockLangflowResponse = {
                ok: true,
                status: 200,
                statusText: 'OK',
                headers: new Headers({ 'Content-Type': 'application/json', 'X-Custom-Header': 'custom-value' }),
                json: async () => mockLangflowData,
                text: async () => JSON.stringify(mockLangflowData),
            } as Response;
            langflowApiCallMock.mockResolvedValueOnce(mockLangflowResponse);

            const result = await proxyLangflowApiRequest(mockRes, langflowApiCallMock);

            expect(langflowApiCallMock).toHaveBeenCalledTimes(1);
            expect(mockConsoleLog).toHaveBeenCalledWith(`RequestHandler (proxyUtil): Response status from Langflow server: ${mockLangflowResponse.status} ${mockLangflowResponse.statusText}`);
            expect(mockRes.statusCode).toBe(200);
            expect(mockRes.setHeader).toHaveBeenCalledWith('x-custom-header', 'custom-value');
            expect(mockRes.setHeader).toHaveBeenCalledWith('Content-Type', 'application/json');
            expect(mockRes.end).toHaveBeenCalledWith(JSON.stringify(mockLangflowData));
            expect(result).toEqual(mockLangflowData);
            expect(mockConsoleError).not.toHaveBeenCalled();
        });

        test('should proxy successful non-JSON (text/plain) response from Langflow', async () => {
            const mockLangflowText = 'Hello Langflow';
            const mockLangflowResponse = {
                ok: true,
                status: 200,
                statusText: 'OK',
                headers: new Headers({ 'Content-Type': 'text/plain' }),
                text: async () => mockLangflowText,
            } as Response;
            langflowApiCallMock.mockResolvedValueOnce(mockLangflowResponse);

            const result = await proxyLangflowApiRequest(mockRes, langflowApiCallMock);

            expect(mockRes.statusCode).toBe(200);
            expect(mockRes.setHeader).toHaveBeenCalledWith('Content-Type', 'text/plain');
            expect(mockRes.end).toHaveBeenCalledWith(mockLangflowText);
            expect(result).toBe(mockLangflowText);
            expect(mockConsoleError).not.toHaveBeenCalled();
        });

        test('should not interfere if langflowApiCall returns null (error handled by caller)', async () => {
            langflowApiCallMock.mockResolvedValueOnce(null);

            const result = await proxyLangflowApiRequest(mockRes, langflowApiCallMock);

            expect(result).toBeNull();
            expect(mockRes.setHeader).not.toHaveBeenCalled();
            expect(mockRes.end).not.toHaveBeenCalled();
            expect(mockConsoleError).not.toHaveBeenCalled();
        });

        test('should send 500 error if langflowApiCall throws an error', async () => {
            const errorMessage = 'Network failure';
            langflowApiCallMock.mockRejectedValueOnce(new Error(errorMessage));

            const result = await proxyLangflowApiRequest(mockRes, langflowApiCallMock);

            expect(result).toBeNull();
            expect(mockRes.statusCode).toBe(500);
            expect(mockRes.setHeader).toHaveBeenCalledWith('Content-Type', 'application/json');
            expect(mockRes.end).toHaveBeenCalledWith(JSON.stringify({ error: "Failed to make request to Langflow via proxy.", detail: errorMessage }));
            expect(mockConsoleError).toHaveBeenCalledWith("RequestHandler (proxyUtil): Error in API request to Langflow:", expect.any(Error));
        });

        test('should relay non-OK status and response body from Langflow', async () => {
            const errorJson = { detail: 'Authentication credentials were not provided.' };
            const mockLangflowResponse = {
                ok: false,
                status: 401,
                statusText: 'Unauthorized',
                headers: new Headers({ 'Content-Type': 'application/json' }),
                text: async () => JSON.stringify(errorJson),
            } as Response;
            langflowApiCallMock.mockResolvedValueOnce(mockLangflowResponse);

            const result = await proxyLangflowApiRequest(mockRes, langflowApiCallMock);
            
            expect(result).toEqual(errorJson);
            expect(mockRes.statusCode).toBe(401);
            expect(mockRes.setHeader).toHaveBeenCalledWith('Content-Type', 'application/json');
            expect(mockRes.end).toHaveBeenCalledWith(JSON.stringify(errorJson)); 
        });

        test('should handle invalid JSON response from Langflow (OK status)', async () => {
            const invalidJsonText = 'This is not JSON but API said it was.';
            const mockLangflowResponse = {
                ok: true,
                status: 200,
                statusText: 'OK',
                headers: new Headers({ 'Content-Type': 'application/json' }),
                text: async () => invalidJsonText,
            } as Response;
            langflowApiCallMock.mockResolvedValueOnce(mockLangflowResponse);

            let actualJsonErrorMessage = '';
            try {
                JSON.parse(invalidJsonText);
            } catch (e: any) {
                actualJsonErrorMessage = e.message;
            }

            const result = await proxyLangflowApiRequest(mockRes, langflowApiCallMock);

            expect(result).toBeNull();
            expect(mockRes.statusCode).toBe(502);
            expect(mockRes.setHeader).toHaveBeenCalledWith('Content-Type', 'application/json');
            expect(mockRes.end).toHaveBeenCalledWith(JSON.stringify({ 
                error: "Proxy received an invalid JSON response from Langflow server.", 
                detail: actualJsonErrorMessage
            }));
            expect(mockConsoleError).toHaveBeenCalledWith(
                `RequestHandler (proxyUtil): Failed to parse JSON response from Langflow. Status: ${mockLangflowResponse.status}. Error: ${actualJsonErrorMessage}. Body: ${invalidJsonText.substring(0,1000)}`
            );
        });

        test('should handle invalid JSON when headers already sent', async () => {
            const invalidJsonText = 'Invalid JSON content';
            const mockLangflowResponse = {
                ok: true, status: 200, statusText: 'OK',
                headers: new Headers({ 'Content-Type': 'application/json' }),
                text: async () => invalidJsonText,
            } as Response;
            langflowApiCallMock.mockResolvedValueOnce(mockLangflowResponse);

            (mockRes as any).headersSent = true; 
            (mockRes as any).writableEnded = false;

            let actualJsonErrorMessage = '';
            try {
                JSON.parse(invalidJsonText);
            } catch (e: any) {
                actualJsonErrorMessage = e.message;
            }

            const result = await proxyLangflowApiRequest(mockRes, langflowApiCallMock);

            expect(result).toBeNull();
            expect(mockRes.end).toHaveBeenCalledWith('\n{"error": "Proxy received an invalid JSON response from Langflow server after starting response."} ');
            expect(mockConsoleError).toHaveBeenCalledWith(
                `RequestHandler (proxyUtil): Failed to parse JSON response from Langflow. Status: ${mockLangflowResponse.status}. Error: ${actualJsonErrorMessage}. Body: ${invalidJsonText.substring(0,1000)}`
            );
        });

        test('should not relay problematic headers like transfer-encoding or content-length', async () => {
            const mockLangflowData = { data: 'success' };
            const mockLangflowResponse = {
                ok: true, status: 200, statusText: 'OK',
                headers: new Headers({
                    'Content-Type': 'application/json',
                    'Content-Length': '12345',
                    'Transfer-Encoding': 'chunked',
                    'Content-Encoding': 'gzip',
                    'X-Custom-Relay': 'this-should-be-relayed'
                }),
                text: async () => JSON.stringify(mockLangflowData),
            } as Response;
            langflowApiCallMock.mockResolvedValueOnce(mockLangflowResponse);

            await proxyLangflowApiRequest(mockRes, langflowApiCallMock);

            expect(mockRes.setHeader).toHaveBeenCalledWith('x-custom-relay', 'this-should-be-relayed');
            expect(mockRes.setHeader).toHaveBeenCalledWith('Content-Type', 'application/json');
            expect(mockRes.setHeader).not.toHaveBeenCalledWith('Content-Length', expect.anything());
            expect(mockRes.setHeader).not.toHaveBeenCalledWith('Transfer-Encoding', expect.anything());
            expect(mockRes.setHeader).not.toHaveBeenCalledWith('Content-Encoding', expect.anything());
        });

        test('should log error and not modify response if langflowApiCall throws and headers already sent', async () => {
            const errorMessage = 'Critical API failure';
            const errorInstance = new Error(errorMessage);
            langflowApiCallMock.mockRejectedValueOnce(errorInstance);

            (mockRes as any).headersSent = true;
            const initialStatusCode = mockRes.statusCode;
            const initialEndCallCount = (mockRes.end as jest.Mock).mock.calls.length;

            const result = await proxyLangflowApiRequest(mockRes, langflowApiCallMock);

            expect(result).toBeNull();
            expect(mockConsoleError).toHaveBeenCalledWith("RequestHandler (proxyUtil): Error in API request to Langflow:", errorInstance);
            
            expect(mockRes.statusCode).toBe(initialStatusCode);
            expect((mockRes.end as jest.Mock).mock.calls.length).toBe(initialEndCallCount);
        });

        test('should log error and return null if JSON parse fails, headersSent=true, writableEnded=true', async () => {
            const invalidJsonText = 'Malformed JSON';
            const mockLangflowResponse = {
                ok: true, status: 200, statusText: 'OK',
                headers: new Headers({ 'Content-Type': 'application/json' }),
                text: async () => invalidJsonText,
            } as Response;
            langflowApiCallMock.mockResolvedValueOnce(mockLangflowResponse);

            (mockRes as any).headersSent = true;
            (mockRes as any).writableEnded = true; // Key condition for this test

            const initialEndCallCount = (mockRes.end as jest.Mock).mock.calls.length;
            let actualJsonErrorMessage = '';
            try { JSON.parse(invalidJsonText); } catch (e: any) { actualJsonErrorMessage = e.message; }

            const result = await proxyLangflowApiRequest(mockRes, langflowApiCallMock);

            expect(result).toBeNull();
            expect(mockConsoleError).toHaveBeenCalledWith(
                `RequestHandler (proxyUtil): Failed to parse JSON response from Langflow. Status: ${mockLangflowResponse.status}. Error: ${actualJsonErrorMessage}. Body: ${invalidJsonText.substring(0,1000)}`
            );
            // Ensure no attempt to further write to response
            expect((mockRes.end as jest.Mock).mock.calls.length).toBe(initialEndCallCount);
            // Check statusCode was not changed by a sendJsonError call
            expect(mockRes.statusCode).not.toBe(502); 
        });
    });
});