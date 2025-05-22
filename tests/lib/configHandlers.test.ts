import http from 'http';
import { handleGetChatbotConfigRequest, handleListChatbotProfilesRequest } from '../../src/lib/configHandlers';
import { Profile, ChatbotProfile } from '../../src/types';
import { sendJsonError } from '../../src/lib/request-utils';

// Mock the request-utils module, specifically sendJsonError
jest.mock('../../src/lib/request-utils', () => ({
    ...jest.requireActual('../../src/lib/request-utils'), // Import and retain other exports
    sendJsonError: jest.fn(), // Mock sendJsonError
}));

// Mock console methods as they are used in the handlers
const mockConsoleLog = jest.fn();
global.console = {
    ...global.console,
    log: mockConsoleLog,
    error: jest.fn(), // Add other console methods if needed by SUT or for other tests
    warn: jest.fn(),
    debug: jest.fn(),
};

// Helper to create a mock ServerResponse
const createMockResponse = () => {
    const res = { // Partial<http.ServerResponse>
        statusCode: 0,
        setHeader: jest.fn(),
        end: jest.fn(),
    } as unknown as http.ServerResponse; // Cast to allow testing, acknowledging it's a partial mock
    return res;
};


describe('configHandlers', () => {
    let mockConfigurations: Map<string, Profile>;
    let mockRes: http.ServerResponse;
    const mockProxyApiBasePath = '/api/test-proxy'; // Add a mock base path

    beforeEach(() => {
        // Reset mocks
        (sendJsonError as jest.Mock).mockClear();
        mockConsoleLog.mockClear();
        (global.console.error as jest.Mock).mockClear();
        (global.console.warn as jest.Mock).mockClear();

        mockRes = createMockResponse();

        // Setup mock configurations with the new Profile structure
        mockConfigurations = new Map<string, Profile>([
            ['profile1', {
                profileId: 'profile1',
                server: { 
                    flowId: 'uuid-flow-one', 
                    enableStream: true 
                },
                chatbot: { 
                    labels: { widgetTitle: 'Chatbot One' },
                }
            }],
            ['profile2', {
                profileId: 'profile2',
                server: { 
                    flowId: 'uuid-flow-two', 
                    // enableStream can be omitted, defaults will apply
                },
                chatbot: { 
                    labels: {}, // widgetTitle is optional, so labels.widgetTitle will be undefined
                }
            }],
        ]);
    });

    describe('handleGetChatbotConfigRequest', () => {
        test('should return 200 and the client-safe profile (chatbot section) including proxyBasePath if profileId exists', async () => {
            const targetProfileId = 'profile1';
            await handleGetChatbotConfigRequest(targetProfileId, mockRes, mockConfigurations, mockProxyApiBasePath);

            expect(mockRes.statusCode).toBe(200);
            expect(mockRes.setHeader).toHaveBeenCalledWith('Content-Type', 'application/json');
            
            const originalChatbotProfile = mockConfigurations.get(targetProfileId)!.chatbot;
            const expectedChatbotProfileWithBasePath: ChatbotProfile = {
                ...originalChatbotProfile,
                proxyBasePath: mockProxyApiBasePath
            };

            expect(mockRes.end).toHaveBeenCalledWith(JSON.stringify(expectedChatbotProfileWithBasePath));
            expect(sendJsonError).not.toHaveBeenCalled();
            expect(mockConsoleLog).toHaveBeenCalledWith(`RequestHandler: Received GET request for chatbot configuration: '${targetProfileId}'`);
        });

        test('should call sendJsonError with 404 if profileId does not exist', async () => {
            const targetProfileId = 'non-existent-profile';
            await handleGetChatbotConfigRequest(targetProfileId, mockRes, mockConfigurations, mockProxyApiBasePath);

            expect(sendJsonError).toHaveBeenCalledWith(mockRes, 404, `Chatbot configuration with profileId '${targetProfileId}' not found.`);
            expect(mockRes.end).not.toHaveBeenCalled(); // sendJsonError should handle sending the response
            expect(mockConsoleLog).toHaveBeenCalledWith(`RequestHandler: Received GET request for chatbot configuration: '${targetProfileId}'`);
        });
    });

    describe('handleListChatbotProfilesRequest', () => {
        test('should return 200 and a list of profiles with widgetTitle (defaulting to profileId if missing)', async () => {
            const mockReq = {} as http.IncomingMessage;
            await handleListChatbotProfilesRequest(mockReq, mockRes, mockConfigurations);

            expect(mockRes.statusCode).toBe(200);
            expect(mockRes.setHeader).toHaveBeenCalledWith('Content-Type', 'application/json');

            const expectedProfilesList = [
                {
                    profileId: 'profile1',
                    widgetTitle: mockConfigurations.get('profile1')?.chatbot?.labels?.widgetTitle, // 'Chatbot One'
                },
                {
                    profileId: 'profile2',
                    widgetTitle: 'profile2', // Defaults to profileId as chatbot.labels.widgetTitle is undefined
                },
            ];

            expect(mockRes.end).toHaveBeenCalledWith(JSON.stringify(expectedProfilesList));
            expect(sendJsonError).not.toHaveBeenCalled();
            expect(mockConsoleLog).toHaveBeenCalledWith('RequestHandler: Received GET request to list chatbot profiles.');
        });

        test('should return 200 and an empty list if no configurations exist', async () => {
            const mockReq = {} as http.IncomingMessage;
            const emptyConfigurations = new Map<string, Profile>();
            await handleListChatbotProfilesRequest(mockReq, mockRes, emptyConfigurations);

            expect(mockRes.statusCode).toBe(200);
            expect(mockRes.setHeader).toHaveBeenCalledWith('Content-Type', 'application/json');
            expect(mockRes.end).toHaveBeenCalledWith(JSON.stringify([]));
            expect(sendJsonError).not.toHaveBeenCalled();
            expect(mockConsoleLog).toHaveBeenCalledWith('RequestHandler: Received GET request to list chatbot profiles.');
        });
    });
}); 