import http from 'http';
import { URL } from 'url';
import { LangflowClient } from '@datastax/langflow-client';
import { Profile } from '../../src/types';
import { handleRequest } from '../../src/lib/request-handler';
import {
    PROFILE_CONFIG_ENDPOINT_PREFIX,
    PROFILE_CHAT_ENDPOINT_PREFIX,
    PROXY_FLOWS_SUFFIX,
    PROXY_PROFILES_SUFFIX
} from '../../src/config/apiPaths';

// Mock imported utility functions
jest.mock('../../src/lib/request-utils', () => ({
    sendJsonError: jest.fn(),
    proxyLangflowApiRequest: jest.fn(), // Though not directly used by handleRequest, good practice if utils change
    parseJsonBody: jest.fn(),
}));

// Mock imported handler functions
jest.mock('../../src/lib/configHandlers', () => ({
    handleGetChatbotConfigRequest: jest.fn(),
    handleListChatbotProfilesRequest: jest.fn(),
}));
jest.mock('../../src/lib/langflow/flowsHandlers', () => ({
    handleGetFlowsRequest: jest.fn(),
}));
jest.mock('../../src/lib/langflow/historyHandlers', () => ({
    handleGetChatHistoryRequest: jest.fn(),
}));
jest.mock('../../src/lib/langflow/chatHandlers', () => ({
    handleChatMessageRequest: jest.fn(),
}));

// Import the mocked functions for use in tests
import { sendJsonError } from '../../src/lib/request-utils';
import { handleGetChatbotConfigRequest, handleListChatbotProfilesRequest } from '../../src/lib/configHandlers';
import { handleGetFlowsRequest } from '../../src/lib/langflow/flowsHandlers';
import { handleGetChatHistoryRequest } from '../../src/lib/langflow/historyHandlers';
import { handleChatMessageRequest } from '../../src/lib/langflow/chatHandlers';


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
    let mockChatbotConfigurations: Map<string, Profile>;
    let mockLangflowClient: LangflowClient | undefined;
    let mockLangflowEndpointUrl: string | undefined;
    let mockLangflowApiKey: string | undefined;
    let mockMakeDirectLangflowApiRequest: jest.Mock;
    const mockProxyApiBasePath = '/api/test-proxy';
    let mockPreParsedBody: any | undefined;
    let mockIsBodyPreParsed: boolean;

    beforeEach(() => {
        // Reset mocks for each test
        jest.clearAllMocks();

        mockRes = createMockRes();
        mockChatbotConfigurations = new Map<string, Profile>();
        mockLangflowClient = {} as LangflowClient; // Basic mock, extend if methods are called
        mockLangflowEndpointUrl = 'http://localhost:7860';
        mockLangflowApiKey = 'test-api-key';
        mockMakeDirectLangflowApiRequest = jest.fn();
        mockPreParsedBody = undefined;
        mockIsBodyPreParsed = false;
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
            mockMakeDirectLangflowApiRequest,
            mockProxyApiBasePath,
            mockPreParsedBody,
            mockIsBodyPreParsed
        );
        expect(sendJsonError).toHaveBeenCalledWith(mockRes, 400, "URL is required.");
    });

    test('should use \'localhost\' as base if req.headers.host is missing', async () => {
        const mockReqWithoutHost = createMockReq('GET', PROXY_PROFILES_SUFFIX);
        // @ts-ignore
        mockReqWithoutHost.headers = {};

        await handleRequest(
            mockReqWithoutHost,
            mockRes,
            mockChatbotConfigurations,
            mockLangflowClient,
            mockLangflowEndpointUrl,
            mockLangflowApiKey,
            mockMakeDirectLangflowApiRequest,
            mockProxyApiBasePath,
            mockPreParsedBody,
            mockIsBodyPreParsed
        );
        expect(handleListChatbotProfilesRequest).toHaveBeenCalled();
        expect(sendJsonError).not.toHaveBeenCalledWith(mockRes, 400, "URL is required.");
    });

    describe('Chatbot Config Endpoint', () => {
        const profileId = 'test-profile';
        const configPath = `${PROFILE_CONFIG_ENDPOINT_PREFIX}/${profileId}`;

        test('GET should call handleGetChatbotConfigRequest for valid path', async () => {
            mockReq = createMockReq('GET', configPath);
            await handleRequest(mockReq, mockRes, mockChatbotConfigurations, mockLangflowClient, mockLangflowEndpointUrl, mockLangflowApiKey, mockMakeDirectLangflowApiRequest, mockProxyApiBasePath, mockPreParsedBody, mockIsBodyPreParsed);
            expect(handleGetChatbotConfigRequest).toHaveBeenCalledWith(profileId, mockRes, mockChatbotConfigurations, mockProxyApiBasePath);
        });

        test('Non-GET method should result in 404', async () => {
            mockReq = createMockReq('POST', configPath);
            await handleRequest(mockReq, mockRes, mockChatbotConfigurations, mockLangflowClient, mockLangflowEndpointUrl, mockLangflowApiKey, mockMakeDirectLangflowApiRequest, mockProxyApiBasePath, mockPreParsedBody, mockIsBodyPreParsed);
            expect(sendJsonError).toHaveBeenCalledWith(mockRes, 404, "Endpoint not found or method not supported.");
        });
    });

    describe('List Profiles Endpoint', () => {
        const profilesPath = PROXY_PROFILES_SUFFIX;

        test('GET should call handleListChatbotProfilesRequest', async () => {
            mockReq = createMockReq('GET', profilesPath);
            await handleRequest(mockReq, mockRes, mockChatbotConfigurations, mockLangflowClient, mockLangflowEndpointUrl, mockLangflowApiKey, mockMakeDirectLangflowApiRequest, mockProxyApiBasePath, mockPreParsedBody, mockIsBodyPreParsed);
            expect(handleListChatbotProfilesRequest).toHaveBeenCalledWith(mockReq, mockRes, mockChatbotConfigurations);
        });

        test('Non-GET method should result in 404', async () => {
            mockReq = createMockReq('POST', profilesPath);
            await handleRequest(mockReq, mockRes, mockChatbotConfigurations, mockLangflowClient, mockLangflowEndpointUrl, mockLangflowApiKey, mockMakeDirectLangflowApiRequest, mockProxyApiBasePath, mockPreParsedBody, mockIsBodyPreParsed);
            expect(sendJsonError).toHaveBeenCalledWith(mockRes, 404, "Endpoint not found or method not supported.");
        });
    });

    describe('List Flows Endpoint', () => {
        const flowsPath = PROXY_FLOWS_SUFFIX;

        test('GET should call handleGetFlowsRequest', async () => {
            mockReq = createMockReq('GET', flowsPath);
            await handleRequest(mockReq, mockRes, mockChatbotConfigurations, mockLangflowClient, mockLangflowEndpointUrl, mockLangflowApiKey, mockMakeDirectLangflowApiRequest, mockProxyApiBasePath, mockPreParsedBody, mockIsBodyPreParsed);
            expect(handleGetFlowsRequest).toHaveBeenCalledWith(mockReq, mockRes, mockMakeDirectLangflowApiRequest);
        });

        test('Non-GET method should result in 404', async () => {
            mockReq = createMockReq('POST', flowsPath);
            await handleRequest(mockReq, mockRes, mockChatbotConfigurations, mockLangflowClient, mockLangflowEndpointUrl, mockLangflowApiKey, mockMakeDirectLangflowApiRequest, mockProxyApiBasePath, mockPreParsedBody, mockIsBodyPreParsed);
            expect(sendJsonError).toHaveBeenCalledWith(mockRes, 404, "Endpoint not found or method not supported.");
        });
    });

    describe('Chat Messages Endpoint', () => {
        const profileId = 'chat-profile';
        const validProfile: Profile = { 
            profileId: profileId, 
            server: { 
                flowId: 'flow-uuid-123', 
                enableStream: true,
            },
            chatbot: { 
                labels: { widgetTitle: 'Chat Now' },
            }
        };
        const chatBasePath = `${PROFILE_CHAT_ENDPOINT_PREFIX}`;
        const messagesPath = `${chatBasePath}/${profileId}`;
        const historyPath = `${messagesPath}/history`;

        test('should send 400 if profileId is missing', async () => {
            mockReq = createMockReq('POST', `${chatBasePath}/`);
            await handleRequest(mockReq, mockRes, mockChatbotConfigurations, mockLangflowClient, mockLangflowEndpointUrl, mockLangflowApiKey, mockMakeDirectLangflowApiRequest, mockProxyApiBasePath, mockPreParsedBody, mockIsBodyPreParsed);
            expect(sendJsonError).toHaveBeenCalledWith(mockRes, 400, "profileId missing in chat URL.");
        });

        test('should send 404 if profile not found for POST message', async () => {
            mockReq = createMockReq('POST', messagesPath);
            await handleRequest(mockReq, mockRes, mockChatbotConfigurations, mockLangflowClient, mockLangflowEndpointUrl, mockLangflowApiKey, mockMakeDirectLangflowApiRequest, mockProxyApiBasePath, mockPreParsedBody, mockIsBodyPreParsed);
            expect(sendJsonError).toHaveBeenCalledWith(mockRes, 404, `Chatbot profile with profileId '${profileId}' not found.`);
        });

        test('should send 404 if profile not found for GET history', async () => {
            mockReq = createMockReq('GET', historyPath);
            await handleRequest(mockReq, mockRes, mockChatbotConfigurations, mockLangflowClient, mockLangflowEndpointUrl, mockLangflowApiKey, mockMakeDirectLangflowApiRequest, mockProxyApiBasePath, mockPreParsedBody, mockIsBodyPreParsed);
            expect(sendJsonError).toHaveBeenCalledWith(mockRes, 404, `Chatbot profile with profileId '${profileId}' not found.`);
        });

        describe('When profile exists', () => {
            beforeEach(() => {
                mockChatbotConfigurations.set(profileId, validProfile);
            });

            test('POST to messagesPath should call handleChatMessageRequest with default body params', async () => {
                mockReq = createMockReq('POST', messagesPath, { message: 'Hello' });
                await handleRequest(mockReq, mockRes, mockChatbotConfigurations, mockLangflowClient, mockLangflowEndpointUrl, mockLangflowApiKey, mockMakeDirectLangflowApiRequest, mockProxyApiBasePath, mockPreParsedBody, mockIsBodyPreParsed);
                expect(handleChatMessageRequest).toHaveBeenCalledWith(mockReq, mockRes, validProfile.server.flowId, validProfile.server.enableStream, mockLangflowClient, undefined, false);
            });

            test('POST to messagesPath should call handleChatMessageRequest with provided body params', async () => {
                mockReq = createMockReq('POST', messagesPath, { message: 'Hello' });
                const testBody = { "data": "test" };
                const testIsPreParsed = true;
                await handleRequest(mockReq, mockRes, mockChatbotConfigurations, mockLangflowClient, mockLangflowEndpointUrl, mockLangflowApiKey, mockMakeDirectLangflowApiRequest, mockProxyApiBasePath, testBody, testIsPreParsed);
                expect(handleChatMessageRequest).toHaveBeenCalledWith(mockReq, mockRes, validProfile.server.flowId, validProfile.server.enableStream, mockLangflowClient, testBody, testIsPreParsed);
            });

            test('POST to messagesPath should respect enableStream=false in profile', async () => {
                const noStreamProfile: Profile = { 
                    ...validProfile, 
                    server: { 
                        ...validProfile.server, 
                        enableStream: false 
                    },
                    chatbot: validProfile.chatbot || {}
                };
                mockChatbotConfigurations.set(profileId, noStreamProfile);
                mockReq = createMockReq('POST', messagesPath, { message: 'Hello' });
                await handleRequest(mockReq, mockRes, mockChatbotConfigurations, mockLangflowClient, mockLangflowEndpointUrl, mockLangflowApiKey, mockMakeDirectLangflowApiRequest, mockProxyApiBasePath, mockPreParsedBody, mockIsBodyPreParsed);
                expect(handleChatMessageRequest).toHaveBeenCalledWith(mockReq, mockRes, noStreamProfile.server.flowId, false, mockLangflowClient, undefined, false);
            });

            test('POST to messagesPath should respect enableStream=true in profile', async () => {
                const streamProfile: Profile = { 
                    ...validProfile, 
                    server: { 
                        ...validProfile.server, 
                        enableStream: true 
                    },
                    chatbot: validProfile.chatbot || {}
                };
                mockChatbotConfigurations.set(profileId, streamProfile);
                mockReq = createMockReq('POST', messagesPath, { message: 'Hello Stream' });
                await handleRequest(mockReq, mockRes, mockChatbotConfigurations, mockLangflowClient, mockLangflowEndpointUrl, mockLangflowApiKey, mockMakeDirectLangflowApiRequest, mockProxyApiBasePath, mockPreParsedBody, mockIsBodyPreParsed);
                expect(handleChatMessageRequest).toHaveBeenCalledWith(mockReq, mockRes, streamProfile.server.flowId, true, mockLangflowClient, undefined, false);
            });

            test('GET to historyPath should call handleGetChatHistoryRequest with session_id', async () => {
                const sessionId = 'session-xyz';
                mockReq = createMockReq('GET', `${historyPath}?session_id=${sessionId}`);
                await handleRequest(mockReq, mockRes, mockChatbotConfigurations, mockLangflowClient, mockLangflowEndpointUrl, mockLangflowApiKey, mockMakeDirectLangflowApiRequest, mockProxyApiBasePath, mockPreParsedBody, mockIsBodyPreParsed);
                expect(handleGetChatHistoryRequest).toHaveBeenCalledWith(mockRes, validProfile.server.flowId, sessionId, mockMakeDirectLangflowApiRequest);
            });

            test('GET to historyPath should call handleGetChatHistoryRequest with null session_id if not provided', async () => {
                mockReq = createMockReq('GET', historyPath);
                await handleRequest(mockReq, mockRes, mockChatbotConfigurations, mockLangflowClient, mockLangflowEndpointUrl, mockLangflowApiKey, mockMakeDirectLangflowApiRequest, mockProxyApiBasePath, mockPreParsedBody, mockIsBodyPreParsed);
                expect(handleGetChatHistoryRequest).toHaveBeenCalledWith(mockRes, validProfile.server.flowId, null, mockMakeDirectLangflowApiRequest);
            });

            test('Invalid method to messagesPath should result in 404', async () => {
                mockReq = createMockReq('PUT', messagesPath);
                await handleRequest(mockReq, mockRes, mockChatbotConfigurations, mockLangflowClient, mockLangflowEndpointUrl, mockLangflowApiKey, mockMakeDirectLangflowApiRequest, mockProxyApiBasePath, mockPreParsedBody, mockIsBodyPreParsed);
                expect(sendJsonError).toHaveBeenCalledWith(mockRes, 404, "Chat endpoint not found or method not supported for the path.");
            });

            test('Invalid path suffix after profileId should result in 404', async () => {
                mockReq = createMockReq('GET', `${messagesPath}/invalid_suffix`);
                await handleRequest(mockReq, mockRes, mockChatbotConfigurations, mockLangflowClient, mockLangflowEndpointUrl, mockLangflowApiKey, mockMakeDirectLangflowApiRequest, mockProxyApiBasePath, mockPreParsedBody, mockIsBodyPreParsed);
                expect(sendJsonError).toHaveBeenCalledWith(mockRes, 404, "Chat endpoint not found or method not supported for the path.");
            });
        });
    });
    
    test('should send 404 for non-matching paths', async () => {
        mockReq = createMockReq('GET', '/some/other/path');
        await handleRequest(mockReq, mockRes, mockChatbotConfigurations, mockLangflowClient, mockLangflowEndpointUrl, mockLangflowApiKey, mockMakeDirectLangflowApiRequest, mockProxyApiBasePath, mockPreParsedBody, mockIsBodyPreParsed);
        expect(sendJsonError).toHaveBeenCalledWith(mockRes, 404, "Endpoint not found or method not supported.");
    });
}); 