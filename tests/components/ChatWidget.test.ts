/** @jest-environment jsdom */

import { ChatWidget, ChatWidgetConfigOptions } from '../../src/components/ChatWidget';
import { LangflowChatClient } from '../../src/clients/LangflowChatClient';
import { Logger } from '../../src/utils/logger';
import { ChatMessageProcessor, MessageProcessorUICallbacks } from '../../src/components/ChatMessageProcessor';
import { ChatDisplayManager, ChatDisplayManagerConfig } from '../../src/components/ChatDisplayManager';
import { ChatTemplateManager, TemplateManagerConfig } from '../../src/components/ChatTemplateManager';
import { ChatSessionManager } from '../../src/components/ChatSessionManager';
import { DatetimeHandler } from '../../src/utils/datetimeUtils';
import { SVG_MINIMIZE_ICON, SVG_RESET_ICON } from '../../src/config/uiConstants';

// Mock child components/managers AND LangflowChatClient
jest.mock('../../src/clients/LangflowChatClient');
jest.mock('../../src/components/ChatTemplateManager');
jest.mock('../../src/components/ChatDisplayManager');
jest.mock('../../src/components/ChatSessionManager');
jest.mock('../../src/components/ChatMessageProcessor');

// Mock Logger
const mockLogger: jest.Mocked<Logger> = {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    setLevel: jest.fn(),
    // @ts-ignore
    level: 'debug', 
    // @ts-ignore
    prefix: 'TestWidgetLogger',
    // @ts-ignore
    shouldLog: jest.fn().mockReturnValue(true),
    // @ts-ignore
    format: jest.fn((level, ...args) => [`[TestWidgetLogger] [${level.toUpperCase()}]`, ...args]),
    // @ts-ignore
    constructor: jest.fn(),
};

// Default config for most tests
const mockDefaultContainerId = 'chat-widget-test-container';
const mockDefaultProfileId = 'test-profile-id';
const mockBaseApiUrl = 'http://mock-widget-api.com'; // Added for the top-level mock client

// LangflowChatClient constructor: (profileId: string, baseApiUrl: string, logger?: Logger)
const mockChatClientInstance = new LangflowChatClient(mockDefaultProfileId, mockBaseApiUrl, mockLogger);

const defaultTestConfig: ChatWidgetConfigOptions = {
    labels: {},
    template: {},
    // datetimeFormat can still be top-level as per ChatWidgetConfigOptions
};

describe('ChatWidget', () => {
    let containerElement: HTMLElement;
    let minimalConfig: ChatWidgetConfigOptions;

    let MockLangflowChatClient: jest.MockedClass<typeof LangflowChatClient>;
    let mockChatClientInstance: jest.Mocked<LangflowChatClient>;

    // To help type the mocked constructors and instances
    let MockChatTemplateManager: jest.MockedClass<typeof ChatTemplateManager>;
    let MockChatDisplayManager: jest.MockedClass<typeof ChatDisplayManager>;
    let MockChatSessionManager: jest.MockedClass<typeof ChatSessionManager>;
    let MockChatMessageProcessor: jest.MockedClass<typeof ChatMessageProcessor>;

    let mockTemplateManagerInstance: jest.Mocked<ChatTemplateManager>;
    let mockDisplayManagerInstance: jest.Mocked<ChatDisplayManager>;
    let mockSessionManagerInstance: jest.Mocked<ChatSessionManager>;
    let mockMessageProcessorInstance: jest.Mocked<ChatMessageProcessor>;

    beforeEach(() => {
        jest.clearAllMocks();

        MockLangflowChatClient = LangflowChatClient as jest.MockedClass<typeof LangflowChatClient>;
        // LangflowChatClient constructor: (profileId: string, baseApiUrl?: string, logger?: Logger)
        mockChatClientInstance = new MockLangflowChatClient('test-proxy-id', 'http://dummy-api-url', mockLogger) as jest.Mocked<LangflowChatClient>;
        // We will mock specific methods on the instance if ChatWidget itself calls them.
        // For now, it primarily passes the client to other managers which are themselves mocked.
        // Example: If needed, do this *after* instantiation:
        // mockChatClientInstance.sendMessage = jest.fn().mockResolvedValue({ reply: "mock reply", sessionId: "mock-session" });
        // mockChatClientInstance.streamMessage = jest.fn().mockImplementation(async function*() { yield { event: 'end', data: {} }; });
        // mockChatClientInstance.getMessageHistory = jest.fn().mockResolvedValue([]);

        // Setup mock instances for managers
        MockChatTemplateManager = ChatTemplateManager as jest.MockedClass<typeof ChatTemplateManager>;
        MockChatDisplayManager = ChatDisplayManager as jest.MockedClass<typeof ChatDisplayManager>;
        MockChatSessionManager = ChatSessionManager as jest.MockedClass<typeof ChatSessionManager>;
        MockChatMessageProcessor = ChatMessageProcessor as jest.MockedClass<typeof ChatMessageProcessor>;
        
        // Define default return values for getter methods on mocked managers
        // These will be generic and overridden in specific tests if needed.
        mockTemplateManagerInstance = {
            getMainContainerTemplate: jest.fn().mockReturnValue('<div id="chat-widget-header-container"></div><div id="chat-input-area-container"></div><div class="chat-messages"></div>'),
            getInputAreaTemplate: jest.fn().mockReturnValue('<input class="chat-input"/><button class="send-button"></button>'),
            getMessageTemplate: jest.fn().mockReturnValue('<div>{{message}}</div>'),
            getWidgetHeaderTemplate: jest.fn().mockReturnValue('<div class="chat-widget-header"><span class="chat-widget-title-text">{{widgetTitle}}</span><button class="chat-widget-reset-button">{{resetButton}}</button><button class="chat-widget-minimize-button">{{minimizeButton}}</button></div>'),
        } as any;
        MockChatTemplateManager.mockImplementation(() => mockTemplateManagerInstance);

        mockDisplayManagerInstance = {
            addMessageToDisplay: jest.fn(),
            updateBotMessageContent: jest.fn(),
            removeMessageElement: jest.fn(),
            clearMessages: jest.fn(),
            scrollChatToBottom: jest.fn(),
            setDatetimeHandler: jest.fn(),
        } as any;
        MockChatDisplayManager.mockImplementation(() => mockDisplayManagerInstance);
        
        mockSessionManagerInstance = {
            currentSessionId: 'initial-session-id' as string | null,
            isHistoryLoaded: false,
            loadAndDisplayHistory: jest.fn().mockResolvedValue(undefined),
            processSessionIdUpdateFromFlow: jest.fn(),
            setSessionIdAndLoadHistory: jest.fn().mockResolvedValue(undefined),
            updateCurrentSessionId: jest.fn(),
        } as any;
        MockChatSessionManager.mockImplementation(() => mockSessionManagerInstance);

        mockMessageProcessorInstance = {
            process: jest.fn().mockResolvedValue(undefined),
        } as any;
        MockChatMessageProcessor.mockImplementation(() => mockMessageProcessorInstance);

        containerElement = document.createElement('div');
        document.body.appendChild(containerElement);

        minimalConfig = {
            labels: {},
            template: {},
            // datetimeFormat can still be top-level as per ChatWidgetConfigOptions
        };
    });

    afterEach(() => {
        if (containerElement) {
            containerElement.remove();
        }
    });

    it('should be defined', () => {
        const widget = new ChatWidget(containerElement, mockChatClientInstance, true, minimalConfig, mockLogger);
        expect(widget).toBeDefined();
    });

    describe('constructor initialization', () => {
        it('should throw an error if containerElement is null', () => {
            expect(() => new ChatWidget(null as any, mockChatClientInstance, true, minimalConfig, mockLogger))
                .toThrow('Container element provided to ChatWidget is null or undefined.');
        });

        it('should throw an error if chatClient is null', () => {
            expect(() => new ChatWidget(containerElement, null as any, true, minimalConfig, mockLogger))
                .toThrow('LangflowChatClient instance is required.');
        });

        it('should initialize managers with correct parameters using default config', () => {
            new ChatWidget(containerElement, mockChatClientInstance, true, minimalConfig, mockLogger);

            expect(MockChatTemplateManager).toHaveBeenCalledWith(
                { mainContainerTemplate: undefined, inputAreaTemplate: undefined, messageTemplate: undefined, widgetHeaderTemplate: undefined },
                mockLogger
            );
            expect(MockChatDisplayManager).toHaveBeenCalledWith(
                containerElement,
                {
                    messageTemplate: mockTemplateManagerInstance.getMessageTemplate(),
                    userSender: "You", // Default
                    botSender: "Bot",   // Default
                    errorSender: "Error", // Default
                    systemSender: "System", // Default
                    datetimeFormat: undefined, 
                },
                mockLogger
            );
            expect(MockChatSessionManager).toHaveBeenCalledWith(
                mockChatClientInstance,
                { userSender: "You", botSender: "Bot", errorSender: "Error", systemSender: "System" },
                expect.any(Object), // SessionManagerDisplayCallbacks - check specific callbacks later if needed
                mockLogger,
                undefined, // initialSessionId
                undefined // welcomeMessage (default config)
            );
            expect(MockChatMessageProcessor).toHaveBeenCalledWith(
                mockChatClientInstance,
                { userSender: "You", botSender: "Bot", errorSender: "Error", systemSender: "System" },
                mockLogger,
                expect.any(Object), // MessageProcessorUICallbacks
                expect.anything(),  // <<<< Added for IMessageParser
                expect.any(Function), // getEnableStream
                expect.any(Function)  // getCurrentSessionId
            );
        });

        it('should use provided config options to override defaults for managers', () => {
            const customConfig: ChatWidgetConfigOptions = {
                labels: {
                    userSender: "TestUser",
                    botSender: "TestBot",
                    errorSender: "TestError",
                    systemSender: "TestSystem",
                    widgetTitle: "Test Widget Title",
                    welcomeMessage: "Test Welcome",
                },
                template: {
                    mainContainerTemplate: "<main></main>",
                    inputAreaTemplate: "<input />",
                    messageTemplate: "<msg></msg>",
                    widgetHeaderTemplate: "<header>{{widgetTitle}}</header>",
                },
                datetimeFormat: "HH:mm",
            };

            // Reset and define specific mock behavior for getMessageTemplate for this test
            mockTemplateManagerInstance.getMessageTemplate = jest.fn().mockReturnValueOnce("<msg></msg>");

            new ChatWidget(containerElement, mockChatClientInstance, false, customConfig, mockLogger, 'custom-session-id', undefined);

            expect(MockChatTemplateManager).toHaveBeenCalledWith(
                { 
                    mainContainerTemplate: customConfig.template?.mainContainerTemplate, 
                    inputAreaTemplate: customConfig.template?.inputAreaTemplate, 
                    messageTemplate: customConfig.template?.messageTemplate, 
                    widgetHeaderTemplate: customConfig.template?.widgetHeaderTemplate
                }, 
                mockLogger
            );
            
            expect(MockChatDisplayManager).toHaveBeenCalledWith(
                containerElement,
                {
                    messageTemplate: "<msg></msg>", 
                    userSender: customConfig.labels?.userSender,
                    botSender: customConfig.labels?.botSender,
                    errorSender: customConfig.labels?.errorSender,
                    systemSender: customConfig.labels?.systemSender,
                    datetimeFormat: customConfig.datetimeFormat,
                },
                mockLogger
            );
            expect(MockChatSessionManager).toHaveBeenCalledWith(
                mockChatClientInstance,
                { 
                    userSender: customConfig.labels?.userSender, 
                    botSender: customConfig.labels?.botSender, 
                    errorSender: customConfig.labels?.errorSender, 
                    systemSender: customConfig.labels?.systemSender 
                },
                expect.any(Object),
                mockLogger,
                'custom-session-id',
                customConfig.labels?.welcomeMessage 
            );
            expect(MockChatMessageProcessor).toHaveBeenCalledWith(
                mockChatClientInstance,
                { 
                    userSender: customConfig.labels?.userSender, 
                    botSender: customConfig.labels?.botSender, 
                    errorSender: customConfig.labels?.errorSender, 
                    systemSender: customConfig.labels?.systemSender 
                },
                mockLogger,
                expect.any(Object), // MessageProcessorUICallbacks
                expect.anything(),  // <<<< Added for IMessageParser
                expect.any(Function), // getEnableStream
                expect.any(Function)  // getCurrentSessionId
            );
            // Check getEnableStream directly
            const processorArgs = MockChatMessageProcessor.mock.calls[0];
            const getEnableStreamFn = processorArgs[5] as () => boolean;
            expect(getEnableStreamFn()).toBe(false);

            // Check getCurrentSessionId
            const getCurrentSessionIdFn = processorArgs[6] as () => string | null;
            (mockSessionManagerInstance as { currentSessionId: string | null }).currentSessionId = 'test-session-for-getter';
            expect(getCurrentSessionIdFn()).toBe('test-session-for-getter');
        });

        // Test for enableStream default value (true)
        it('should default enableStream to true and pass getter to ChatMessageProcessor', () => {
            new ChatWidget(containerElement, mockChatClientInstance, undefined, minimalConfig, mockLogger);
            expect(MockChatMessageProcessor).toHaveBeenCalled();
            const processorArgs = MockChatMessageProcessor.mock.calls[0];
            const getEnableStreamFn = processorArgs[5] as () => boolean; // <<<< Index changed from 4 to 5
            expect(getEnableStreamFn()).toBe(true);
        });

        it('should store and use onSessionIdUpdate callback', () => {
            const onSessionIdUpdateMock = jest.fn();
            new ChatWidget(containerElement, mockChatClientInstance, true, minimalConfig, mockLogger, 'initial-id', onSessionIdUpdateMock);
            
            const processorArgs = MockChatMessageProcessor.mock.calls[0];
            const uiCallbacks = processorArgs[3] as MessageProcessorUICallbacks;
            
            uiCallbacks.updateSessionId('new-session-from-flow');
            expect(mockSessionManagerInstance.processSessionIdUpdateFromFlow).toHaveBeenCalledWith('new-session-from-flow');
            expect(onSessionIdUpdateMock).toHaveBeenCalledWith('new-session-from-flow');

            // Simulate another update with the same sessionId ('new-session-from-flow')
            // The SUT calls the external callback if the new sessionId is different from the *initial* one 
            // or if there was no initial one. It does not prevent repeated calls for the same non-initial sessionId.
            onSessionIdUpdateMock.mockClear(); 
            uiCallbacks.updateSessionId('new-session-from-flow');
            expect(mockSessionManagerInstance.processSessionIdUpdateFromFlow).toHaveBeenCalledWith('new-session-from-flow');
            expect(onSessionIdUpdateMock).toHaveBeenCalledWith('new-session-from-flow'); // Corrected assertion

            // Simulate update when no initial ID was provided
            onSessionIdUpdateMock.mockClear();
            mockSessionManagerInstance.processSessionIdUpdateFromFlow.mockClear();
            const widgetWithoutInitialId = new ChatWidget(containerElement, mockChatClientInstance, true, minimalConfig, mockLogger, undefined, onSessionIdUpdateMock);
            const processorArgs2 = MockChatMessageProcessor.mock.calls[1]; // Second instantiation
            const uiCallbacks2 = processorArgs2[3] as MessageProcessorUICallbacks;
            uiCallbacks2.updateSessionId('another-new-id');
            expect(mockSessionManagerInstance.processSessionIdUpdateFromFlow).toHaveBeenCalledWith('another-new-id');
            expect(onSessionIdUpdateMock).toHaveBeenCalledWith('another-new-id');
        });
    });

    describe('render method and event listeners', () => {
        beforeEach(() => {
            containerElement.innerHTML = '';
            jest.spyOn(containerElement, 'appendChild'); 
            // Reset template manager mocks for this describe block to ensure clean state
            mockTemplateManagerInstance.getMainContainerTemplate.mockReturnValue('<div id="chat-widget-header-container"></div><div id="chat-input-area-container"></div><div class="chat-messages"></div>');
            mockTemplateManagerInstance.getInputAreaTemplate.mockReturnValue('<input class="chat-input"/><button class="send-button"></button>');
            mockTemplateManagerInstance.getWidgetHeaderTemplate.mockReturnValue('<div class="chat-widget-header"><span class="chat-widget-title-text">{{widgetTitle}}</span><button class="chat-widget-reset-button">{{resetButton}}</button><button class="chat-widget-minimize-button">{{minimizeButton}}</button></div>');
        });

        it('should render main container, header, and input area from template manager', () => {
            // Define a specific header template for this test
            const headerTplForThisTest = '<header id="actual-header">{{widgetTitle}} {{minimizeButton}}</header>';
            mockTemplateManagerInstance.getWidgetHeaderTemplate.mockReturnValue(headerTplForThisTest);

            const mockMainContainer = '<div id="main-test-container"><div id="chat-widget-header-container"></div><div class="chat-messages"></div><div id="chat-input-area-container"></div></div>';
            mockTemplateManagerInstance.getMainContainerTemplate.mockReturnValue(mockMainContainer);
            
            const mockInputArea = '<input class="chat-input"><button class="send-button"></button>';
            mockTemplateManagerInstance.getInputAreaTemplate.mockReturnValue(mockInputArea);

            // Constructing the widget will trigger its internal rendering logic via _initializeDOM
            new ChatWidget(containerElement, mockChatClientInstance, true, { labels: { widgetTitle: 'My Test Title' } }, mockLogger);

            const mockHeaderContainer = containerElement.querySelector('#chat-widget-header-container') as HTMLElement;
            expect(mockHeaderContainer).not.toBeNull(); // Ensure it was found
            const actualRenderedHTML = mockHeaderContainer.innerHTML;

            const expectedCalculatedHTML = headerTplForThisTest
                .replace('{{widgetTitle}}', 'My Test Title');

            expect(actualRenderedHTML).toBe(expectedCalculatedHTML);
            expect(mockHeaderContainer.style.display).toBe('block');

            expect(mockTemplateManagerInstance.getInputAreaTemplate).toHaveBeenCalled();
            const mockInputAreaContainer = containerElement.querySelector('#chat-input-area-container') as HTMLElement;
            expect(mockInputAreaContainer).not.toBeNull();
            expect(mockInputAreaContainer.innerHTML).toBe(mockInputArea); // Assuming _renderInputArea injects the template directly
        });

        it('should hide header container if no widgetTitle is provided', () => {
            const mockHeaderContainer = document.createElement('div');
            containerElement.querySelector = jest.fn().mockImplementation(selector => {
                if (selector === '#chat-widget-header-container') return mockHeaderContainer;
                if (selector === '#chat-input-area-container') return document.createElement('div');
                if (selector === '.chat-messages') return document.createElement('div');
                if (selector === '.chat-input') return document.createElement('input');
                if (selector === '.send-button') return document.createElement('button');
                return null;
            });

            // Explicitly provide an empty widgetTitle to override the default for this test case
            const configWithoutTitle: ChatWidgetConfigOptions = {
                labels: { widgetTitle: '' }, // Ensure title is empty
                template: {}
            };

            new ChatWidget(containerElement, mockChatClientInstance, true, configWithoutTitle, mockLogger);
            expect(mockHeaderContainer.style.display).toBe('none');
        });

        it('should log a warning if #chat-widget-header-container is missing when a title is provided', () => {
            const title = "Test Widget Title";
            const configWithTitle: ChatWidgetConfigOptions = { 
                labels: { widgetTitle: title },
                template: {}
            };

            containerElement.querySelector = jest.fn().mockImplementation(selector => {
                if (selector === '#chat-widget-header-container') return null; // Simulate missing header container
                if (selector === '#chat-input-area-container') return document.createElement('div');
                if (selector === '.chat-messages') return document.createElement('div');
                if (selector === '.chat-input') return document.createElement('input');
                if (selector === '.send-button') return document.createElement('button');
                return null;
            });

            new ChatWidget(containerElement, mockChatClientInstance, true, configWithTitle, mockLogger);
            expect(mockLogger.warn).toHaveBeenCalledWith("#chat-widget-header-container not found in mainContainerTemplate. Widget header will not be rendered.");
        });

        it('should fallback to appending input area if #chat-input-area-container is missing but .chat-widget exists', () => {
            mockTemplateManagerInstance.getInputAreaTemplate.mockReturnValue('<div><input class="chat-input"/><button class="send-button"></button></div>');
            const mockChatWidgetDiv = document.createElement('div');

            containerElement.querySelector = jest.fn().mockImplementation(selector => {
                if (selector === '#chat-input-area-container') return null; // Simulate missing container
                if (selector === '.chat-widget') return mockChatWidgetDiv;
                if (selector === '.chat-messages') return document.createElement('div');
                if (selector === '.chat-input') return document.createElement('input'); 
                if (selector === '.send-button') return document.createElement('button');
                if (selector === '#chat-widget-header-container') return document.createElement('div'); // Assume header container exists for this test
                return null;
            });

            new ChatWidget(containerElement, mockChatClientInstance, true, minimalConfig, mockLogger);
            expect(mockLogger.warn).toHaveBeenCalledWith("#chat-input-area-container not found in mainContainerTemplate. Input area will be appended to .chat-widget if possible.");
            expect(containerElement.appendChild).toHaveBeenCalledTimes(0); // appendChild is on mockChatWidgetDiv
            expect(mockChatWidgetDiv.children.length).toBe(1);
            expect(mockChatWidgetDiv.firstElementChild?.querySelector('.chat-input')).not.toBeNull();
        });

        it('should log error if input area cannot be rendered (critical failure)', () => {
            containerElement.querySelector = jest.fn().mockReturnValue(null); // All querySelectors return null
            new ChatWidget(containerElement, mockChatClientInstance, true, minimalConfig, mockLogger);
            expect(mockLogger.error).toHaveBeenCalledWith("Critical rendering error. Neither #chat-input-area-container nor .chat-widget found. Cannot append input area.");
        });

        it('should log error if essential elements are missing after render and not throw', () => {
            containerElement.querySelector = jest.fn().mockImplementation(selector => {
                if (selector === '#chat-input-area-container') return document.createElement('div'); 
                // Simulate .chat-messages, .chat-input, .send-button are missing
                return null;
            });

            expect(() => new ChatWidget(containerElement, mockChatClientInstance, true, minimalConfig, mockLogger)).not.toThrow();
            expect(mockLogger.error).toHaveBeenCalledWith(
                expect.stringContaining("Essential elements (.chat-messages, .chat-input, .send-button) not found after rendering.")
            );
        });

        it('should setup event listeners for send button and chat input', () => {
            const mockChatInput = document.createElement('input');
            const mockSendButton = document.createElement('button');
            jest.spyOn(mockChatInput, 'addEventListener');
            jest.spyOn(mockSendButton, 'addEventListener');

            containerElement.querySelector = jest.fn().mockImplementation(selector => {
                if (selector === '#chat-input-area-container') return document.createElement('div');
                if (selector === '.chat-messages') return document.createElement('div');
                if (selector === '.chat-input') return mockChatInput;
                if (selector === '.send-button') return mockSendButton;
                return null;
            });

            new ChatWidget(containerElement, mockChatClientInstance, true, minimalConfig, mockLogger);

            expect(mockSendButton.addEventListener).toHaveBeenCalledWith('click', expect.any(Function));
            expect(mockChatInput.addEventListener).toHaveBeenCalledWith('keypress', expect.any(Function));
        });

        it('should render reset button if placeholder exists in template', () => {
            const configWithTitle: ChatWidgetConfigOptions = { labels: { widgetTitle: "Test Title" } };
            new ChatWidget(containerElement, mockChatClientInstance, true, configWithTitle, mockLogger);
            const resetButton = containerElement.querySelector('.chat-widget-reset-button');
            expect(resetButton).toBeTruthy();
            expect(resetButton?.innerHTML).toBe(SVG_RESET_ICON);
        });

        it('should NOT render reset button if placeholder is missing from template', () => {
            mockTemplateManagerInstance.getWidgetHeaderTemplate.mockReturnValueOnce('<div class="chat-widget-header"><span class="chat-widget-title-text">{{widgetTitle}}</span><button class="chat-widget-minimize-button">{{minimizeButton}}</button></div>');
            const configWithTitle: ChatWidgetConfigOptions = { labels: { widgetTitle: "Test Title" } };
            new ChatWidget(containerElement, mockChatClientInstance, true, configWithTitle, mockLogger);
            const resetButton = containerElement.querySelector('.chat-widget-reset-button');
            expect(resetButton).toBeNull();
        });

        it('should setup event listener for reset button if present', () => {
            const widget = new ChatWidget(containerElement, mockChatClientInstance, true, minimalConfig, mockLogger);
            const resetButton = containerElement.querySelector<HTMLButtonElement>('.chat-widget-reset-button');
            expect(resetButton).toBeTruthy();
            
            const clickSpy = jest.spyOn(widget as any, 'handleResetButtonClick');
            resetButton?.click();
            expect(clickSpy).toHaveBeenCalled();
            clickSpy.mockRestore();
        });
    });

    describe('handleResetButtonClick', () => {
        it('should call sessionManager.setSessionIdAndLoadHistory with undefined and dispatch chatReset event', async () => {
            const widget = new ChatWidget(containerElement, mockChatClientInstance, true, minimalConfig, mockLogger);
            
            // Ensure the reset button is part of the rendered output for this test
            const headerContainer = containerElement.querySelector<HTMLElement>('#chat-widget-header-container');
            if (headerContainer) {
                 headerContainer.innerHTML = `<button class="chat-widget-reset-button">${SVG_RESET_ICON}</button>`;
            }
            const resetButton = containerElement.querySelector<HTMLButtonElement>('.chat-widget-reset-button');
            expect(resetButton).toBeTruthy(); // Sanity check

            const dispatchEventSpy = jest.spyOn(containerElement, 'dispatchEvent');
            
            // Directly call the method to test its isolated behavior,
            // or find the button and click it if testing full integration.
            // Here, we are testing the handler method itself.
            await (widget as any).handleResetButtonClick();

            expect(mockSessionManagerInstance.setSessionIdAndLoadHistory).toHaveBeenCalledWith(undefined);
            expect(dispatchEventSpy).toHaveBeenCalledWith(expect.any(CustomEvent));
            expect(dispatchEventSpy.mock.calls[0][0].type).toBe('chatReset');

            dispatchEventSpy.mockRestore();
        });
    });

    describe('user interaction (sending messages, input state)', () => {
        let mockChatInput: HTMLInputElement;
        let mockSendButton: HTMLButtonElement;

        beforeEach(() => {
            containerElement.innerHTML = ''; 
            mockChatInput = document.createElement('input');
            mockChatInput.className = 'chat-input';
            mockSendButton = document.createElement('button');
            mockSendButton.className = 'send-button';
            
            const mockInputAreaContainer = document.createElement('div');
            mockInputAreaContainer.id = 'chat-input-area-container';
            mockInputAreaContainer.appendChild(mockChatInput);
            mockInputAreaContainer.appendChild(mockSendButton);

            containerElement.appendChild(mockInputAreaContainer);
            const messagesDiv = document.createElement('div');
            messagesDiv.className = 'chat-messages';
            containerElement.appendChild(messagesDiv);

            jest.spyOn(mockChatInput, 'focus');

            // Mock querySelector for this describe block
            containerElement.querySelector = jest.fn().mockImplementation(selector => {
                if (selector === '.chat-input') return mockChatInput;
                if (selector === '.send-button') return mockSendButton;
                if (selector === '#chat-input-area-container') return mockInputAreaContainer;
                if (selector === '.chat-messages') return messagesDiv;
                if (selector === '.chat-widget-header') return null; // Default for this block
                if (selector === '.chat-widget-title-text') return null; // Default for this block
                return null;
            });
        });

        it('should process message on send button click with valid input', async () => {
            new ChatWidget(containerElement, mockChatClientInstance, true, minimalConfig, mockLogger);
            const testMessage = "Hello, widget!";
            mockChatInput.value = testMessage;

            mockSendButton.click();

            expect(mockDisplayManagerInstance.addMessageToDisplay).toHaveBeenCalledWith(
                "You", // Default user sender from internal config resolution
                testMessage,
                false,       // isThinking
                expect.any(String) // datetime (toLocaleString)
            );
            expect(mockChatInput.value).toBe('');
            // Use await with toHaveBeenCalledWith for async calls to messageProcessor.process
            await expect(mockMessageProcessorInstance.process).toHaveBeenCalledWith(testMessage);
        });

        it('should process message on Enter key press with valid input', async () => {
            new ChatWidget(containerElement, mockChatClientInstance, true, minimalConfig, mockLogger);
            const testMessage = "Enter message";
            mockChatInput.value = testMessage;

            const enterEvent = new KeyboardEvent('keypress', { key: 'Enter' });
            mockChatInput.dispatchEvent(enterEvent);

            expect(mockDisplayManagerInstance.addMessageToDisplay).toHaveBeenCalledWith(
                "You", // Default user sender
                testMessage,
                false,
                expect.any(String)
            );
            expect(mockChatInput.value).toBe('');
            await expect(mockMessageProcessorInstance.process).toHaveBeenCalledWith(testMessage);
        });

        it('should not process message if input is empty or only whitespace', () => {
            new ChatWidget(containerElement, mockChatClientInstance, true, minimalConfig, mockLogger);
            
            mockChatInput.value = "   ";
            mockSendButton.click();

            expect(mockDisplayManagerInstance.addMessageToDisplay).not.toHaveBeenCalled();
            expect(mockMessageProcessorInstance.process).not.toHaveBeenCalled();
            expect(mockChatInput.value).toBe("   "); // Value should remain unchanged
        });

        it('setInputDisabled should disable/enable input and send button, and focus on enable', () => {
            const widget = new ChatWidget(containerElement, mockChatClientInstance, true, minimalConfig, mockLogger);
            // Access the setInputDisabled callback passed to MessageProcessor
            const processorArgs = MockChatMessageProcessor.mock.calls[0];
            const uiCallbacks = processorArgs[3] as MessageProcessorUICallbacks;

            // Disable
            uiCallbacks.setInputDisabled(true);
            expect(mockChatInput.disabled).toBe(true);
            expect(mockSendButton.disabled).toBe(true);

            // Enable
            uiCallbacks.setInputDisabled(false);
            expect(mockChatInput.disabled).toBe(false);
            expect(mockSendButton.disabled).toBe(false);
            expect(mockChatInput.focus).toHaveBeenCalled();
        });
    });

    describe('public methods', () => {
        it('setSessionId should call sessionManager and onSessionIdUpdateCallback', async () => {
            const onSessionUpdateMock = jest.fn();
            const widget = new ChatWidget(containerElement, mockChatClientInstance, true, minimalConfig, mockLogger, 'initial-session', onSessionUpdateMock);
            const newSessionId = 'new-test-session';

            await widget.setSessionId(newSessionId);

            expect(mockLogger.info).toHaveBeenCalledWith(`ChatWidget: External call to set session ID to: ${newSessionId}`);
            expect(mockSessionManagerInstance.setSessionIdAndLoadHistory).toHaveBeenCalledWith(newSessionId);
            expect(onSessionUpdateMock).toHaveBeenCalledWith(newSessionId);

            // Test with null session ID
            onSessionUpdateMock.mockClear();
            (mockSessionManagerInstance.setSessionIdAndLoadHistory as jest.Mock).mockClear();
            await widget.setSessionId(null);
            expect(mockSessionManagerInstance.setSessionIdAndLoadHistory).toHaveBeenCalledWith(undefined);
            expect(onSessionUpdateMock).not.toHaveBeenCalled(); // Should not be called for null
        });

        it('destroy should remove event listeners, clear content, and log', () => {
            const mockChatInput = document.createElement('input');
            mockChatInput.className = 'chat-input';
            const mockSendButton = document.createElement('button');
            mockSendButton.className = 'send-button';
            const mockResetButton = document.createElement('button'); // Create reset button
            mockResetButton.className = 'chat-widget-reset-button';  // Assign class

            // Spy on removeEventListener for all buttons
            const chatInputSpy = jest.spyOn(mockChatInput, 'removeEventListener');
            const sendButtonSpy = jest.spyOn(mockSendButton, 'removeEventListener');
            const resetButtonSpy = jest.spyOn(mockResetButton, 'removeEventListener');

            // Specific mock for this test, including reset button
            containerElement.querySelector = jest.fn().mockImplementation(selector => {
                if (selector === '.chat-input') return mockChatInput;
                if (selector === '.send-button') return mockSendButton;
                if (selector === '.chat-widget-reset-button') return mockResetButton; // Return reset button
                return null;
            });
            
            // Ensure a widget instance is created which would attach listeners
            const widget = new ChatWidget(containerElement, mockChatClientInstance, true, minimalConfig, mockLogger);
            
            // Manually set the listener for reset button for this test to ensure it's there to be removed
            // This is because the actual setup depends on render which we are heavily mocking here.
            (widget as any).resetButtonClickListener = jest.fn();

            widget.destroy();

            expect(sendButtonSpy).toHaveBeenCalledWith('click', expect.any(Function));
            expect(chatInputSpy).toHaveBeenCalledWith('keypress', expect.any(Function));
            expect(resetButtonSpy).toHaveBeenCalledWith('click', expect.any(Function)); // Check reset button
            
            expect(containerElement.innerHTML).toBe('');
            expect(mockLogger.info).toHaveBeenCalledWith("ChatWidget instance destroyed.");
        });

        it('registerDatetimeHandler should call displayManager.setDatetimeHandler', () => {
            const widget = new ChatWidget(containerElement, mockChatClientInstance, true, minimalConfig, mockLogger);
            const mockHandler: DatetimeHandler = (datetime) => datetime;
            widget.registerDatetimeHandler(mockHandler);
            expect(mockDisplayManagerInstance.setDatetimeHandler).toHaveBeenCalledWith(mockHandler);
        });

        it('getInternalConfig should return the resolved internal config including welcome message', () => {
            const customConfigWithWelcome: ChatWidgetConfigOptions = {
                labels: {
                    userSender: "CustomUser",
                    widgetTitle: "Custom Title",
                    welcomeMessage: "Welcome to the test!"
                },
                template: {},
            };
            const widget = new ChatWidget(containerElement, mockChatClientInstance, true, customConfigWithWelcome, mockLogger);
            const internalConfig = widget.getInternalConfig();

            expect(internalConfig.userSender).toBe("CustomUser");
            expect(internalConfig.botSender).toBe("Bot"); 
            expect(internalConfig.widgetTitle).toBe("Custom Title");
            expect(internalConfig.welcomeMessage).toBe("Welcome to the test!");
        });

        it('getWidgetElement should return the main container element', () => {
            const widget = new ChatWidget(containerElement, mockChatClientInstance, true, minimalConfig, mockLogger);
            expect(widget.getWidgetElement()).toBe(containerElement);
        });
    });

    // More tests will follow here
}); 