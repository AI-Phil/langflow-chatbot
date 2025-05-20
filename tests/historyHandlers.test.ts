import http from 'http';
import { URLSearchParams } from 'url';
import { LANGFLOW_API_BASE_PATH_V1 } from '../src/config/apiPaths';
import { handleGetChatHistoryRequest } from '../src/lib/langflow/historyHandlers';
import * as requestUtils from '../src/lib/request-utils';

// Mock the request-utils module
jest.mock('../src/lib/request-utils', () => ({
    proxyLangflowApiRequest: jest.fn(),
    sendJsonError: jest.fn(),
}));

const mockProxyLangflowApiRequest = requestUtils.proxyLangflowApiRequest as jest.MockedFunction<typeof requestUtils.proxyLangflowApiRequest>;
const mockSendJsonError = requestUtils.sendJsonError as jest.MockedFunction<typeof requestUtils.sendJsonError>;

describe('handleGetChatHistoryRequest', () => {
    let res: http.ServerResponse;
    let mockMakeDirectLangflowApiRequest: jest.Mock;
    const flowId = 'test-flow-id';
    const sessionId = 'test-session-id';

    beforeEach(() => {
        jest.clearAllMocks();

        res = {
            statusCode: 0,
            setHeader: jest.fn(),
            write: jest.fn(),
            end: jest.fn(),
        } as unknown as http.ServerResponse;

        // Mock a successful API response for makeDirectLangflowApiRequest
        // The actual content doesn't matter much for these tests, as proxyLangflowApiRequest handles it.
        mockMakeDirectLangflowApiRequest = jest.fn().mockResolvedValue(new Response(JSON.stringify([]), { status: 200 }));

        // Setup proxyLangflowApiRequest to immediately call the function passed to it
        mockProxyLangflowApiRequest.mockImplementation(async (response, callback) => {
            await callback();
        });
    });

    describe('Successful history retrieval', () => {
        it('should log the request with flowId and sessionId', async () => {
            const consoleSpy = jest.spyOn(console, 'log');
            await handleGetChatHistoryRequest(res, flowId, sessionId, mockMakeDirectLangflowApiRequest);
            expect(consoleSpy).toHaveBeenCalledWith(`RequestHandler: Received GET request for chat history for flow '${flowId}', session '${sessionId}'`);
            consoleSpy.mockRestore();
        });

        it('should not call sendJsonError', async () => {
            await handleGetChatHistoryRequest(res, flowId, sessionId, mockMakeDirectLangflowApiRequest);
            expect(mockSendJsonError).not.toHaveBeenCalled();
        });

        it('should call proxyLangflowApiRequest', async () => {
            await handleGetChatHistoryRequest(res, flowId, sessionId, mockMakeDirectLangflowApiRequest);
            expect(mockProxyLangflowApiRequest).toHaveBeenCalledTimes(1);
            expect(mockProxyLangflowApiRequest).toHaveBeenCalledWith(res, expect.any(Function));
        });

        it('should call makeDirectLangflowApiRequest with correct parameters via proxy', async () => {
            await handleGetChatHistoryRequest(res, flowId, sessionId, mockMakeDirectLangflowApiRequest);
            
            expect(mockMakeDirectLangflowApiRequest).toHaveBeenCalledTimes(1);

            const expectedTargetPath = `${LANGFLOW_API_BASE_PATH_V1}/monitor/messages`;
            const expectedQueryParams = new URLSearchParams();
            expectedQueryParams.append('flow_id', flowId);
            expectedQueryParams.append('session_id', sessionId);

            expect(mockMakeDirectLangflowApiRequest).toHaveBeenCalledWith(
                res,
                expectedTargetPath,
                'GET',
                expectedQueryParams
            );
        });
    });

    describe('Failed history retrieval (missing sessionId)', () => {
        const nullSessionId = null;

        it('should log the request even with a null sessionId', async () => {
            const consoleSpy = jest.spyOn(console, 'log');
            await handleGetChatHistoryRequest(res, flowId, nullSessionId, mockMakeDirectLangflowApiRequest);
            expect(consoleSpy).toHaveBeenCalledWith(`RequestHandler: Received GET request for chat history for flow '${flowId}', session '${nullSessionId}'`);
            consoleSpy.mockRestore();
        });

        it('should call sendJsonError with 400 if sessionId is null', async () => {
            await handleGetChatHistoryRequest(res, flowId, nullSessionId, mockMakeDirectLangflowApiRequest);
            expect(mockSendJsonError).toHaveBeenCalledTimes(1);
            expect(mockSendJsonError).toHaveBeenCalledWith(res, 400, "session_id is a required query parameter for history.");
        });

        it('should not call proxyLangflowApiRequest if sessionId is null', async () => {
            await handleGetChatHistoryRequest(res, flowId, nullSessionId, mockMakeDirectLangflowApiRequest);
            expect(mockProxyLangflowApiRequest).not.toHaveBeenCalled();
        });

        it('should not call makeDirectLangflowApiRequest if sessionId is null', async () => {
            await handleGetChatHistoryRequest(res, flowId, nullSessionId, mockMakeDirectLangflowApiRequest);
            expect(mockMakeDirectLangflowApiRequest).not.toHaveBeenCalled();
        });
    });
}); 