import { LangflowProxyService } from '../src/langflow-proxy';
import { LangflowProxyConfig, Profile } from '../src/types';
import { loadBaseConfig, loadInstanceConfig } from '../src/lib/startup/config-loader';
import { FlowMapper } from '../src/utils/flow-mapper';
import { handleRequest as handleRequestFromModule } from '../src/lib/request-handler';
import http from 'http'; // Import for IncomingMessage and ServerResponse
import { sendJsonError } from '../src/lib/request-utils'; // Import the mock

// Mock dependencies
jest.mock('../src/lib/startup/config-loader');

// Mock FlowMapper
const mockInitializeFlowMapper = jest.fn().mockResolvedValue(undefined);
const mockGetTrueFlowId = jest.fn();
jest.mock('../src/utils/flow-mapper', () => ({
    FlowMapper: jest.fn().mockImplementation(() => ({
        initialize: mockInitializeFlowMapper,
        getTrueFlowId: mockGetTrueFlowId,
    })),
}));

jest.mock('../src/lib/request-handler');
jest.mock('@datastax/langflow-client');
jest.mock('../src/lib/request-utils', () => ({
    ...jest.requireActual('../src/lib/request-utils'),
    sendJsonError: jest.fn(),
}));

const mockLoadBaseConfig = loadBaseConfig as jest.Mock;
const mockLoadInstanceConfig = loadInstanceConfig as jest.Mock;
const MockedFlowMapperInstance = FlowMapper as jest.MockedClass<typeof FlowMapper>; // Renamed for clarity

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
        serverDefaults: { enableStream: true, datetimeFormat: 'YYYY-MM-DD HH:mm:ss' } as Profile['server'],
        chatbotDefaults: {
            labels: { widgetTitle: 'Default Title', userSender: 'You', botSender: 'Bot' },
            template: { mainContainerTemplate: '<main></main>' },
            floatingWidget: { useFloating: false, floatPosition: 'bottom-right' as const },
        } as Profile['chatbot'],
    };

    beforeEach(() => {
        mockLoadBaseConfig.mockReset().mockReturnValue(JSON.parse(JSON.stringify(baseConfigDefaults)));
        mockLoadInstanceConfig.mockReset().mockReturnValue([]);
        
        // Reset FlowMapper mocks
        MockedFlowMapperInstance.mockClear(); // Use the renamed mock
        mockInitializeFlowMapper.mockClear().mockResolvedValue(undefined); // Default successful initialization
        mockGetTrueFlowId.mockClear().mockImplementation(id => id); // Default: pass through ID

        actualMockHandleRequestFromModule.mockReset();
        actualMockHandleRequestFromModule.mockImplementation((req, res, flowConfigs, lc, ep, ak, makeReqFn, basePath, preParsedBody, isBodyPreParsed) => {
            capturedReqUrlAtCall = req.url;
            capturedPreParsedBodyAtCall = preParsedBody;
            capturedIsBodyPreParsedAtCall = isBodyPreParsed;
            return Promise.resolve();
        });

        consoleLogSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
        consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
        consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

        mockFetch = jest.fn();
        global.fetch = mockFetch;

        (sendJsonError as jest.Mock).mockClear();
    });

    afterEach(() => {
        consoleLogSpy.mockRestore();
        consoleWarnSpy.mockRestore();
        consoleErrorSpy.mockRestore();
        jest.restoreAllMocks();
    });

    describe('Constructor Validations and Synchronous Initialization', () => {
        it('should instantiate successfully with valid config and log initial messages', () => {
            const config: LangflowProxyConfig = {
                instanceConfigPath: validInstanceConfigPath,
                proxyApiBasePath: validProxyApiBasePath,
            };
            // Constructor is synchronous
            expect(() => new LangflowProxyService(config)).not.toThrow();
            expect(MockedFlowMapperInstance).toHaveBeenCalledTimes(1); // FlowMapper is instantiated
            expect(consoleLogSpy).toHaveBeenCalledWith(`LangflowProxyService: API Base Path configured to: ${validProxyApiBasePath}`);
            expect(consoleLogSpy).toHaveBeenCalledWith(`LangflowProxyService: LangflowClient initialized. Configured Endpoint: ${baseConfigDefaults.langflowConnection.endpoint_url}`);
            // Async init is kicked off by constructor, which calls initialize on the FlowMapper instance
            expect(mockInitializeFlowMapper).toHaveBeenCalledTimes(1); 
        });

        it('should store the provided proxyApiBasePath after instantiation', () => {
            const config: LangflowProxyConfig = {
                instanceConfigPath: validInstanceConfigPath,
                proxyApiBasePath: validProxyApiBasePath,
            };
            const service = new LangflowProxyService(config);
            // @ts-expect-error Accessing private member for test purposes
            expect(service.proxyApiBasePath).toBe(validProxyApiBasePath);
        });

        it('should throw TypeError if proxyApiBasePath is not provided in config for constructor', () => {
            const config = {
                instanceConfigPath: validInstanceConfigPath,
            } as Omit<LangflowProxyConfig, 'proxyApiBasePath'>;
            expect(() => new LangflowProxyService(config as LangflowProxyConfig)).toThrow(
                'LangflowProxyService: proxyApiBasePath is required in config and must be a non-empty string.'
            );
        });
        
        it('should throw TypeError if proxyApiBasePath is an empty string (whitespace)', () => {
            const config: LangflowProxyConfig = {
                instanceConfigPath: validInstanceConfigPath,
                proxyApiBasePath: '   ', // Whitespace only
            };
            expect(() => new LangflowProxyService(config)).toThrow(
                'LangflowProxyService: proxyApiBasePath is required in config and must be a non-empty string.'
            );
        });


        it('should re-throw errors from loadBaseConfig (synchronous constructor part)', () => {
            const errorMessage = 'Base config loading failed';
            mockLoadBaseConfig.mockImplementation(() => {
                throw new Error(errorMessage);
            });
            const config: LangflowProxyConfig = {
                instanceConfigPath: validInstanceConfigPath,
                proxyApiBasePath: validProxyApiBasePath,
            };
            expect(() => new LangflowProxyService(config)).toThrow(errorMessage);
        });

        it('should re-throw errors from loadInstanceConfig (synchronous constructor part)', () => {
            const errorMessage = 'Instance config loading failed';
            mockLoadInstanceConfig.mockImplementation(() => {
                throw new Error(errorMessage);
            });
            const config: LangflowProxyConfig = {
                instanceConfigPath: validInstanceConfigPath,
                proxyApiBasePath: validProxyApiBasePath,
            };
            expect(() => new LangflowProxyService(config)).toThrow(errorMessage);
        });
    });

    describe('Asynchronous Initialization and Profile Loading (_internalAsyncInit)', () => {
        it('should log critical error if FlowMapper initialization fails during async init', async () => {
            const flowMapperError = 'FlowMapper init failed';
            // mockInitializeFlowMapper is called by the constructor when _internalAsyncInit is kicked off.
            // We need to mock its rejection before instantiating the service.
            mockInitializeFlowMapper.mockRejectedValueOnce(new Error(flowMapperError));
            const config: LangflowProxyConfig = {
                instanceConfigPath: validInstanceConfigPath,
                proxyApiBasePath: validProxyApiBasePath,
            };
            const service = new LangflowProxyService(config);
            // The error from _internalAsyncInit (and thus flowMapper.initialize) is caught and re-thrown.
            // We access the internal promise to check its rejection.
            // @ts-expect-error Accessing private member for test purposes
            await expect(service.initializationPromise).rejects.toThrow(flowMapperError);
            // Check console log after awaiting the promise that should have logged the error.
            expect(consoleErrorSpy).toHaveBeenCalledWith(`LangflowProxyService: CRITICAL - Error during internal asynchronous initialization: ${flowMapperError}`);
        });

        it('should warn if no chatbot profiles are loaded after async init', async () => {
            mockLoadInstanceConfig.mockReturnValue([]); // No profiles
            const config: LangflowProxyConfig = {
                instanceConfigPath: validInstanceConfigPath,
                proxyApiBasePath: validProxyApiBasePath,
            };
            const service = new LangflowProxyService(config);
            // @ts-expect-error Accessing private member for test purposes
            await service.initializationPromise; // Wait for init to complete
            expect(consoleWarnSpy).toHaveBeenCalledWith("LangflowProxyService: No chatbot profiles were loaded after async init. The service may not function as expected.");
        });

        it('should load, resolve, and merge a single profile with defaults after async init', async () => {
            const rawProfile = {
                profileId: 'profile1',
                server: { flowId: 'flowName1' }, 
                chatbot: { labels: { widgetTitle: 'Profile 1 Title' } }
            } as Profile; // Cast to Profile, assuming loadInstanceConfig returns this structure
            mockLoadInstanceConfig.mockReturnValue([rawProfile]);
            const resolvedUuid = '123e4567-e89b-12d3-a456-426614174000'; // Valid UUID
            mockGetTrueFlowId.mockImplementation(id => id === 'flowName1' ? resolvedUuid : id);

            const config: LangflowProxyConfig = {
                instanceConfigPath: validInstanceConfigPath,
                proxyApiBasePath: validProxyApiBasePath,
            };
            const service = new LangflowProxyService(config);
            const loadedProfile = await service.getChatbotProfile('profile1'); // Await the public getter

            expect(loadedProfile).toBeDefined();
            expect(loadedProfile?.profileId).toBe('profile1');
            expect(loadedProfile?.server.flowId).toBe(resolvedUuid); // Resolved ID
            expect(loadedProfile?.server.enableStream).toBe(baseConfigDefaults.serverDefaults.enableStream);
            expect(loadedProfile?.chatbot.labels?.widgetTitle).toBe('Profile 1 Title');
            // @ts-expect-error Accessing private member for test purposes
            await service.initializationPromise; // Ensure logs from init are fired
            expect(consoleLogSpy).toHaveBeenCalledWith(`LangflowProxyService: Resolved flow identifier 'flowName1' to UUID '${resolvedUuid}' for profile 'profile1'.`);
            expect(consoleLogSpy).toHaveBeenCalledWith(`LangflowProxyService: Loaded profile: 'profile1' configured with resolved flowId '${resolvedUuid}'.`);
        });

        it('should use original flowId if it is already a UUID (after async init)', async () => {
            const uuidFlowId = '00000000-1111-2222-3333-444444444444';
            const rawProfile = { profileId: 'profileUUID', server: { flowId: uuidFlowId } } as Profile;
            mockLoadInstanceConfig.mockReturnValue([rawProfile]);
            // getTrueFlowId should return the UUID itself
            mockGetTrueFlowId.mockImplementation(id => id === uuidFlowId ? uuidFlowId : undefined);

            const config: LangflowProxyConfig = {
                instanceConfigPath: validInstanceConfigPath,
                proxyApiBasePath: validProxyApiBasePath,
            };
            const service = new LangflowProxyService(config);
            const loadedProfile = await service.getChatbotProfile('profileUUID');

            expect(loadedProfile?.server.flowId).toBe(uuidFlowId);
            // @ts-expect-error Accessing private member for test purposes
            await service.initializationPromise; // Ensure logs from init are fired
            expect(consoleLogSpy).not.toHaveBeenCalledWith(expect.stringContaining('Resolved flow identifier')); // No resolution message if already UUID
            expect(consoleLogSpy).toHaveBeenCalledWith(`LangflowProxyService: Loaded profile: 'profileUUID' configured with resolved flowId '${uuidFlowId}'.`);
        });

        it('should log critical error if flow identifier cannot be resolved and is not a UUID (after async init)', async () => {
            const rawProfile = { profileId: 'profileUnresolved', server: { flowId: 'unresolvableName' } } as Profile;
            mockLoadInstanceConfig.mockReturnValue([rawProfile]);
            mockGetTrueFlowId.mockImplementation(id => undefined); // Simulate unresolvable

            const config: LangflowProxyConfig = {
                instanceConfigPath: validInstanceConfigPath,
                proxyApiBasePath: validProxyApiBasePath,
            };
            const service = new LangflowProxyService(config);
            const loadedProfile = await service.getChatbotProfile('profileUnresolved'); // This will wait for init

            expect(loadedProfile?.server.flowId).toBe('unresolvableName'); // Remains original
            // @ts-expect-error Accessing private member for test purposes
            await service.initializationPromise; // Ensure logs from init are fired
            expect(consoleErrorSpy).toHaveBeenCalledWith("LangflowProxyService: CRITICAL - Could not resolve flow identifier 'unresolvableName' for profile 'profileUnresolved'. This profile will not function correctly as the identifier is not a valid UUID and was not found in the flow map.");
            expect(consoleLogSpy).toHaveBeenCalledWith("LangflowProxyService: Loaded profile: 'profileUnresolved' configured with resolved flowId 'unresolvableName'.");
            expect(consoleWarnSpy).toHaveBeenCalledWith(expect.stringContaining("1 profiles have unresolved flow identifiers and may not function."));
        });

        it('should load a profile with specific values overriding defaults after resolution (after async init)', async () => {
            const resolvedUuid = '00000000-0000-0000-0000-222222222222'; // Valid UUID
            const mockProfile: Profile = {
                profileId: 'profile2',
                server: { 
                    flowId: 'flowName2', 
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
            mockGetTrueFlowId.mockImplementation(id => id === 'flowName2' ? resolvedUuid : id);

            const config: LangflowProxyConfig = {
                instanceConfigPath: validInstanceConfigPath,
                proxyApiBasePath: validProxyApiBasePath,
            };
            const service = new LangflowProxyService(config);
            const loadedProfile = await service.getChatbotProfile('profile2');

            expect(loadedProfile?.server.flowId).toBe(resolvedUuid);
            expect(loadedProfile?.server.enableStream).toBe(false);
            expect(loadedProfile?.chatbot.labels?.widgetTitle).toBe('Profile 2 Custom');
             // @ts-expect-error Accessing private member for test purposes
            await service.initializationPromise; // Ensure logs from init are fired
            expect(consoleLogSpy).toHaveBeenCalledWith(`LangflowProxyService: Resolved flow identifier 'flowName2' to UUID '${resolvedUuid}' for profile 'profile2'.`);
        });

        it('should load multiple profiles correctly with mixed resolution outcomes (after async init)', async () => {
            const validUuidForP1 = '11111111-1111-1111-1111-111111111111';
            const validUuidForP2 = '22222222-2222-2222-2222-222222222222';
            const profiles = [
                { profileId: 'p1', server: { flowId: 'f1name' } }, // will resolve to validUuidForP1
                { profileId: 'p2', server: { flowId: validUuidForP2 } }, // already validUuidForP2
                { profileId: 'p3', server: { flowId: 'f3unresolved' } } // will not resolve
            ] as Profile[]; // Cast to ensure type Profile is used here as mockLoadInstanceConfig returns Profile[]
            mockLoadInstanceConfig.mockReturnValue(profiles);
            mockGetTrueFlowId.mockImplementation(id => {
                if (id === 'f1name') return validUuidForP1;
                if (id === validUuidForP2) return validUuidForP2; // Simulate it's already a UUID or resolved by FlowMapper
                return undefined; // for f3unresolved
            });

            const config: LangflowProxyConfig = {
                instanceConfigPath: validInstanceConfigPath,
                proxyApiBasePath: validProxyApiBasePath,
            };
            const service = new LangflowProxyService(config);
            
            const profile1 = await service.getChatbotProfile('p1');
            const profile2 = await service.getChatbotProfile('p2');
            const profile3 = await service.getChatbotProfile('p3');

            expect(profile1?.server.flowId).toBe(validUuidForP1);
            expect(profile2?.server.flowId).toBe(validUuidForP2);
            expect(profile3?.server.flowId).toBe('f3unresolved');

            // @ts-expect-error Accessing private member for test purposes
            await service.initializationPromise; // Ensure all logs from init have fired
            expect(consoleLogSpy).toHaveBeenCalledWith(`LangflowProxyService: Resolved flow identifier 'f1name' to UUID '${validUuidForP1}' for profile 'p1'.`);
            expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining("Could not resolve flow identifier 'f3unresolved' for profile 'p3'."));
            expect(consoleLogSpy).toHaveBeenCalledWith(`LangflowProxyService: Loaded profile: 'p1' configured with resolved flowId '${validUuidForP1}'.`);
            expect(consoleLogSpy).toHaveBeenCalledWith(`LangflowProxyService: Loaded profile: 'p2' configured with resolved flowId '${validUuidForP2}'.`);
            expect(consoleLogSpy).toHaveBeenCalledWith("LangflowProxyService: Loaded profile: 'p3' configured with resolved flowId 'f3unresolved'.");
            expect(consoleWarnSpy).toHaveBeenCalledWith("LangflowProxyService: Finished async profile loading. 2 profiles have a valid resolved flowId. 1 profiles have unresolved flow identifiers and may not function.");
        });
    });

    describe('Getter Methods (post-initialization)', () => {
        const rawMockProfile1 = {
            profileId: 'getterProfile1',
            server: { flowId: 'gf1name', enableStream: true, datetimeFormat: 'testFormat1' },
            chatbot: { labels: { widgetTitle: 'Getter Profile 1' } }
        } as Profile;
        const resolvedMockProfile1Id = '00000000-0000-0000-0000-111111111111'; // Valid UUID

        let serviceWithProfiles: LangflowProxyService;

        beforeEach(async () => {
            mockLoadInstanceConfig.mockReturnValue([rawMockProfile1]);
            mockGetTrueFlowId.mockImplementation(id => id === 'gf1name' ? resolvedMockProfile1Id : id);
            const config: LangflowProxyConfig = {
                instanceConfigPath: validInstanceConfigPath,
                proxyApiBasePath: validProxyApiBasePath,
            };
            serviceWithProfiles = new LangflowProxyService(config);
            // Ensure initialization completes before tests in this describe block run for getters
            // This is crucial as getters depend on the async initialization.
            // @ts-expect-error Accessing private member for test purposes
            await serviceWithProfiles.initializationPromise; 
        });

        it('getChatbotProfile should return the correct fully merged and resolved profile or undefined', async () => {
            const profile = await serviceWithProfiles.getChatbotProfile('getterProfile1');
            expect(profile).toBeDefined();
            expect(profile?.server.flowId).toBe(resolvedMockProfile1Id);
            expect(profile?.chatbot.labels?.widgetTitle).toBe('Getter Profile 1');
            // Test for non-existent profile
            await expect(serviceWithProfiles.getChatbotProfile('nonExistent')).resolves.toBeUndefined();
        });

        it('getLangflowConnectionDetails should return the connection details from baseConfig (synchronous)', () => {
            // This getter is synchronous and doesn't depend on initializationPromise directly
            // as baseConfig is loaded synchronously in constructor.
            expect(serviceWithProfiles.getLangflowConnectionDetails()).toEqual(baseConfigDefaults.langflowConnection);
        });

        it('getAllFlowConfigs should return a map of all loaded, merged, and resolved profiles', async () => {
            const allConfigs = await serviceWithProfiles.getAllFlowConfigs();
            expect(allConfigs.size).toBe(1);
            const profile = allConfigs.get('getterProfile1');
            expect(profile).toBeDefined();
            expect(profile?.server.flowId).toBe(resolvedMockProfile1Id);
        });

        it('getAllChatbotProfiles should return the same map as getAllFlowConfigs', async () => {
            // Both methods now await the initializationPromise internally
            const allChatbotProfiles = await serviceWithProfiles.getAllChatbotProfiles();
            const allFlowConfigs = await serviceWithProfiles.getAllFlowConfigs(); // Calling again to ensure consistency
            expect(allChatbotProfiles).toBe(allFlowConfigs);
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
            // Mock stream properties
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

        beforeEach(async () => {
            const config: LangflowProxyConfig = {
                instanceConfigPath: validInstanceConfigPath,
                proxyApiBasePath: testProxyApiBasePath,
            };
            mockLoadBaseConfig.mockReturnValue(JSON.parse(JSON.stringify(baseConfigDefaults)));
            mockLoadInstanceConfig.mockReturnValue([]); // Start with no profiles for handleRequest general tests
            // Ensure FlowMapper mocks are reset (already done in outer beforeEach, but good for clarity)
            mockInitializeFlowMapper.mockClear().mockResolvedValue(undefined);
            mockGetTrueFlowId.mockClear().mockImplementation(id => id); 

            service = new LangflowProxyService(config);
            // CRITICAL: Wait for initialization before any handleRequest tests run
            // @ts-expect-error Accessing private member for test purposes
            await service.initializationPromise; 
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
            const basePathWithSlash = '/api/proxy/'; 
            const customDownstream = 'config/myprofile'; 
            const originalUrl = `${basePathWithSlash}${customDownstream}`; 
            
            const tempConfig: LangflowProxyConfig = {
                instanceConfigPath: validInstanceConfigPath,
                proxyApiBasePath: basePathWithSlash,
            };
            service = new LangflowProxyService(tempConfig); // Re-init service with new base path
            // @ts-expect-error Accessing private member for test purposes
            await service.initializationPromise;
            mockReq = createMockHttpReq(originalUrl, originalUrl); 

            await service.handleRequest(mockReq, mockRes);
            expect(actualMockHandleRequestFromModule).toHaveBeenCalledTimes(1);
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
            service = new LangflowProxyService(tempConfig); // Re-init service
            // @ts-expect-error Accessing private member for test purposes
            await service.initializationPromise;
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

            expect(mockReq.url).toBe(initialReqUrl); 
        });

        it('should restore original req.url in finally block when req.url (fallback) was used', async () => {
            const initialReqUrl = `${testProxyApiBasePath}${downstreamPath}`;
            mockReq = createMockHttpReq(initialReqUrl); 
            
            await service.handleRequest(mockReq, mockRes);

            expect(mockReq.url).toBe(initialReqUrl); 
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
            expect(mockReq.url).toBe(initialReqUrl); 
        });

        it('should call sendJsonError with 404 if path does not start with proxyApiBasePath', async () => {
            const wrongPath = "/nottheproxy/config/someprofile";
            mockReq = createMockHttpReq(wrongPath, wrongPath); 

            await service.handleRequest(mockReq, mockRes);

            expect(sendJsonError).toHaveBeenCalledWith(mockRes, 404, "Endpoint not found. Path mismatch with proxy base.");
            expect(actualMockHandleRequestFromModule).not.toHaveBeenCalled();
        });
        
        it('should call sendJsonError with 404 if req.url (fallback) does not start with proxyApiBasePath', async () => {
            const wrongPath = "/nottheproxy/config/someprofile";
            mockReq = createMockHttpReq(wrongPath); 

            await service.handleRequest(mockReq, mockRes);

            expect(sendJsonError).toHaveBeenCalledWith(mockRes, 404, "Endpoint not found. Path mismatch with proxy base.");
            expect(actualMockHandleRequestFromModule).not.toHaveBeenCalled();
        });

        // Body Handling Preparation Tests
        it('should call handleRequestFromModule with isBodyPreParsed=true and preParsedBody if req.body is populated', async () => {
            const requestBody = { message: 'Hello there', sessionId: '123' };
            const initialReqUrl = `${testProxyApiBasePath}${downstreamPath}`;
            mockReq = createMockHttpReq(downstreamPath, initialReqUrl, requestBody);
            (mockReq as any).body = requestBody;

            await service.handleRequest(mockReq, mockRes);

            expect(actualMockHandleRequestFromModule).toHaveBeenCalledTimes(1);
            expect(actualMockHandleRequestFromModule).toHaveBeenCalledWith(
                expect.anything(), // req
                expect.anything(), // res
                expect.any(Map),   // flowConfigs
                expect.anything(), // langflowClient
                baseConfigDefaults.langflowConnection.endpoint_url,
                baseConfigDefaults.langflowConnection.api_key,
                expect.any(Function), // _makeDirectLangflowApiRequest
                testProxyApiBasePath,
                requestBody,      
                true              
            );
            expect(capturedReqUrlAtCall).toBe(downstreamPath);
            expect(capturedPreParsedBodyAtCall).toBe(requestBody);
            expect(capturedIsBodyPreParsedAtCall).toBe(true);
        });

        it('should call handleRequestFromModule with isBodyPreParsed=false and preParsedBody=undefined if req.body is not populated', async () => {
            const initialReqUrl = `${testProxyApiBasePath}${downstreamPath}`;
            mockReq = createMockHttpReq(initialReqUrl);
            
            delete (mockReq as any).body; // Ensure body is not there

            await service.handleRequest(mockReq, mockRes);

            expect(actualMockHandleRequestFromModule).toHaveBeenCalledTimes(1);
            expect(actualMockHandleRequestFromModule).toHaveBeenCalledWith(
                expect.anything(), // req
                expect.anything(), // res
                expect.any(Map),   // flowConfigs
                expect.anything(), // langflowClient
                baseConfigDefaults.langflowConnection.endpoint_url,
                baseConfigDefaults.langflowConnection.api_key,
                expect.any(Function), // _makeDirectLangflowApiRequest
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

        beforeEach(async () => {
            const config: LangflowProxyConfig = {
                instanceConfigPath: validInstanceConfigPath,
                proxyApiBasePath: validProxyApiBasePath,
            };
            service = new LangflowProxyService(config);
            // CRITICAL: Ensure service (including its internal Langflow connection details) is initialized
            // @ts-expect-error Accessing private member for test purposes
            await service.initializationPromise; 

            mockFetch.mockClear(); 
            consoleErrorSpy.mockClear();
            consoleWarnSpy.mockClear(); 
            mockRes = {
                setHeader: jest.fn(),
                end: jest.fn(),
                statusCode: 200, // Default OK status for mockRes
                writeHead: jest.fn(), // Added for completeness if status code changes
            } as unknown as http.ServerResponse;
        });

        it('should return null and log error if endpoint_url is not configured, and set 503 response', async () => {
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

        it('should make a GET request to the correct URL without API key or query params if not provided', async () => {
            // @ts-expect-error Modifying private member for test to remove API key
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
            // API key is present by default from baseConfigDefaults
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
                expect.any(Object) // headers and method
            );
        });

        it('should return the response and log error if fetch response is not ok', async () => {
            const mockFailedResponse = { 
                ok: false, 
                status: 404, 
                statusText: 'Not Found' 
            } as Response;
            mockFetch.mockResolvedValue(mockFailedResponse);

            const result = await service['_makeDirectLangflowApiRequest'](mockRes, defaultPath, 'GET');

            expect(result).toBe(mockFailedResponse); 
            expect(consoleErrorSpy).toHaveBeenCalledWith(`LangflowProxyService: Langflow API request failed: 404 Not Found for path ${defaultPath}`);
        });

        it('should return null and log error if fetch throws an error', async () => {
            const fetchError = new Error('Network failure');
            mockFetch.mockRejectedValueOnce(fetchError); 
            
            const result = await service['_makeDirectLangflowApiRequest'](mockRes, defaultPath, 'GET');
            expect(result).toBeNull(); 
            expect(consoleErrorSpy).toHaveBeenCalledWith(`LangflowProxyService: Error during Langflow API request to ${defaultPath}:`, fetchError);
        });
    });
}); 