import http from 'http';
import { LANGFLOW_API_BASE_PATH_V1 } from '@src/config/apiPaths';
import { handleGetFlowsRequest } from '@src/lib/langflow/flowsHandlers';
import * as requestUtils from '@src/lib/request-utils';

// Mock the request-utils module
jest.mock('@src/lib/request-utils', () => ({
    proxyLangflowApiRequest: jest.fn(),
}));

const mockProxyLangflowApiRequest = requestUtils.proxyLangflowApiRequest as jest.MockedFunction<typeof requestUtils.proxyLangflowApiRequest>;

describe('handleGetFlowsRequest', () => {
    let req: http.IncomingMessage;
    let res: http.ServerResponse;
    let mockMakeDirectLangflowApiRequest: jest.Mock;

    beforeEach(() => {
        jest.clearAllMocks();

        req = {
            method: 'GET',
            url: '/api/v1/flows-config', // Example URL that would trigger this handler
        } as http.IncomingMessage;

        res = {
            statusCode: 0,
            setHeader: jest.fn(),
            write: jest.fn(),
            end: jest.fn(),
        } as unknown as http.ServerResponse;

        mockMakeDirectLangflowApiRequest = jest.fn().mockResolvedValue(new Response(JSON.stringify([]), { status: 200 }));

        // Setup proxyLangflowApiRequest to immediately call the function passed to it
        mockProxyLangflowApiRequest.mockImplementation(async (response, callback) => {
            await callback();
        });
    });

    it('should log the incoming request URL', async () => {
        const consoleSpy = jest.spyOn(console, 'log');
        await handleGetFlowsRequest(req, res, mockMakeDirectLangflowApiRequest);
        expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining(`Received GET request for flows configuration: ${req.url}`));
        consoleSpy.mockRestore();
    });

    it('should call proxyLangflowApiRequest', async () => {
        await handleGetFlowsRequest(req, res, mockMakeDirectLangflowApiRequest);
        expect(mockProxyLangflowApiRequest).toHaveBeenCalledTimes(1);
        expect(mockProxyLangflowApiRequest).toHaveBeenCalledWith(res, expect.any(Function));
    });

    it('should call makeDirectLangflowApiRequest with correct parameters via proxy', async () => {
        await handleGetFlowsRequest(req, res, mockMakeDirectLangflowApiRequest);

        // Check that the callback provided to proxyLangflowApiRequest was executed
        // (which it is by our mockImplementation)
        expect(mockMakeDirectLangflowApiRequest).toHaveBeenCalledTimes(1);

        const expectedTargetPath = `${LANGFLOW_API_BASE_PATH_V1}/flows/`;
        const expectedQueryParams = new URLSearchParams();
        expectedQueryParams.append('header_flows', 'true');
        expectedQueryParams.append('get_all', 'true');

        expect(mockMakeDirectLangflowApiRequest).toHaveBeenCalledWith(
            res,
            expectedTargetPath,
            'GET',
            expectedQueryParams
        );
    });
}); 