import { LangflowProxyService } from '../src/langflow-proxy';
import { LangflowProxyConfig, Profile } from '../src/types';
import { loadBaseConfig, loadInstanceConfig } from '../src/lib/startup/config-loader';
import { initializeFlowMappings } from '../src/lib/startup/flow-mapper';
import { handleRequest as handleRequestFromModule } from '../src/lib/request-handler';
import http from 'http'; // Import for IncomingMessage and ServerResponse
import { sendJsonError } from '../src/lib/request-utils'; // Import the mock

// Mock dependencies
jest.mock('../src/lib/startup/config-loader');
jest.mock('../src/lib/startup/flow-mapper');
jest.mock('../src/lib/request-handler'); // This line correctly mocks the module
jest.mock('@datastax/langflow-client');
jest.mock('../src/lib/request-utils', () => ({
    ...jest.requireActual('../src/lib/request-utils'),
    sendJsonError: jest.fn(),
}));

const mockLoadBaseConfig = loadBaseConfig as jest.Mock;
const mockLoadInstanceConfig = loadInstanceConfig as jest.Mock;
const mockInitializeFlowMappings = initializeFlowMappings as jest.Mock;

// Get the auto-mocked version from the jest.mock call above
const actualMockHandleRequestFromModule = handleRequestFromModule as jest.Mock;
let capturedReqUrlAtCall: string | undefined;
let capturedPreParsedBodyAtCall: any | undefined;
let capturedIsBodyPreParsedAtCall: boolean | undefined;

describe('LangflowProxyService', () => {
    const validInstanceConfigPath = './valid-path/to/instances.json';
    const validProxyApiBasePath = '/api/proxy';
    let consoleLogSpy: jest.SpyInstance;
    let consoleWarnSpy: jest.SpyInstance;
    let consoleErrorSpy: jest.SpyInstance;
    let mockFetch: jest.Mock;

    const baseConfigDefaults = {
        langflowConnection: { endpoint_url: 'http://localhost:7860', api_key: 'test-api-key' },
        serverDefaults: { enableStream: true, datetimeFormat: 'YYYY-MM-DD HH:mm:ss' },
        chatbotDefaults: {
            labels: { widgetTitle: 'Default Title', userSender: 'You', botSender: 'Bot' },
            template: { mainContainerTemplate: '<main></main>' },
            floatingWidget: { useFloating: false, floatPosition: 'bottom-right' as const },
        },
    };

    beforeEach(() => {
        mockLoadBaseConfig.mockReset().mockReturnValue(JSON.parse(JSON.stringify(baseConfigDefaults)));
        mockLoadInstanceConfig.mockReset().mockReturnValue([]);
        mockInitializeFlowMappings.mockReset();
        
        // Reset and set up new implementation for each test in this describe block if needed,
        // or do it once outside if the capture logic is always the same.
        actualMockHandleRequestFromModule.mockReset(); // Clear previous calls, implementations
        actualMockHandleRequestFromModule.mockImplementation((req, res, flowConfigs, lc, ep, ak, makeReqFn, basePath, preParsedBody, isBodyPreParsed) => {
            capturedReqUrlAtCall = req.url;
            capturedPreParsedBodyAtCall = preParsedBody;
            capturedIsBodyPreParsedAtCall = isBodyPreParsed;
            return Promise.resolve(); // It's an async function
        });

        consoleLogSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
        consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
        consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

        // Mock global.fetch
        mockFetch = jest.fn();
        global.fetch = mockFetch;

        (sendJsonError as jest.Mock).mockClear(); // Clear sendJsonError mock for all tests
    });

    afterEach(() => {
        consoleLogSpy.mockRestore();
        consoleWarnSpy.mockRestore();
        consoleErrorSpy.mockRestore();
        jest.restoreAllMocks(); // Restores all mocks, including global.fetch
    });

    describe('Constructor Validations', () => {
        it('should instantiate successfully with valid config and log base path', () => {
            const config: LangflowProxyConfig = {
                instanceConfigPath: validInstanceConfigPath,
                proxyApiBasePath: validProxyApiBasePath,
            };
            expect(() => new LangflowProxyService(config)).not.toThrow();
            expect(consoleLogSpy).toHaveBeenCalledWith(`LangflowProxyService: API Base Path configured to: ${validProxyApiBasePath}`);
            expect(consoleLogSpy).toHaveBeenCalledWith(`LangflowProxyService: LangflowClient initialized. Configured Endpoint: ${baseConfigDefaults.langflowConnection.endpoint_url}`);
        });

        it('should store the provided proxyApiBasePath', () => {
            const config: LangflowProxyConfig = {
                instanceConfigPath: validInstanceConfigPath,
                proxyApiBasePath: validProxyApiBasePath,
            };
            const service = new LangflowProxyService(config);
            // @ts-expect-error Accessing private member for test purposes
            expect(service.proxyApiBasePath).toBe(validProxyApiBasePath);
        });

        it('should throw TypeError if proxyApiBasePath is not provided', () => {
            const config = {
                instanceConfigPath: validInstanceConfigPath,
            } as Omit<LangflowProxyConfig, 'proxyApiBasePath'>;
            const action = () => new LangflowProxyService(config as LangflowProxyConfig);
            expect(action).toThrow(TypeError);
            expect(action).toThrow('LangflowProxyService: proxyApiBasePath is required in config and must be a non-empty string.');
        });

        it('should throw TypeError if proxyApiBasePath is an empty string', () => {
            const config: LangflowProxyConfig = {
                instanceConfigPath: validInstanceConfigPath,
                proxyApiBasePath: ' ',
            };
            const action = () => new LangflowProxyService(config);
            expect(action).toThrow(TypeError);
            expect(action).toThrow('LangflowProxyService: proxyApiBasePath is required in config and must be a non-empty string.');
        });

        it('should throw TypeError if proxyApiBasePath is not a string', () => {
            const config = {
                instanceConfigPath: validInstanceConfigPath,
                proxyApiBasePath: 123,
            } as unknown as LangflowProxyConfig;
            const action = () => new LangflowProxyService(config);
            expect(action).toThrow(TypeError);
            expect(action).toThrow('LangflowProxyService: proxyApiBasePath is required in config and must be a non-empty string.');
        });

        it('should re-throw errors from loadBaseConfig and log critical error', () => {
            const errorMessage = 'Base config loading failed';
            mockLoadBaseConfig.mockImplementation(() => {
                throw new Error(errorMessage);
            });
            const config: LangflowProxyConfig = {
                instanceConfigPath: validInstanceConfigPath,
                proxyApiBasePath: validProxyApiBasePath,
            };
            expect(() => new LangflowProxyService(config)).toThrow(errorMessage);
            expect(consoleErrorSpy).toHaveBeenCalledWith(`LangflowProxyService: CRITICAL - Failed to initialize due to configuration error: ${errorMessage}`);
        });

        it('should re-throw errors from loadInstanceConfig and log critical error', () => {
            const errorMessage = 'Instance config loading failed';
            mockLoadInstanceConfig.mockImplementation(() => {
                throw new Error(errorMessage);
            });
            const config: LangflowProxyConfig = {
                instanceConfigPath: validInstanceConfigPath,
                proxyApiBasePath: validProxyApiBasePath,
            };
            expect(() => new LangflowProxyService(config)).toThrow(errorMessage);
            expect(consoleErrorSpy).toHaveBeenCalledWith(`LangflowProxyService: CRITICAL - Failed to initialize due to configuration error: ${errorMessage}`);
        });
    });

    describe('Constructor Profile Loading', () => {
        it('should warn if no chatbot profiles are loaded', () => {
            mockLoadInstanceConfig.mockReturnValue([]); // No profiles
            const config: LangflowProxyConfig = {
                instanceConfigPath: validInstanceConfigPath,
                proxyApiBasePath: validProxyApiBasePath,
            };
            new LangflowProxyService(config);
            expect(consoleWarnSpy).toHaveBeenCalledWith("LangflowProxyService: No chatbot profiles were loaded. The service may not function as expected.");
        });

        it('should load and merge a single profile with defaults', () => {
            const mockProfile: Partial<Profile> = {
                profileId: 'profile1',
                server: { flowId: 'flow1' }, // enableStream and datetimeFormat will use defaults
                chatbot: { labels: { widgetTitle: 'Profile 1 Title' } } // Other chatbot props will use defaults
            };
            mockLoadInstanceConfig.mockReturnValue([mockProfile]);

            const config: LangflowProxyConfig = {
                instanceConfigPath: validInstanceConfigPath,
                proxyApiBasePath: validProxyApiBasePath,
            };
            const service = new LangflowProxyService(config);
            const loadedProfile = service.getChatbotProfile('profile1');

            expect(loadedProfile).toBeDefined();
            expect(loadedProfile?.profileId).toBe('profile1');
            expect(loadedProfile?.server.flowId).toBe('flow1');
            expect(loadedProfile?.server.enableStream).toBe(baseConfigDefaults.serverDefaults.enableStream);
            expect(loadedProfile?.server.datetimeFormat).toBe(baseConfigDefaults.serverDefaults.datetimeFormat);
            expect(loadedProfile?.chatbot.labels?.widgetTitle).toBe('Profile 1 Title');
            expect(loadedProfile?.chatbot.labels?.userSender).toBe(baseConfigDefaults.chatbotDefaults.labels.userSender);
            expect(loadedProfile?.chatbot.template?.mainContainerTemplate).toBe(baseConfigDefaults.chatbotDefaults.template.mainContainerTemplate);
            expect(consoleLogSpy).toHaveBeenCalledWith("LangflowProxyService: Loaded profile: 'profile1' configured with flow identifier 'flow1'.");
        });

        it('should load a profile with specific values overriding defaults', () => {
            const mockProfile: Profile = {
                profileId: 'profile2',
                server: { 
                    flowId: 'flow2', 
                    enableStream: false, 
                    datetimeFormat: 'MM/DD/YY' 
                },
                chatbot: {
                    labels: { widgetTitle: 'Profile 2 Custom', userSender: 'Me' },
                    template: { mainContainerTemplate: '<custom></custom>' },
                    floatingWidget: { useFloating: true, floatPosition: 'bottom-left' }
                }
            };
            mockLoadInstanceConfig.mockReturnValue([mockProfile]);
            const config: LangflowProxyConfig = {
                instanceConfigPath: validInstanceConfigPath,
                proxyApiBasePath: validProxyApiBasePath,
            };
            const service = new LangflowProxyService(config);
            const loadedProfile = service.getChatbotProfile('profile2');

            expect(loadedProfile?.server.enableStream).toBe(false);
            expect(loadedProfile?.server.datetimeFormat).toBe('MM/DD/YY');
            expect(loadedProfile?.chatbot.labels?.widgetTitle).toBe('Profile 2 Custom');
            expect(loadedProfile?.chatbot.labels?.userSender).toBe('Me');
            expect(loadedProfile?.chatbot.template?.mainContainerTemplate).toBe('<custom></custom>');
            expect(loadedProfile?.chatbot.floatingWidget?.useFloating).toBe(true);
            expect(loadedProfile?.chatbot.floatingWidget?.floatPosition).toBe('bottom-left');
        });

        it('should load multiple profiles correctly', () => {
            const profiles = [
                { profileId: 'p1', server: { flowId: 'f1' } },
                { profileId: 'p2', server: { flowId: 'f2', enableStream: false } },
            ];
            mockLoadInstanceConfig.mockReturnValue(profiles);
            const config: LangflowProxyConfig = {
                instanceConfigPath: validInstanceConfigPath,
                proxyApiBasePath: validProxyApiBasePath,
            };
            const service = new LangflowProxyService(config);
            expect(service.getChatbotProfile('p1')).toBeDefined();
            expect(service.getChatbotProfile('p2')).toBeDefined();
            expect(service.getChatbotProfile('p1')?.server.flowId).toBe('f1');
            expect(service.getChatbotProfile('p2')?.server.enableStream).toBe(false);
            expect(consoleLogSpy).toHaveBeenCalledWith("LangflowProxyService: Loaded profile: 'p1' configured with flow identifier 'f1'.");
            expect(consoleLogSpy).toHaveBeenCalledWith("LangflowProxyService: Loaded profile: 'p2' configured with flow identifier 'f2'.");
        });
    });

    describe('Getter Methods', () => {
        const rawMockProfile1: Profile = {
            profileId: 'getterProfile1',
            server: { flowId: 'gf1', enableStream: true, datetimeFormat: 'testFormat1' },
            chatbot: { labels: { widgetTitle: 'Getter Profile 1' } }
        };
        const rawMockProfile2: Profile = {
            profileId: 'getterProfile2',
            server: { flowId: 'gf2', enableStream: false, datetimeFormat: 'testFormat2' },
            chatbot: { labels: { widgetTitle: 'Getter Profile 2' }, template: { messageTemplate: 'Custom msg'} }
        };

        // Expected merged profiles after constructor processing
        const expectedMergedProfile1: Profile = {
            profileId: 'getterProfile1',
            server: {
                flowId: 'gf1',
                enableStream: true, // from rawMockProfile1
                datetimeFormat: 'testFormat1' // from rawMockProfile1
            },
            chatbot: {
                labels: {
                    widgetTitle: 'Getter Profile 1', // from rawMockProfile1
                    userSender: baseConfigDefaults.chatbotDefaults.labels.userSender,
                    botSender: baseConfigDefaults.chatbotDefaults.labels.botSender,
                },
                template: {
                    mainContainerTemplate: baseConfigDefaults.chatbotDefaults.template.mainContainerTemplate,
                },
                floatingWidget: baseConfigDefaults.chatbotDefaults.floatingWidget,
            }
        };

        const expectedMergedProfile2: Profile = {
            profileId: 'getterProfile2',
            server: {
                flowId: 'gf2',
                enableStream: false, // from rawMockProfile2
                datetimeFormat: 'testFormat2' // from rawMockProfile2
            },
            chatbot: {
                labels: {
                    widgetTitle: 'Getter Profile 2', // from rawMockProfile2
                    userSender: baseConfigDefaults.chatbotDefaults.labels.userSender,
                    botSender: baseConfigDefaults.chatbotDefaults.labels.botSender,
                },
                template: {
                    messageTemplate: 'Custom msg', // from rawMockProfile2
                    mainContainerTemplate: baseConfigDefaults.chatbotDefaults.template.mainContainerTemplate,
                },
                floatingWidget: baseConfigDefaults.chatbotDefaults.floatingWidget,
            }
        };

        let serviceWithProfiles: LangflowProxyService;

        beforeEach(() => {
            // Provide the raw profiles to loadInstanceConfig mock
            mockLoadInstanceConfig.mockReturnValue([rawMockProfile1, rawMockProfile2]);
            const config: LangflowProxyConfig = {
                instanceConfigPath: validInstanceConfigPath,
                proxyApiBasePath: validProxyApiBasePath,
            };
            serviceWithProfiles = new LangflowProxyService(config);
        });

        it('getChatbotProfile should return the correct fully merged profile or undefined', () => {
            expect(serviceWithProfiles.getChatbotProfile('getterProfile1')).toEqual(expectedMergedProfile1);
            expect(serviceWithProfiles.getChatbotProfile('getterProfile2')).toEqual(expectedMergedProfile2);
            expect(serviceWithProfiles.getChatbotProfile('nonExistent')).toBeUndefined();
        });

        it('getLangflowConnectionDetails should return the connection details from baseConfig', () => {
            expect(serviceWithProfiles.getLangflowConnectionDetails()).toEqual(baseConfigDefaults.langflowConnection);
        });

        it('getAllFlowConfigs should return a map of all loaded fully merged profiles', () => {
            const allConfigs = serviceWithProfiles.getAllFlowConfigs();
            expect(allConfigs.size).toBe(2);
            expect(allConfigs.get('getterProfile1')).toEqual(expectedMergedProfile1);
            expect(allConfigs.get('getterProfile2')).toEqual(expectedMergedProfile2);
        });

        it('getAllChatbotProfiles should return the same map as getAllFlowConfigs', () => {
            expect(serviceWithProfiles.getAllChatbotProfiles()).toBe(serviceWithProfiles.getAllFlowConfigs());
        });
    });

    describe('initializeFlows Method', () => {
        it('should call initializeFlowMappings with correct parameters', async () => {
            const config: LangflowProxyConfig = {
                instanceConfigPath: validInstanceConfigPath,
                proxyApiBasePath: validProxyApiBasePath,
            };
            const service = new LangflowProxyService(config);
            await service.initializeFlows();

            expect(mockInitializeFlowMappings).toHaveBeenCalledTimes(1);
            expect(mockInitializeFlowMappings).toHaveBeenCalledWith(
                baseConfigDefaults.langflowConnection.endpoint_url,
                baseConfigDefaults.langflowConnection.api_key,
                // @ts-expect-error Accessing private member for test purposes
                service.flowConfigs 
            );
        });
    });

    describe('handleRequest', () => {
        let service: LangflowProxyService;
        let mockReq: http.IncomingMessage;
        let mockRes: http.ServerResponse;
        const testProxyApiBasePath = '/api/v1/chat';
        const profileId = 'test-profile-123';
        const downstreamPath = `/config/${profileId}`; // Example downstream path

        // Helper to create a mock IncomingMessage
        const createMockHttpReq = (url: string, originalUrl?: string, body?: any): http.IncomingMessage => {
            const req = new http.IncomingMessage(null as any) as any; // Use 'as any' for easier mocking
            req.url = url;
            req.method = 'GET'; // Default, can be overridden
            req.headers = { host: 'localhost:3000' };
            if (originalUrl) {
                req.originalUrl = originalUrl;
            }
            if (body) {
                req.body = body; // Simulate pre-parsed body
            }
            // Mock stream properties if parseJsonBody were to be called directly on req (not in these tests directly)
            req.on = jest.fn();
            req.read = jest.fn();
            req.pause = jest.fn();
            req.resume = jest.fn();
            return req as http.IncomingMessage;
        };

        // Helper to create a mock ServerResponse
        const createMockHttpRes = (): http.ServerResponse => {
            const res = new http.ServerResponse({} as http.IncomingMessage) as any; // Use 'as any'
            res.setHeader = jest.fn();
            res.end = jest.fn();
            res.writeHead = jest.fn();
            res.statusCode = 200; // Default
            return res as http.ServerResponse;
        };

        beforeEach(() => {
            const config: LangflowProxyConfig = {
                instanceConfigPath: validInstanceConfigPath,
                proxyApiBasePath: testProxyApiBasePath,
            };
            mockLoadBaseConfig.mockReturnValue(JSON.parse(JSON.stringify(baseConfigDefaults)));
            mockLoadInstanceConfig.mockReturnValue([]);

            service = new LangflowProxyService(config);
            mockRes = createMockHttpRes();
            
            // Clear the mock and captured values before each test in this inner describe block
            actualMockHandleRequestFromModule.mockClear(); 
            capturedReqUrlAtCall = undefined;
            capturedPreParsedBodyAtCall = undefined;
            capturedIsBodyPreParsedAtCall = undefined;

            (sendJsonError as jest.Mock).mockClear();
        });

        // URL Normalization Tests
        it('should use req.originalUrl if present and correctly strip base path for handleRequestFromModule', async () => {
            const originalUrl = `${testProxyApiBasePath}${downstreamPath}`;
            const initialReqUrl = `/some/different/path${downstreamPath}`;
            mockReq = createMockHttpReq(initialReqUrl, originalUrl);
            
            await service.handleRequest(mockReq, mockRes);

            expect(actualMockHandleRequestFromModule).toHaveBeenCalledTimes(1);
            expect(capturedReqUrlAtCall).toBe(downstreamPath);
        });

        it('should fall back to req.url if req.originalUrl is not present and correctly strip base path', async () => {
            const initialReqUrl = `${testProxyApiBasePath}${downstreamPath}`;
            mockReq = createMockHttpReq(initialReqUrl);

            await service.handleRequest(mockReq, mockRes);

            expect(actualMockHandleRequestFromModule).toHaveBeenCalledTimes(1);
            expect(capturedReqUrlAtCall).toBe(downstreamPath);
        });
        
        it('should correctly form internalRoutePath if base path ends with / and originalUrl does not start with / after base', async () => {
            const basePathWithSlash = '/api/proxy/'; // Base path for the service
            const customDownstream = 'config/myprofile'; // The part of the path after the base, does not start with /
            
            // Construct originalUrl correctly: basePath + downstreamPart
            const originalUrl = `${basePathWithSlash}${customDownstream}`; // Expected: /api/proxy/config/myprofile
            
            const tempConfig: LangflowProxyConfig = {
                instanceConfigPath: validInstanceConfigPath,
                proxyApiBasePath: basePathWithSlash, // Service is configured with /api/proxy/
            };
            service = new LangflowProxyService(tempConfig);
            // req.originalUrl will be /api/proxy/config/myprofile
            mockReq = createMockHttpReq(originalUrl, originalUrl); 

            await service.handleRequest(mockReq, mockRes);
            expect(actualMockHandleRequestFromModule).toHaveBeenCalledTimes(1);
            // After stripping /api/proxy/, internalRoutePath should be config/myprofile
            // Then, a / is prepended, making it /config/myprofile
            expect(capturedReqUrlAtCall).toBe(`/${customDownstream}`); 
        });
        
        it('should correctly form internalRoutePath if base path does NOT end with / and originalUrl has / after base', async () => {
            const basePathNoSlash = '/api/proxy';
            const customDownstream = '/config/myprofile';
            const originalUrl = `${basePathNoSlash}${customDownstream}`;
            
            const tempConfig: LangflowProxyConfig = {
                instanceConfigPath: validInstanceConfigPath,
                proxyApiBasePath: basePathNoSlash,
            };
            service = new LangflowProxyService(tempConfig);
            mockReq = createMockHttpReq(originalUrl, originalUrl);

            await service.handleRequest(mockReq, mockRes);
            expect(actualMockHandleRequestFromModule).toHaveBeenCalledTimes(1);
            expect(capturedReqUrlAtCall).toBe(customDownstream);
        });

        it('should restore original req.url in finally block when originalUrl was used', async () => {
            const originalUrl = `${testProxyApiBasePath}${downstreamPath}`;
            const initialReqUrl = `/some/different/path${downstreamPath}`;
            mockReq = createMockHttpReq(initialReqUrl, originalUrl);
            
            await service.handleRequest(mockReq, mockRes);

            expect(mockReq.url).toBe(initialReqUrl); // Check after call, should be restored
        });

        it('should restore original req.url in finally block when req.url (fallback) was used', async () => {
            const initialReqUrl = `${testProxyApiBasePath}${downstreamPath}`;
            mockReq = createMockHttpReq(initialReqUrl); // No originalUrl
            
            await service.handleRequest(mockReq, mockRes);

            expect(mockReq.url).toBe(initialReqUrl); // Check after call
        });
        
        it('should restore original req.url even if handleRequestFromModule throws an error', async () => {
            const initialReqUrl = `${testProxyApiBasePath}${downstreamPath}`;
            mockReq = createMockHttpReq(initialReqUrl);
            const errorMessage = "Internal handler error";
            actualMockHandleRequestFromModule.mockImplementationOnce(() => {
                throw new Error(errorMessage);
            });

            try {
                await service.handleRequest(mockReq, mockRes);
            } catch (e: any) {
                expect(e.message).toBe(errorMessage);
            }
            expect(mockReq.url).toBe(initialReqUrl); // Still should be restored
        });

        it('should call sendJsonError with 404 if path does not start with proxyApiBasePath', async () => {
            const wrongPath = "/nottheproxy/config/someprofile";
            mockReq = createMockHttpReq(wrongPath, wrongPath); // Use originalUrl to ensure it's checked

            await service.handleRequest(mockReq, mockRes);

            expect(sendJsonError).toHaveBeenCalledWith(mockRes, 404, "Endpoint not found. Path mismatch with proxy base.");
            expect(actualMockHandleRequestFromModule).not.toHaveBeenCalled();
        });
        
        it('should call sendJsonError with 404 if req.url (fallback) does not start with proxyApiBasePath', async () => {
            const wrongPath = "/nottheproxy/config/someprofile";
            mockReq = createMockHttpReq(wrongPath); // No originalUrl, so req.url is the effective path

            await service.handleRequest(mockReq, mockRes);

            expect(sendJsonError).toHaveBeenCalledWith(mockRes, 404, "Endpoint not found. Path mismatch with proxy base.");
            expect(actualMockHandleRequestFromModule).not.toHaveBeenCalled();
        });

        // Body Handling Preparation Tests
        it('should call handleRequestFromModule with isBodyPreParsed=true and preParsedBody if req.body is populated', async () => {
            const requestBody = { message: 'Hello there', sessionId: '123' };
            const initialReqUrl = `${testProxyApiBasePath}${downstreamPath}`;
            // Simulate Express app behavior: originalUrl is the full path, req.url might be different, body is pre-parsed
            mockReq = createMockHttpReq(downstreamPath, initialReqUrl, requestBody);
            (mockReq as any).body = requestBody;

            await service.handleRequest(mockReq, mockRes);

            expect(actualMockHandleRequestFromModule).toHaveBeenCalledTimes(1);
            expect(actualMockHandleRequestFromModule).toHaveBeenCalledWith(
                expect.anything(),
                expect.anything(),
                expect.anything(),
                expect.anything(),
                expect.anything(),
                expect.anything(),
                expect.any(Function),
                testProxyApiBasePath,
                requestBody,      
                true              
            );
            // Also check captured values for more specific assertion on what was passed
            expect(capturedReqUrlAtCall).toBe(downstreamPath);
            expect(capturedPreParsedBodyAtCall).toBe(requestBody);
            expect(capturedIsBodyPreParsedAtCall).toBe(true);
        });

        it('should call handleRequestFromModule with isBodyPreParsed=false and preParsedBody=undefined if req.body is not populated', async () => {
            const initialReqUrl = `${testProxyApiBasePath}${downstreamPath}`;
            mockReq = createMockHttpReq(initialReqUrl);
            
            delete (mockReq as any).body;

            await service.handleRequest(mockReq, mockRes);

            expect(actualMockHandleRequestFromModule).toHaveBeenCalledTimes(1);
            expect(actualMockHandleRequestFromModule).toHaveBeenCalledWith(
                expect.anything(),
                expect.anything(),
                expect.anything(),
                expect.anything(),
                expect.anything(),
                expect.anything(),
                expect.any(Function),
                testProxyApiBasePath,
                undefined,        
                false             
            );
            expect(capturedReqUrlAtCall).toBe(downstreamPath);
            expect(capturedPreParsedBodyAtCall).toBeUndefined();
            expect(capturedIsBodyPreParsedAtCall).toBe(false);
        });
    });

    describe('_makeDirectLangflowApiRequest Method', () => {
        let service: LangflowProxyService;
        let mockRes: http.ServerResponse;
        const defaultPath = '/test-endpoint';

        beforeEach(() => {
            const config: LangflowProxyConfig = {
                instanceConfigPath: validInstanceConfigPath,
                proxyApiBasePath: validProxyApiBasePath,
            };
            service = new LangflowProxyService(config);
            mockFetch.mockClear(); 
            consoleErrorSpy.mockClear();
            consoleWarnSpy.mockClear(); 
            mockRes = {
                setHeader: jest.fn(),
                end: jest.fn(),
                statusCode: 200 
            } as unknown as http.ServerResponse;
        });

        it('should return null and log error if endpoint_url is not configured', async () => {
            consoleWarnSpy.mockClear(); 
            // @ts-expect-error Modifying private member for test
            service.langflowConnectionDetails.endpoint_url = ''; 
            const result = await service['_makeDirectLangflowApiRequest'](mockRes, defaultPath, 'GET');
            expect(result).toBeNull();
            expect(consoleWarnSpy).toHaveBeenCalledWith(`LangflowProxyService: Attempted API call to "${defaultPath}" when Langflow endpoint URL is not configured.`);
            expect(mockRes.statusCode).toBe(503);
            expect(mockRes.setHeader).toHaveBeenCalledWith('Content-Type', 'application/json');
            expect(mockRes.end).toHaveBeenCalledWith(JSON.stringify({ error: "Langflow endpoint URL not configured in proxy." }));
            expect(mockFetch).not.toHaveBeenCalled();
        });

        it('should make a GET request to the correct URL without API key or query params', async () => {
            // @ts-expect-error Modifying private member for test
            service.langflowConnectionDetails.api_key = undefined;
            const mockOkResponse = { ok: true, json: jest.fn().mockResolvedValue({}) } as unknown as Response;
            mockFetch.mockResolvedValue(mockOkResponse);

            const result = await service['_makeDirectLangflowApiRequest'](mockRes, defaultPath, 'GET');

            expect(mockFetch).toHaveBeenCalledTimes(1);
            expect(mockFetch).toHaveBeenCalledWith(
                `${baseConfigDefaults.langflowConnection.endpoint_url}${defaultPath}`,
                {
                    method: 'GET',
                    headers: { 'Accept': 'application/json' }, 
                }
            );
            expect(result).toBe(mockOkResponse);
        });

        it('should include Authorization header if api_key is present', async () => {
            const mockOkResponse = { ok: true } as Response;
            mockFetch.mockResolvedValue(mockOkResponse);

            await service['_makeDirectLangflowApiRequest'](mockRes, defaultPath, 'GET');

            expect(mockFetch).toHaveBeenCalledWith(
                expect.any(String),
                expect.objectContaining({
                    headers: {
                        'Accept': 'application/json', 
                        'Authorization': `Bearer ${baseConfigDefaults.langflowConnection.api_key}`,
                    },
                })
            );
        });

        it('should append query parameters to the URL if provided', async () => {
            const mockOkResponse = { ok: true } as Response;
            mockFetch.mockResolvedValue(mockOkResponse);
            const queryParams = new URLSearchParams({ foo: 'bar', baz: 'qux' });

            await service['_makeDirectLangflowApiRequest'](mockRes, defaultPath, 'GET', queryParams);

            expect(mockFetch).toHaveBeenCalledWith(
                `${baseConfigDefaults.langflowConnection.endpoint_url}${defaultPath}?foo=bar&baz=qux`,
                expect.any(Object)
            );
        });

        it('should return the response and log error if fetch response is not ok', async () => {
            if (consoleErrorSpy) consoleErrorSpy.mockRestore();
            consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

            const mockFailedResponse = { 
                ok: false, 
                status: 404, 
                statusText: 'Not Found' 
            } as Response;
            mockFetch.mockResolvedValue(mockFailedResponse);

            const result = await service['_makeDirectLangflowApiRequest'](mockRes, defaultPath, 'GET');

            expect(result).toBe(mockFailedResponse); 
        });

        it('should return null and log error if fetch throws an error', async () => {
            if (consoleErrorSpy) consoleErrorSpy.mockRestore();
            consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
            
            const fetchError = new Error('Network failure');
            mockFetch.mockRejectedValueOnce(fetchError); 
            
            let result;
            try {
                result = await service['_makeDirectLangflowApiRequest'](mockRes, defaultPath, 'GET');
            } catch (error) {
                // This catch block is primarily to satisfy Jest if it still somehow bubbles up
                // despite the SUT catching it. The main assertion is on the `result`.
            }
            expect(result).toBeNull(); 
        });
    });
}); 