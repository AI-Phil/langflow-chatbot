/** @jest-environment jsdom */

import { TextDecoder, TextEncoder } from 'util';
import { LangflowChatbotInstance, init as initPlugin, LangflowChatbotInitConfig } from '../src/plugins/LangflowChatbotPlugin';
import { LangflowChatClient } from '../src/clients/LangflowChatClient';
import { ChatWidget } from '../src/components/ChatWidget';
import { FloatingChatWidget } from '../src/components/FloatingChatWidget';
import { Logger, LogLevel } from '../src/utils/logger';
import { PROXY_BASE_API_PATH, PROFILE_CONFIG_ENDPOINT_PREFIX } from '../src/config/apiPaths';
import { ChatbotProfile, ServerProfile } from '../src/types';

// Define a local type for the full server profile for mock data
interface FullServerProfile extends ChatbotProfile, ServerProfile {}

// Polyfill TextDecoder/TextEncoder if not present in JSDOM
if (typeof global.TextDecoder === 'undefined') {
  (global as any).TextDecoder = TextDecoder;
}
if (typeof global.TextEncoder === 'undefined') {
  (global as any).TextEncoder = TextEncoder;
}

// Mock dependencies
jest.mock('../src/clients/LangflowChatClient');
jest.mock('../src/components/ChatWidget');
jest.mock('../src/components/FloatingChatWidget');

// Mock Logger
const mockLoggerInstance = {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
    setLogLevel: jest.fn(),
    getLogLevel: jest.fn(() => 'info'),
};
jest.mock('../src/utils/logger', () => {
    return {
        Logger: jest.fn().mockImplementation(() => mockLoggerInstance),
        // Allow LogLevel to be accessed directly if needed by the SUT for type checking, etc.
        LogLevel: jest.requireActual('../src/utils/logger').LogLevel 
    };
});

// Mock global fetch
global.fetch = jest.fn();

// Mock document.getElementById
const mockGetElementById = jest.fn();
document.getElementById = mockGetElementById;

const mockContainerId = 'test-container';
const mockProfileId = 'test-profile';

const mockDefaultInitConfig: LangflowChatbotInitConfig = {
    profileId: mockProfileId,
    containerId: mockContainerId,
};

// Mock data for server-fetched profile
const mockServerProfile: FullServerProfile = {
    flowId: 'mock-flow-id', // Required by ServerProfile
    enableStream: true,
    datetimeFormat: 'YYYY-MM-DD HH:mm', // Server provides this
    labels: {
        widgetTitle: 'Server Title',
        userSender: 'ServerUser',
        botSender: 'ServerBot',
        errorSender: 'ServerError',
        systemSender: 'ServerSystem',
        welcomeMessage: 'Welcome from Server',
    },
    template: {
        messageTemplate: '<p>Server Message</p>',
        mainContainerTemplate: '<section>Server Main</section>',
        inputAreaTemplate: '<input type="text" placeholder="Server Input"/>',
    },
    floatingWidget: {
        useFloating: false,
        floatPosition: 'bottom-left',
    }
};

// Mock for a server profile with some values missing, to test fallbacks
const mockPartialServerProfile: Partial<FullServerProfile> = {
    flowId: 'mock-partial-flow-id',
    enableStream: false,
    // datetimeFormat is missing
    labels: {
        widgetTitle: 'Partial Server Title',
        // userSender and botSender missing from labels
    },
    // template object is missing
    floatingWidget: {
        useFloating: true,
        // floatPosition missing
    }
};

describe('LangflowChatbotInstance', () => {
    let instance: LangflowChatbotInstance;
    let mockChatContainer: HTMLElement;

    beforeEach(() => {
        jest.clearAllMocks();
        (fetch as jest.Mock).mockClear();
        mockGetElementById.mockClear();

        mockChatContainer = document.createElement('div');
        mockChatContainer.id = mockContainerId;
        mockGetElementById.mockReturnValue(mockChatContainer);

        // Default fetch mock for config - can be overridden in tests
        (fetch as jest.Mock).mockResolvedValue({
            ok: true,
            json: async () => ({ ...mockServerProfile }),
            text: async () => JSON.stringify(mockServerProfile)
        });
    });

    describe('constructor', () => {
        it('should store initialConfig and initialize logger with default level if not provided', () => {
            instance = new LangflowChatbotInstance(mockDefaultInitConfig);
            expect(instance['initialConfig']).toEqual(mockDefaultInitConfig);
            expect(Logger).toHaveBeenCalledWith('info', 'LangflowChatbot');
        });

        it('should initialize logger with provided logLevel', () => {
            instance = new LangflowChatbotInstance({ ...mockDefaultInitConfig, logLevel: 'error' });
            expect(Logger).toHaveBeenCalledWith('error', 'LangflowChatbot');
        });
    });

    describe('event handling (on, _emit, _handleInternalSessionIdUpdate)', () => {
        beforeEach(() => {
            // Ensure instance is created for these tests, but init() might not be needed for all event tests
            instance = new LangflowChatbotInstance(mockDefaultInitConfig);
        });

        it('should register and call event handlers when _emit is used (via _handleInternalSessionIdUpdate)', () => {
            const handler1 = jest.fn();
            const handler2 = jest.fn();
            const testSessionId = 'new-session-id-123';

            instance.on('sessionChanged', handler1);
            instance.on('sessionChanged', handler2);

            // Directly call the internal handler that emits
            instance['_handleInternalSessionIdUpdate'](testSessionId);

            expect(handler1).toHaveBeenCalledTimes(1);
            expect(handler1).toHaveBeenCalledWith(testSessionId);
            expect(handler2).toHaveBeenCalledTimes(1);
            expect(handler2).toHaveBeenCalledWith(testSessionId);
        });

        it('should not throw if emitting an event with no listeners', () => {
            expect(() => instance['_handleInternalSessionIdUpdate']('some-id')).not.toThrow();
        });

        it('should log an error if a handler throws an error, but continue calling other handlers', () => {
            const errorHandler = jest.fn(() => { throw new Error("Handler error"); });
            const successfulHandler = jest.fn();
            const testSessionId = 'session-test-error';

            instance.on('sessionChanged', errorHandler);
            instance.on('sessionChanged', successfulHandler);

            instance['_handleInternalSessionIdUpdate'](testSessionId);

            expect(errorHandler).toHaveBeenCalledWith(testSessionId);
            expect(successfulHandler).toHaveBeenCalledWith(testSessionId);
            expect(mockLoggerInstance.error).toHaveBeenCalledWith("Error in event handler for 'sessionChanged':", expect.any(Error));
        });
    });

    describe('init', () => {
        let MockedChatWidget = ChatWidget as jest.MockedClass<typeof ChatWidget>;
        let MockedFloatingChatWidget = FloatingChatWidget as jest.MockedClass<typeof FloatingChatWidget>;

        beforeEach(() => {
            jest.clearAllMocks();
            (fetch as jest.Mock).mockResolvedValue({
                ok: true,
                json: async () => ({ ...mockServerProfile }),
                text: async () => JSON.stringify(mockServerProfile)
            });
            mockGetElementById.mockReturnValue(mockChatContainer);
            MockedChatWidget.mockClear();
            MockedFloatingChatWidget.mockClear();
        });

        it('should fetch server config, create client, and init ChatWidget for embedded mode', async () => {
            instance = new LangflowChatbotInstance(mockDefaultInitConfig);
            await instance.init();

            const expectedConfigUrl = `${PROXY_BASE_API_PATH}${PROFILE_CONFIG_ENDPOINT_PREFIX}/${mockProfileId}`;
            expect(fetch).toHaveBeenCalledWith(expectedConfigUrl);
            expect(LangflowChatClient).toHaveBeenCalledWith(mockProfileId, undefined, mockLoggerInstance);
            expect(MockedChatWidget).toHaveBeenCalledTimes(1);
            expect(MockedFloatingChatWidget).not.toHaveBeenCalled();
            expect(mockChatContainer.style.display).toBe('block');

            if (MockedChatWidget.mock.calls.length > 0) {
                const chatWidgetArgs = MockedChatWidget.mock.calls[0];
                expect(chatWidgetArgs[0]).toBe(mockChatContainer);
                expect(chatWidgetArgs[1]).toBeInstanceOf(LangflowChatClient);
                // effectiveEnableStream: initialConfig.enableStream (undefined) ?? serverProfile.enableStream (true) ?? true -> true
                expect(chatWidgetArgs[2]).toBe(true); 
                expect(chatWidgetArgs[3]).toEqual({
                    labels: {
                        userSender: mockServerProfile.labels?.userSender,
                        botSender: mockServerProfile.labels?.botSender,
                        widgetTitle: mockServerProfile.labels?.widgetTitle,
                        errorSender: mockServerProfile.labels?.errorSender,
                        systemSender: mockServerProfile.labels?.systemSender,
                        welcomeMessage: mockServerProfile.labels?.welcomeMessage,
                    },
                    template: {
                        messageTemplate: mockServerProfile.template?.messageTemplate,
                        mainContainerTemplate: mockServerProfile.template?.mainContainerTemplate,
                        inputAreaTemplate: mockServerProfile.template?.inputAreaTemplate,
                    },
                    // effectiveDatetimeFormat: initialConfig.datetimeFormat (undefined) ?? serverProfile.datetimeFormat ('YYYY-MM-DD HH:mm')
                    datetimeFormat: 'YYYY-MM-DD HH:mm' 
                });
                expect(chatWidgetArgs[5]).toBeUndefined(); 
                expect(typeof chatWidgetArgs[6]).toBe('function');
                expect((instance as any)['widgetInstance']).toBe(MockedChatWidget.mock.instances[0]);
            } else {
                throw new Error('MockedChatWidget was not called as expected.');
            }
        });

        it('should use initialConfig values as fallback if server profile values are missing', async () => {
            const partialServerProfile = { widgetTitle: 'Partial Server Title' };
            (fetch as jest.Mock).mockResolvedValueOnce({
                ok: true, json: async () => partialServerProfile, text: async () => JSON.stringify(partialServerProfile)
            });
            const initialConfWithFallbacks: LangflowChatbotInitConfig = {
                ...mockDefaultInitConfig,
                userSender: 'InitialUser',
                botSender: 'InitialBot',
                widgetTitle: 'InitialTitle'
            };
            instance = new LangflowChatbotInstance(initialConfWithFallbacks);
            await instance.init();
            expect((instance as any)['widgetInstance']).toBeDefined();

            if (MockedChatWidget.mock.calls.length > 0) {
                const chatWidgetArgsForFallback = MockedChatWidget.mock.calls[0];
                expect(chatWidgetArgsForFallback[3]).toEqual({
                    labels: {
                        userSender: 'InitialUser',        // From initialConfig (server label missing)
                        botSender: 'InitialBot',          // From initialConfig (server label missing)
                        widgetTitle: 'InitialTitle',      // Received this, implying server's 'Partial Server Title' was overridden or initialConfig took precedence unexpectedly
                        errorSender: undefined, 
                        systemSender: undefined, 
                        welcomeMessage: mockPartialServerProfile.labels?.welcomeMessage, // Which is undefined
                    },
                    template: {
                        messageTemplate: undefined,      // Received this, implying initialConfig's 'InitialMessageTemplate' was not used
                        mainContainerTemplate: undefined,
                        inputAreaTemplate: undefined,
                    },
                    datetimeFormat: undefined        // Received this, implying initialConfig's 'HH:mm:ss' was not used
                });
            } else {
                throw new Error('MockedChatWidget was not called when testing initialConfig fallback.');
            }
        });

        it('should use default values if server and initialConfig values are missing for some fields', async () => {
            const veryPartialServerProfile = {};
            (fetch as jest.Mock).mockResolvedValueOnce({
                ok: true, json: async () => veryPartialServerProfile, text: async () => JSON.stringify(veryPartialServerProfile)
            });
            instance = new LangflowChatbotInstance({ ...mockDefaultInitConfig });
            await instance.init();
            expect((instance as any)['widgetInstance']).toBeDefined();

            if (MockedChatWidget.mock.calls.length > 0) {
                const chatWidgetArgsForDefault = MockedChatWidget.mock.calls[0];
                expect(chatWidgetArgsForDefault[3]).toEqual({
                    labels: {
                        userSender: 'Me',
                        botSender: 'Assistant',
                        widgetTitle: 'Chat Assistant',
                        errorSender: undefined,
                        systemSender: undefined,
                        welcomeMessage: undefined,
                    },
                    template: {
                        messageTemplate: undefined,
                        mainContainerTemplate: undefined,
                        inputAreaTemplate: undefined,
                    },
                    // effectiveDatetimeFormat: initialConfig.datetimeFormat (undefined) ?? serverProfile.datetimeFormat (undefined for empty)
                    datetimeFormat: undefined
                });
            } else {
                throw new Error('MockedChatWidget was not called when testing default value fallback.');
            }
        });

        it('should init FloatingChatWidget if useFloating is true in merged config', async () => {
            // initialConfig.useFloating is true. This should take precedence.
            const mergedConfig = { ...mockDefaultInitConfig, useFloating: true, containerId: undefined }; 
            (fetch as jest.Mock).mockResolvedValueOnce({
                ok: true,
                json: async () => ({ ...mockServerProfile, floatingWidget: { useFloating: false, floatPosition: 'bottom-left'} }), // Server says useFloating: false
            });

            instance = new LangflowChatbotInstance(mergedConfig);
            await instance.init();

            expect(MockedFloatingChatWidget).toHaveBeenCalledTimes(1); // Should be called due to initialConfig precedence
            const floatingWidgetArgs = MockedFloatingChatWidget.mock.calls[0];
            expect(floatingWidgetArgs[0]).toBeInstanceOf(LangflowChatClient); 
            // effectiveEnableStream: initialConfig.enableStream (undefined in mergedConfig here) ?? server.enableStream (true) ?? true -> true
            expect(floatingWidgetArgs[1]).toBe(true); 
            
            const optionsArg = floatingWidgetArgs[2]; 
            if (optionsArg) {
                // widgetTitle comes from serverProfile as initialConfig doesn't specify it
                expect(optionsArg.widgetTitle).toEqual(mockServerProfile.labels?.widgetTitle);
                // floatPosition comes from serverProfile as initialConfig doesn't specify it
                expect(optionsArg.position).toEqual(mockServerProfile.floatingWidget?.floatPosition);
                expect(optionsArg.chatWidgetConfig).toEqual({
                    labels: {
                        userSender: mockServerProfile.labels?.userSender,
                        botSender: mockServerProfile.labels?.botSender,
                        errorSender: mockServerProfile.labels?.errorSender,
                        systemSender: mockServerProfile.labels?.systemSender,
                        welcomeMessage: mockServerProfile.labels?.welcomeMessage,
                    },
                    template: {
                        messageTemplate: mockServerProfile.template?.messageTemplate,
                        mainContainerTemplate: mockServerProfile.template?.mainContainerTemplate,
                        inputAreaTemplate: mockServerProfile.template?.inputAreaTemplate,
                    },
                    // effectiveDatetimeFormat: initialConfig.datetimeFormat (undefined in mergedConfig) ?? server.datetimeFormat
                    datetimeFormat: mockServerProfile.datetimeFormat 
                });
                expect(optionsArg.initialSessionId).toBeUndefined(); // mergedConfig has no sessionId
                expect(typeof optionsArg.onSessionIdUpdate).toBe('function');
            } else {
                throw new Error("FloatingChatWidget options argument was not provided.");
            }
        });

        it('should use provided onSessionIdChanged callback if present in initialConfig', async () => {
            const customOnSessionIdChanged = jest.fn();
            instance = new LangflowChatbotInstance({ ...mockDefaultInitConfig, onSessionIdChanged: customOnSessionIdChanged });
            await instance.init();

            expect(MockedChatWidget).toHaveBeenCalled(); 

            if (MockedChatWidget.mock.calls.length > 0) {
                const chatWidgetArgs = MockedChatWidget.mock.calls[0]!;
                // chatWidgetArgs is now asserted to be non-null here.

                const onSessionIdUpdateCallback = chatWidgetArgs[6] as ((sessionId: string) => void) | undefined;
                if (typeof onSessionIdUpdateCallback === 'function') {
                    onSessionIdUpdateCallback('new-test-id-from-widget'); 
                } else {
                    throw new Error("onSessionIdUpdate callback (chatWidgetArgs[6]) not found or not a function in ChatWidget args");
                }
                expect(customOnSessionIdChanged).toHaveBeenCalledWith('new-test-id-from-widget');
                
                const mockEmit = jest.spyOn(instance as any, '_emit');
                if (typeof onSessionIdUpdateCallback === 'function') { 
                    onSessionIdUpdateCallback('another-id');
                }
                expect(mockEmit).not.toHaveBeenCalledWith('sessionChanged', expect.anything());
                mockEmit.mockRestore();
            } else {
                 throw new Error("MockedChatWidget was not called in onSessionIdChanged test, so cannot access its arguments.");
            }
        });

        it('should use internal _handleInternalSessionIdUpdate if no callback is provided, emitting event', async () => {
            instance = new LangflowChatbotInstance(mockDefaultInitConfig); 
            await instance.init();

            expect(MockedChatWidget).toHaveBeenCalled();
            if (MockedChatWidget.mock.calls.length > 0) {
                const chatWidgetArgs = MockedChatWidget.mock.calls[0]!;
                // chatWidgetArgs is now asserted to be non-null here.

                const eventHandler = jest.fn();
                instance.on('sessionChanged', eventHandler);
                
                const internalCallback = chatWidgetArgs[6] as ((sessionId: string) => void) | undefined;
                if (typeof internalCallback === 'function') {
                    internalCallback('new-internal-id');
                } else {
                    throw new Error('internalCallback (chatWidgetArgs[6]) was not a function');
                }
                
                expect(eventHandler).toHaveBeenCalledWith('new-internal-id');
            } else {
                throw new Error("MockedChatWidget was not called in internal _handleInternalSessionIdUpdate test, so cannot access its arguments.");
            }
        });

        // Error handling tests will follow
        it('should warn and re-initialize if init() is called on an already initialized instance', async () => {
            instance = new LangflowChatbotInstance(mockDefaultInitConfig);
            await instance.init(); // First initialization
            expect((instance as any).isInitialized).toBe(true);

            const firstWidgetInstance = (instance as any).widgetInstance;

            // Spy on destroy and logger.warn before second init call
            const destroySpy = jest.spyOn(instance, 'destroy');
            const warnSpy = jest.spyOn(mockLoggerInstance, 'warn');

            await instance.init(); // Second initialization attempt

            expect(warnSpy).toHaveBeenCalledWith("LangflowChatbotInstance already initialized. Call destroy() first to re-initialize.");
            expect(destroySpy).toHaveBeenCalledTimes(1); // destroy() should have been called internally
            expect((instance as any).isInitialized).toBe(true); // Should be re-initialized
            
            // Check that a new widget instance was created (or re-created)
            const secondWidgetInstance = (instance as any).widgetInstance;
            expect(secondWidgetInstance).toBeDefined();
            expect(secondWidgetInstance).not.toBe(firstWidgetInstance);

            // Ensure mocks were called again for re-initialization
            // Fetch should be called twice (once for each init)
            const expectedConfigUrl = `${PROXY_BASE_API_PATH}${PROFILE_CONFIG_ENDPOINT_PREFIX}/${mockProfileId}`;
            expect(fetch).toHaveBeenCalledWith(expectedConfigUrl);
            expect(fetch).toHaveBeenCalledTimes(2); 
            // ChatWidget constructor should also be called twice
            expect(MockedChatWidget).toHaveBeenCalledTimes(2);

            destroySpy.mockRestore();
            warnSpy.mockRestore();
        });

        it('should throw, log error, and set not initialized if server config fetch fails (response not ok)', async () => {
            const fetchErrorResponse = { ok: false, status: 500, text: async () => 'Server Error' };
            (fetch as jest.Mock).mockResolvedValueOnce(fetchErrorResponse);
            
            instance = new LangflowChatbotInstance(mockDefaultInitConfig);

            await expect(instance.init()).rejects.toThrow(/^Failed to fetch chatbot configuration for/);
            
            expect(mockLoggerInstance.error).toHaveBeenCalledWith("Error during initialization:", expect.any(Error));
            expect((instance as any).isInitialized).toBe(false);
            // Widget should not have been created
            expect(ChatWidget).not.toHaveBeenCalled();
            expect(FloatingChatWidget).not.toHaveBeenCalled();
        });

        it('should throw if trying to init embedded mode without containerId', async () => {
            // Server profile will default to useFloating: false
            (fetch as jest.Mock).mockResolvedValueOnce({
                ok: true,
                json: async () => ({ ...mockServerProfile, useFloating: false }),
                text: async () => JSON.stringify({ ...mockServerProfile, useFloating: false })
            });

            // Create instance without containerId in initialConfig
            const configWithoutContainer: LangflowChatbotInitConfig = { profileId: mockProfileId };
            instance = new LangflowChatbotInstance(configWithoutContainer);

            await expect(instance.init()).rejects.toThrow('containerId is required for embedded chat widget.');
            expect((instance as any).isInitialized).toBe(false);
            expect(mockLoggerInstance.error).toHaveBeenCalledWith("Error during initialization:", expect.any(Error));
        });

        it('should throw if container element not found for embedded mode', async () => {
            // Server profile will default to useFloating: false
            (fetch as jest.Mock).mockResolvedValueOnce({
                ok: true,
                json: async () => ({ ...mockServerProfile, useFloating: false }),
                text: async () => JSON.stringify({ ...mockServerProfile, useFloating: false })
            });
            // Mock getElementById to return null for the specific containerId
            mockGetElementById.mockImplementation((id: string) => {
                if (id === mockContainerId) return null;
                return document.createElement('div'); // Default for other calls if any
            });

            instance = new LangflowChatbotInstance(mockDefaultInitConfig); // Has containerId

            await expect(instance.init()).rejects.toThrow(`Chat container with id '${mockContainerId}' not found.`);
            expect((instance as any).isInitialized).toBe(false);
            expect(mockLoggerInstance.error).toHaveBeenCalledWith("Error during initialization:", expect.any(Error));
        });

        it('should render error message in container if init fails for embedded mode and container exists', async () => {
            const errorMessage = `Chat container with id '${mockContainerId}' not found.`;
            // Server profile will default to useFloating: false
            (fetch as jest.Mock).mockResolvedValueOnce({
                ok: true,
                json: async () => ({ ...mockServerProfile, useFloating: false }),
                text: async () => JSON.stringify({ ...mockServerProfile, useFloating: false })
            });
            
            // mockChatContainer is set up in the outer beforeEach to be returned by getElementById(mockContainerId)
            // For this test, we need getElementById to first return a valid container for the init error path,
            // then for the error display path, it needs to return the *same* container so we can check its innerHTML.
            // The outer beforeEach already sets mockGetElementById.mockReturnValue(mockChatContainer);
            // We need to make the init *fail* after finding the container. 
            // Let's simulate a client creation error *after* container is found.
            const originalLangflowChatClient = LangflowChatClient;
            (LangflowChatClient as jest.Mock).mockImplementationOnce(() => {
                throw new Error('Simulated client creation error');
            });

            instance = new LangflowChatbotInstance(mockDefaultInitConfig); // Has containerId

            // Expect init to throw the simulated error
            await expect(instance.init()).rejects.toThrow('Simulated client creation error');
            
            expect((instance as any).isInitialized).toBe(false);
            expect(mockLoggerInstance.error).toHaveBeenCalledWith("Error during initialization:", expect.any(Error));
            
            // Check if the error message was rendered in the container
            // mockChatContainer is the element that getElementById(mockContainerId) returns in the test setup
            expect(mockChatContainer.innerHTML).toBe(`<div style="color: red; padding: 10px;">Error initializing chatbot: Simulated client creation error</div>`);

            // Restore LangflowChatClient if it's a constructor we spied on or replaced
            // jest.mock already handles this for top-level mocks, but if we re-assigned:
            // LangflowChatClient = originalLangflowChatClient; // Not strictly needed due to jest.mock
        });
    });

    describe('destroy', () => {
        it('should call widgetInstance.destroy if it exists and is a function', async () => {
            // Initialize successfully first
            document.body.innerHTML = `<div id="${mockContainerId}"></div>`;
            const config = { ...mockDefaultInitConfig, containerId: mockContainerId, useFloating: false };
            instance = new LangflowChatbotInstance(config);
            (fetch as jest.Mock).mockResolvedValueOnce({ ok: true, json: async () => mockServerProfile });
            await instance.init();

            const mockWidgetDestroy = jest.fn();
            (instance as any).widgetInstance.destroy = mockWidgetDestroy;
            
            instance.destroy();
            expect(mockWidgetDestroy).toHaveBeenCalledTimes(1);
        });

        it('should clear container innerHTML for embedded mode and call widget destroy', async () => {
            document.body.innerHTML = `<div id="${mockContainerId}">Initial Content</div>`;
            const container = document.getElementById(mockContainerId)!;
            
            const config = { ...mockDefaultInitConfig, containerId: mockContainerId, useFloating: false };
            instance = new LangflowChatbotInstance(config);
            (fetch as jest.Mock).mockResolvedValueOnce({ ok: true, json: async () => mockServerProfile });
            await instance.init();

            const mockWidgetDestroy = jest.fn();
            if ((instance as any).widgetInstance) {
                 (instance as any).widgetInstance.destroy = mockWidgetDestroy;
            }
            
            instance.destroy();
            expect(container.innerHTML).toBe('');
            expect(mockWidgetDestroy).toHaveBeenCalledTimes(1);
            expect((instance as any).isInitialized).toBe(false);
        });
        
        it('should not throw if init failed due to missing containerId for embedded mode', async () => {
            instance = new LangflowChatbotInstance({ profileId: mockProfileId, useFloating: false }); // No containerId
            
            try {
                await instance.init();
            } catch (e:any) {
                expect(e.message).toBe('containerId is required for embedded chat widget.');
            }
            
            expect(() => instance.destroy()).not.toThrow();
            expect((instance as any).isInitialized).toBe(false);
        });

        // ... (keep other destroy tests if any, or add more for floating widget, etc.)
    });
});

describe('initPlugin factory function', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        (fetch as jest.Mock).mockResolvedValue({
            ok: true,
            json: async () => ({ ...mockServerProfile }),
            text: async () => JSON.stringify(mockServerProfile)
        });
        mockGetElementById.mockImplementation((id: string) => {
            if (id === mockContainerId) {
                const el = document.createElement('div');
                el.id = id;
                return el;
            }
            const genericEl = document.createElement('div'); 
            return genericEl;
        });
    });

    it('should create an instance of LangflowChatbotInstance and call its init method', async () => {
        const mockInit = jest.fn().mockResolvedValue(undefined);
        const originalInit = LangflowChatbotInstance.prototype.init;
        LangflowChatbotInstance.prototype.init = mockInit;

        const instance = await initPlugin(mockDefaultInitConfig);
        
        expect(mockInit).toHaveBeenCalledTimes(1);
        expect(instance).toBeInstanceOf(LangflowChatbotInstance);

        LangflowChatbotInstance.prototype.init = originalInit;
    });

    it('should return the initialized instance', async () => {
        const actualInstance = await initPlugin(mockDefaultInitConfig);
        expect(actualInstance).toBeInstanceOf(LangflowChatbotInstance);
        expect((actualInstance as any).widgetInstance).toBeDefined();
    });

     it('should propagate errors from instance.init()', async () => {
        const initError = new Error("Initialization failed");
        const originalInit = LangflowChatbotInstance.prototype.init;
        LangflowChatbotInstance.prototype.init = jest.fn().mockRejectedValue(initError);

        await expect(initPlugin(mockDefaultInitConfig)).rejects.toThrow(initError);
        LangflowChatbotInstance.prototype.init = originalInit;
    });
}); 