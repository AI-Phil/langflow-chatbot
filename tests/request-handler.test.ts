import http from 'http';
import { URL } from 'url';
import { LangflowClient } from '@datastax/langflow-client';
import { ChatbotProfile } from '../src/types';
import { handleRequest } from '../src/lib/request-handler';
import {
    PROXY_BASE_API_PATH,
    PROXY_CONFIG_ENDPOINT_PREFIX,
    PROXY_CHAT_MESSAGES_ENDPOINT_PREFIX,
    PROXY_FLOWS_PATH,
    PROXY_PROFILES_PATH
} from '../src/config/apiPaths';

// Mock imported utility functions
jest.mock('../src/lib/request-utils', () => ({
    sendJsonError: jest.fn(),
    proxyLangflowApiRequest: jest.fn(), // Though not directly used by handleRequest, good practice if utils change
    parseJsonBody: jest.fn(),
}));

// Mock imported handler functions
jest.mock('../src/lib/configHandlers', () => ({
    handleGetChatbotConfigRequest: jest.fn(),
    handleListChatbotProfilesRequest: jest.fn(),
}));
jest.mock('../src/lib/langflow/flowsHandlers', () => ({
    handleGetFlowsRequest: jest.fn(),
}));
jest.mock('../src/lib/langflow/historyHandlers', () => ({
    handleGetChatHistoryRequest: jest.fn(),
}));
jest.mock('../src/lib/langflow/chatHandlers', () => ({
    handleChatMessageRequest: jest.fn(),
}));

// Import the mocked functions for use in tests
import { sendJsonError } from '../src/lib/request-utils';
import { handleGetChatbotConfigRequest, handleListChatbotProfilesRequest } from '../src/lib/configHandlers';
import { handleGetFlowsRequest } from '../src/lib/langflow/flowsHandlers';
import { handleGetChatHistoryRequest } from '../src/lib/langflow/historyHandlers';
import { handleChatMessageRequest } from '../src/lib/langflow/chatHandlers';


// Helper to create a mock IncomingMessage
const createMockReq = (method: string, url: string | undefined, body?: any): http.IncomingMessage => {
    const req = new http.IncomingMessage(null as any);
    req.method = method;
    req.url = url;
    req.headers = { host: 'localhost:3000' }; // Needed for URL parsing

    // Simulate body for POST/PUT if needed, simplified for now
    if (body) {
        req.push = jest.fn().mockReturnValue(Buffer.from(JSON.stringify(body)));
        req.unshift = jest.fn();
        req.read = jest.fn().mockReturnValue(Buffer.from(JSON.stringify(body)));
        // @ts-ignore
        req.isPaused = jest.fn(() => false);
        // @ts-ignore
        req.pause = jest.fn();
        // @ts-ignore
        req.resume = jest.fn();
        process.nextTick(() => {
            req.emit('data', Buffer.from(JSON.stringify(body)));
            req.emit('end');
        });
    } else {
        process.nextTick(() => {
            req.emit('end');
        });
    }
    return req;
};

// Helper to create a mock ServerResponse
const createMockRes = (): http.ServerResponse => {
    const res = new http.ServerResponse({} as http.IncomingMessage);
    res.setHeader = jest.fn();
    res.end = jest.fn();
    res.writeHead = jest.fn();
    return res;
};

describe('handleRequest', () => {
    let mockReq: http.IncomingMessage;
    let mockRes: http.ServerResponse;
    let mockChatbotConfigurations: Map<string, ChatbotProfile>;
    let mockLangflowClient: LangflowClient | undefined;
    let mockLangflowEndpointUrl: string | undefined;
    let mockLangflowApiKey: string | undefined;
    let mockMakeDirectLangflowApiRequest: jest.Mock;

    beforeEach(() => {
        // Reset mocks for each test
        jest.clearAllMocks();

        mockRes = createMockRes();
        mockChatbotConfigurations = new Map<string, ChatbotProfile>();
        mockLangflowClient = {} as LangflowClient; // Basic mock, extend if methods are called
        mockLangflowEndpointUrl = 'http://localhost:7860';
        mockLangflowApiKey = 'test-api-key';
        mockMakeDirectLangflowApiRequest = jest.fn();
    });

    test('should send 400 if URL is missing', async () => {
        mockReq = createMockReq('GET', undefined);
        await handleRequest(
            mockReq,
            mockRes,
            mockChatbotConfigurations,
            mockLangflowClient,
            mockLangflowEndpointUrl,
            mockLangflowApiKey,
            mockMakeDirectLangflowApiRequest
        );
        expect(sendJsonError).toHaveBeenCalledWith(mockRes, 400, "URL is required.");
    });

    test('should use \'localhost\' as base if req.headers.host is missing', async () => {
        // Create a req without a host header
        const mockReqWithoutHost = createMockReq('GET', PROXY_PROFILES_PATH);
        // @ts-ignore // Allow direct manipulation for testing
        mockReqWithoutHost.headers = {}; // Remove host to trigger fallback

        // We expect handleListChatbotProfilesRequest to be called as an example of a valid path being processed
        // The main purpose is to ensure no error occurs and the internal URL parsing with fallback works
        await handleRequest(
            mockReqWithoutHost,
            mockRes,
            mockChatbotConfigurations,
            mockLangflowClient,
            mockLangflowEndpointUrl,
            mockLangflowApiKey,
            mockMakeDirectLangflowApiRequest
        );
        // Check that a known handler was called, implying successful parsing with fallback host
        expect(handleListChatbotProfilesRequest).toHaveBeenCalled();
        // And that no error was sent due to faulty URL parsing
        expect(sendJsonError).not.toHaveBeenCalledWith(mockRes, 400, "URL is required."); // or any other URL related error
    });

    // Tests for /api/v1/chatbot-config/{proxyEndpointId}
    describe('Chatbot Config Endpoint', () => {
        const profileId = 'test-profile';
        const configPath = `${PROXY_BASE_API_PATH}${PROXY_CONFIG_ENDPOINT_PREFIX}/${profileId}`;

        test('GET should call handleGetChatbotConfigRequest for valid path', async () => {
            mockReq = createMockReq('GET', configPath);
            await handleRequest(mockReq, mockRes, mockChatbotConfigurations, mockLangflowClient, mockLangflowEndpointUrl, mockLangflowApiKey, mockMakeDirectLangflowApiRequest);
            expect(handleGetChatbotConfigRequest).toHaveBeenCalledWith(profileId, mockRes, mockChatbotConfigurations);
        });

        test('Non-GET method should result in 404', async () => {
            mockReq = createMockReq('POST', configPath);
            await handleRequest(mockReq, mockRes, mockChatbotConfigurations, mockLangflowClient, mockLangflowEndpointUrl, mockLangflowApiKey, mockMakeDirectLangflowApiRequest);
            expect(sendJsonError).toHaveBeenCalledWith(mockRes, 404, "Endpoint not found or method not supported.");
        });
    });

    // Tests for /api/v1/profiles
    describe('List Profiles Endpoint', () => {
        const profilesPath = PROXY_PROFILES_PATH;

        test('GET should call handleListChatbotProfilesRequest', async () => {
            mockReq = createMockReq('GET', profilesPath);
            await handleRequest(mockReq, mockRes, mockChatbotConfigurations, mockLangflowClient, mockLangflowEndpointUrl, mockLangflowApiKey, mockMakeDirectLangflowApiRequest);
            expect(handleListChatbotProfilesRequest).toHaveBeenCalledWith(mockReq, mockRes, mockChatbotConfigurations);
        });

        test('Non-GET method should result in 404', async () => {
            mockReq = createMockReq('POST', profilesPath);
            await handleRequest(mockReq, mockRes, mockChatbotConfigurations, mockLangflowClient, mockLangflowEndpointUrl, mockLangflowApiKey, mockMakeDirectLangflowApiRequest);
            expect(sendJsonError).toHaveBeenCalledWith(mockRes, 404, "Endpoint not found or method not supported.");
        });
    });

    // Tests for /api/v1/flows
    describe('List Flows Endpoint', () => {
        const flowsPath = PROXY_FLOWS_PATH;

        test('GET should call handleGetFlowsRequest', async () => {
            mockReq = createMockReq('GET', flowsPath);
            await handleRequest(mockReq, mockRes, mockChatbotConfigurations, mockLangflowClient, mockLangflowEndpointUrl, mockLangflowApiKey, mockMakeDirectLangflowApiRequest);
            expect(handleGetFlowsRequest).toHaveBeenCalledWith(mockReq, mockRes, mockMakeDirectLangflowApiRequest);
        });

        test('Non-GET method should result in 404', async () => {
            mockReq = createMockReq('POST', flowsPath);
            await handleRequest(mockReq, mockRes, mockChatbotConfigurations, mockLangflowClient, mockLangflowEndpointUrl, mockLangflowApiKey, mockMakeDirectLangflowApiRequest);
            expect(sendJsonError).toHaveBeenCalledWith(mockRes, 404, "Endpoint not found or method not supported.");
        });
    });

    // Tests for /api/v1/chat/{proxyEndpointId}/messages and /history
    describe('Chat Messages Endpoint', () => {
        const profileId = 'chat-profile';
        const validProfile: ChatbotProfile = { proxyEndpointId: profileId, flowId: 'flow-uuid-123', widgetTitle: 'Chat Now' };
        const chatBasePath = `${PROXY_BASE_API_PATH}${PROXY_CHAT_MESSAGES_ENDPOINT_PREFIX}`;
        const messagesPath = `${chatBasePath}/${profileId}`;
        const historyPath = `${messagesPath}/history`;

        test('should send 400 if proxyEndpointId is missing', async () => {
            mockReq = createMockReq('POST', `${chatBasePath}/`); // Missing profileId
            await handleRequest(mockReq, mockRes, mockChatbotConfigurations, mockLangflowClient, mockLangflowEndpointUrl, mockLangflowApiKey, mockMakeDirectLangflowApiRequest);
            expect(sendJsonError).toHaveBeenCalledWith(mockRes, 400, "proxyEndpointId missing in chat URL.");
        });

        test('should send 404 if profile not found for POST message', async () => {
            mockReq = createMockReq('POST', messagesPath);
            await handleRequest(mockReq, mockRes, mockChatbotConfigurations, mockLangflowClient, mockLangflowEndpointUrl, mockLangflowApiKey, mockMakeDirectLangflowApiRequest);
            expect(sendJsonError).toHaveBeenCalledWith(mockRes, 404, `Chatbot profile with proxyEndpointId '${profileId}' not found.`);
        });

        test('should send 404 if profile not found for GET history', async () => {
            mockReq = createMockReq('GET', historyPath);
            await handleRequest(mockReq, mockRes, mockChatbotConfigurations, mockLangflowClient, mockLangflowEndpointUrl, mockLangflowApiKey, mockMakeDirectLangflowApiRequest);
            expect(sendJsonError).toHaveBeenCalledWith(mockRes, 404, `Chatbot profile with proxyEndpointId '${profileId}' not found.`);
        });

        describe('When profile exists', () => {
            beforeEach(() => {
                mockChatbotConfigurations.set(profileId, validProfile);
            });

            test('POST to messagesPath should call handleChatMessageRequest', async () => {
                mockReq = createMockReq('POST', messagesPath, { message: 'Hello' });
                await handleRequest(mockReq, mockRes, mockChatbotConfigurations, mockLangflowClient, mockLangflowEndpointUrl, mockLangflowApiKey, mockMakeDirectLangflowApiRequest);
                expect(handleChatMessageRequest).toHaveBeenCalledWith(mockReq, mockRes, validProfile.flowId, true, mockLangflowClient); // Assuming default enableStream = true
            });

            test('POST to messagesPath should respect enableStream=false in profile', async () => {
                const noStreamProfile = { ...validProfile, enableStream: false };
                mockChatbotConfigurations.set(profileId, noStreamProfile);
                mockReq = createMockReq('POST', messagesPath, { message: 'Hello' });
                await handleRequest(mockReq, mockRes, mockChatbotConfigurations, mockLangflowClient, mockLangflowEndpointUrl, mockLangflowApiKey, mockMakeDirectLangflowApiRequest);
                expect(handleChatMessageRequest).toHaveBeenCalledWith(mockReq, mockRes, noStreamProfile.flowId, false, mockLangflowClient);
            });

            test('POST to messagesPath should respect enableStream=true in profile', async () => {
                const streamProfile = { ...validProfile, enableStream: true }; // Explicitly true
                mockChatbotConfigurations.set(profileId, streamProfile);
                mockReq = createMockReq('POST', messagesPath, { message: 'Hello' });
                await handleRequest(mockReq, mockRes, mockChatbotConfigurations, mockLangflowClient, mockLangflowEndpointUrl, mockLangflowApiKey, mockMakeDirectLangflowApiRequest);
                expect(handleChatMessageRequest).toHaveBeenCalledWith(mockReq, mockRes, streamProfile.flowId, true, mockLangflowClient);
            });

            test('GET to historyPath should call handleGetChatHistoryRequest with sessionId', async () => {
                const sessionId = 'session-123';
                mockReq = createMockReq('GET', `${historyPath}?session_id=${sessionId}`);
                await handleRequest(mockReq, mockRes, mockChatbotConfigurations, mockLangflowClient, mockLangflowEndpointUrl, mockLangflowApiKey, mockMakeDirectLangflowApiRequest);
                expect(handleGetChatHistoryRequest).toHaveBeenCalledWith(mockRes, validProfile.flowId, sessionId, mockMakeDirectLangflowApiRequest);
            });

            test('GET to historyPath should call handleGetChatHistoryRequest with null sessionId if not provided', async () => {
                mockReq = createMockReq('GET', historyPath); // No session_id query param
                await handleRequest(mockReq, mockRes, mockChatbotConfigurations, mockLangflowClient, mockLangflowEndpointUrl, mockLangflowApiKey, mockMakeDirectLangflowApiRequest);
                expect(handleGetChatHistoryRequest).toHaveBeenCalledWith(mockRes, validProfile.flowId, null, mockMakeDirectLangflowApiRequest);
            });

            test('Unsupported method to messagesPath should result in 404', async () => {
                mockReq = createMockReq('PUT', messagesPath);
                await handleRequest(mockReq, mockRes, mockChatbotConfigurations, mockLangflowClient, mockLangflowEndpointUrl, mockLangflowApiKey, mockMakeDirectLangflowApiRequest);
                expect(sendJsonError).toHaveBeenCalledWith(mockRes, 404, "Chat endpoint not found or method not supported for the path.");
            });

            test('Invalid path under chat prefix should result in 404', async () => {
                mockReq = createMockReq('GET', `${messagesPath}/invalid/subpath`);
                await handleRequest(mockReq, mockRes, mockChatbotConfigurations, mockLangflowClient, mockLangflowEndpointUrl, mockLangflowApiKey, mockMakeDirectLangflowApiRequest);
                expect(sendJsonError).toHaveBeenCalledWith(mockRes, 404, "Chat endpoint not found or method not supported for the path.");
            });
        });
    });
    
    // Fallback for unknown paths
    test('Unknown path should result in 404', async () => {
        mockReq = createMockReq('GET', '/api/v1/unknown/path');
        await handleRequest(mockReq, mockRes, mockChatbotConfigurations, mockLangflowClient, mockLangflowEndpointUrl, mockLangflowApiKey, mockMakeDirectLangflowApiRequest);
        expect(sendJsonError).toHaveBeenCalledWith(mockRes, 404, "Endpoint not found or method not supported.");
    });
}); 