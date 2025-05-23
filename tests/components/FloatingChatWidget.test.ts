/** @jest-environment jsdom */

import { FloatingChatWidget, FloatingChatWidgetConfig } from '../../src/components/FloatingChatWidget';
import { ChatWidget, ChatWidgetConfigOptions } from '../../src/components/ChatWidget';
import { LangflowChatClient } from '../../src/clients/LangflowChatClient';
import { Logger, LogLevel } from '../../src/utils/logger';
import { SVG_MINIMIZE_ICON } from '../../src/config/uiConstants';

// Mock LangflowChatClient
jest.mock('../../src/clients/LangflowChatClient');

// Mock ChatWidget (the main dependency being wrapped)
jest.mock('../../src/components/ChatWidget');

// Mock Logger (though FloatingChatWidget can create its own if none is provided)
jest.mock('../../src/utils/logger');

const MockLangflowChatClient = LangflowChatClient as jest.MockedClass<typeof LangflowChatClient>;
const MockChatWidget = ChatWidget as jest.MockedClass<typeof ChatWidget>;
const MockLogger = Logger as jest.MockedClass<typeof Logger>;

describe('FloatingChatWidget', () => {
    let mockChatClientInstance: jest.Mocked<LangflowChatClient>;
    let mockChatWidgetInstance: jest.Mocked<ChatWidget>; // This will hold the most recent mock ChatWidget
    let mockLoggerInstance: jest.Mocked<Logger>;
    let minimalUserConfig: FloatingChatWidgetConfig;
    let mockChatWidgetElement: HTMLElement; // To hold the mocked ChatWidget's main element

    beforeAll(() => {
        const originalAppendChild = document.body.appendChild.bind(document.body);
        jest.spyOn(document.body, 'appendChild').mockImplementation((node) => {
            return originalAppendChild(node);
        });
        const originalRemoveChild = document.body.removeChild.bind(document.body);
        jest.spyOn(document.body, 'removeChild').mockImplementation((node) => {
            return originalRemoveChild(node);
        });
        jest.spyOn(HTMLElement.prototype, 'remove').mockImplementation(function(this: HTMLElement) {
            if (this.parentNode) {
                this.parentNode.removeChild(this);
            }
        });
    });

    afterAll(() => {
        jest.restoreAllMocks(); 
    });

    beforeEach(() => {
        jest.clearAllMocks(); 
        document.body.innerHTML = '';

        mockChatClientInstance = new MockLangflowChatClient('test-proxy', 'http://dummy.api') as jest.Mocked<LangflowChatClient>;
        
        mockChatWidgetElement = document.createElement('div'); 
        const mockTitleTextSpan = document.createElement('span');
        mockTitleTextSpan.className = 'chat-widget-title-text';
        mockChatWidgetElement.appendChild(mockTitleTextSpan);
        const mockMinimizeButtonElement = document.createElement('button'); // Renamed to avoid conflict
        mockMinimizeButtonElement.className = 'chat-widget-minimize-button';
        mockChatWidgetElement.appendChild(mockMinimizeButtonElement);

        MockChatWidget.mockImplementation((containerElement, client, enableStream, config, logger, initialSessionId, onSessionIdUpdate) => {
            const titleSpanInMock = mockChatWidgetElement.querySelector<HTMLSpanElement>('.chat-widget-title-text');
            if (titleSpanInMock) {
                titleSpanInMock.textContent = config?.labels?.widgetTitle || 'Chatbot'; // Set title based on passed config
            }
            
            // This assignment makes mockChatWidgetInstance available in the test's scope
            mockChatWidgetInstance = {
                destroy: jest.fn(),
                setSessionId: jest.fn().mockResolvedValue(undefined),
                registerDatetimeHandler: jest.fn(),
                getInternalConfig: jest.fn().mockReturnValue({ widgetTitle: config?.labels?.widgetTitle || 'Chatbot' }),
                getWidgetElement: jest.fn().mockReturnValue(mockChatWidgetElement),
            } as any;
            containerElement.appendChild(mockChatWidgetElement); 
            (mockChatWidgetInstance as any)._test_hostElement = containerElement; 
            return mockChatWidgetInstance;
        });
        
        minimalUserConfig = {};
        mockLoggerInstance = new MockLogger() as jest.Mocked<Logger>; // Default logger for tests
    });

    it('should be defined', () => {
        const widget = new FloatingChatWidget(mockChatClientInstance, true, minimalUserConfig, mockLoggerInstance);
        expect(widget).toBeDefined();
        widget.destroy();
    });

    describe('constructor configuration merging', () => {
        it('should use default floating config values when none are provided', () => {
            const widget = new FloatingChatWidget(mockChatClientInstance, true, {}, mockLoggerInstance);
            
            const floatingButton = document.body.querySelector('.floating-chat-button') as HTMLElement;
            const chatContainer = document.body.querySelector('.floating-chat-panel') as HTMLElement;

            expect(floatingButton).not.toBeNull();
            expect(chatContainer).not.toBeNull();

            const chatWidgetHost = chatContainer.querySelector('.chat-widget-inner-host');
            expect(chatWidgetHost).not.toBeNull();
            // At this point, mockChatWidgetInstance should be the one created by new FloatingChatWidget
            expect(mockChatWidgetInstance.getWidgetElement).toHaveBeenCalled();

            const titleTextInMockedCW = mockChatWidgetInstance.getWidgetElement().querySelector<HTMLSpanElement>('.chat-widget-title-text');
            expect(titleTextInMockedCW).not.toBeNull();
            expect(titleTextInMockedCW!.textContent).toBe('Chatbot');

            const minimizeButtonInMockedCW = mockChatWidgetInstance.getWidgetElement().querySelector<HTMLButtonElement>('.chat-widget-minimize-button');
            expect(minimizeButtonInMockedCW).not.toBeNull();
            expect(minimizeButtonInMockedCW!.onclick).not.toBeNull(); 

            expect(floatingButton.innerHTML).toContain('<svg'); 
            expect(floatingButton.style.display).not.toBe('none'); 
            expect(chatContainer.className).toContain('floating-chat-panel bottom-right');
            expect(chatContainer.style.display).toBe('none'); 

            expect(MockChatWidget).toHaveBeenCalledTimes(1);
            const constructorArgs = MockChatWidget.mock.calls[0];
            const expectedChatWidgetConfig: Partial<ChatWidgetConfigOptions> = {
                labels: { 
                    widgetTitle: 'Chatbot',
                    userSender: undefined,
                    botSender: undefined,
                    errorSender: undefined,
                    systemSender: undefined,
                    welcomeMessage: undefined,
                },
                template: { 
                    mainContainerTemplate: undefined,
                    inputAreaTemplate: undefined,
                    messageTemplate: undefined,
                    widgetHeaderTemplate: undefined,
                },
                datetimeFormat: undefined,
            };
            expect(constructorArgs[1]).toBe(mockChatClientInstance);
            expect(constructorArgs[2]).toBe(true);
            expect(constructorArgs[3]).toEqual(expectedChatWidgetConfig);
            expect(constructorArgs[4]).toBe(mockLoggerInstance);
            widget.destroy();
        });

        it('should correctly merge user-provided floating config with defaults and pass to ChatWidget', () => {
            const onSessionIdUpdateMock = jest.fn();
            const userConfig: FloatingChatWidgetConfig = {
                isOpen: true, position: 'bottom-left', showCloseButton: false, showToggleButton: false,
                widgetTitle: 'My Custom Float', logLevel: 'error', initialSessionId: 'float-init-sess',
                onSessionIdUpdate: onSessionIdUpdateMock, datetimeFormat: 'HH:mm', floatingPanelWidth: '450px',
                chatWidgetConfig: {
                    labels: { userSender: 'TestUser', botSender: 'TestBot', welcomeMessage: 'Inner Welcome' },
                    template: {
                        messageTemplate: '<p>Custom Message</p>', mainContainerTemplate: '<div id="custom-main"></div>',
                        inputAreaTemplate: '<input id="custom-input"/>', widgetHeaderTemplate: '<header class="custom-header">{{widgetTitle}}</header>'
                    },
                    datetimeFormat: 'HH:mm:ss'
                }
            };
            
            const customLogger = new MockLogger() as jest.Mocked<Logger>; 
            const widget = new FloatingChatWidget(mockChatClientInstance, false, userConfig, customLogger);
            const floatingButton = document.body.querySelector('.floating-chat-button') as HTMLElement;
            const chatContainer = document.body.querySelector('.floating-chat-panel') as HTMLElement;

            expect(floatingButton.style.display).toBe('none'); 
            expect(chatContainer.style.display).not.toBe('none'); 

            const constructorArgs = MockChatWidget.mock.calls[0];
            expect(constructorArgs[3].labels?.widgetTitle).toBe('My Custom Float');
            
            const titleTextInMockedCW = mockChatWidgetInstance.getWidgetElement().querySelector<HTMLSpanElement>('.chat-widget-title-text');
            expect(titleTextInMockedCW).not.toBeNull();
            expect(titleTextInMockedCW!.textContent).toBe('My Custom Float');

            const minimizeButtonInMockedCW = mockChatWidgetInstance.getWidgetElement().querySelector<HTMLButtonElement>('.chat-widget-minimize-button');
            expect(minimizeButtonInMockedCW).not.toBeNull();
            expect((minimizeButtonInMockedCW as HTMLElement).style.display).toBe('none');

            const expectedChatWidgetConfig: Partial<ChatWidgetConfigOptions> = {
                labels: { userSender: 'TestUser', botSender: 'TestBot', widgetTitle: 'My Custom Float', welcomeMessage: 'Inner Welcome' },
                template: { messageTemplate: '<p>Custom Message</p>', mainContainerTemplate: '<div id="custom-main"></div>', inputAreaTemplate: '<input id="custom-input"/>', widgetHeaderTemplate: '<header class="custom-header">{{widgetTitle}}</header>' },
                datetimeFormat: 'HH:mm:ss'
            };
            expect(constructorArgs[3]).toEqual(expectedChatWidgetConfig);
            widget.destroy();
        });

        it('should use provided logger instance if available', () => {
            // Clear any calls to MockLogger from beforeEach or previous tests
            MockLogger.mockClear(); 
            
            new FloatingChatWidget(mockChatClientInstance, true, {}, mockLoggerInstance);
            
            // We expect that FloatingChatWidget uses the provided mockLoggerInstance
            // and does NOT call `new Logger()` (which is MockLogger constructor in tests) again.
            expect(MockLogger).not.toHaveBeenCalled(); 
            expect(MockChatWidget.mock.calls[0][4]).toBe(mockLoggerInstance);
        });
        
        it('should handle showToggleButton correctly', () => {
            const widget1 = new FloatingChatWidget(mockChatClientInstance, true, { showToggleButton: true }, mockLoggerInstance);
            expect((document.body.querySelector('.floating-chat-button') as HTMLElement).style.display).not.toBe('none');
            widget1.destroy();
            const widget2 = new FloatingChatWidget(mockChatClientInstance, true, { showToggleButton: false }, mockLoggerInstance);
            expect((document.body.querySelector('.floating-chat-button') as HTMLElement).style.display).toBe('none');
            widget2.destroy();
        });

        it('should pass datetimeFormat from chatWidgetConfig if not on FloatingChatWidgetConfig', () => {
            const cfg: FloatingChatWidgetConfig = { chatWidgetConfig: { datetimeFormat: 'HH:mm:ss' } };
            new FloatingChatWidget(mockChatClientInstance, true, cfg, mockLoggerInstance);
            expect(MockChatWidget.mock.calls[0][3].datetimeFormat).toBe('HH:mm:ss');
        });
    });

    describe('DOM element creation and structure', () => {
        it('should create floating button and chat panel with correct classes and initial visibility', () => {
            const widget = new FloatingChatWidget(mockChatClientInstance, true, { isOpen: false, position: 'top-left' }, mockLoggerInstance);
            const floatingButton = document.body.querySelector('.floating-chat-button');
            const chatPanel = document.body.querySelector('.floating-chat-panel');
            expect(floatingButton).not.toBeNull();
            expect(floatingButton!.className).toContain('floating-chat-button top-left');
            expect((floatingButton as HTMLElement).style.display).not.toBe('none'); 
            expect(chatPanel).not.toBeNull();
            expect(chatPanel!.className).toContain('floating-chat-panel top-left');
            expect((chatPanel as HTMLElement).style.display).toBe('none');
            expect(chatPanel!.querySelector('.chat-widget-inner-host')).not.toBeNull();
            widget.destroy();
        });

        it('should apply custom floatingPanelWidth if provided', () => {
            const widget = new FloatingChatWidget(mockChatClientInstance, true, { floatingPanelWidth: '450px' }, mockLoggerInstance);
            const chatPanel = document.body.querySelector('.floating-chat-panel') as HTMLElement;
            expect(chatPanel.style.getPropertyValue('--langflow-floating-panel-width')).toBe('450px');
            widget.destroy();
        });

        it('should hide minimize button in ChatWidget if showCloseButton is false', () => {
            const widget = new FloatingChatWidget(mockChatClientInstance, true, { showCloseButton: false }, mockLoggerInstance);
            // mockChatWidgetInstance is the one from the new FloatingChatWidget instance
            const minimizeButton = mockChatWidgetInstance.getWidgetElement().querySelector<HTMLButtonElement>('.chat-widget-minimize-button');
            expect(minimizeButton).not.toBeNull();
            expect(minimizeButton!.style.display).toBe('none');
            widget.destroy();
        });

        it('should attach toggleChatVisibility to minimize button in ChatWidget if showCloseButton is true', () => {
            const widget = new FloatingChatWidget(mockChatClientInstance, true, { showCloseButton: true, isOpen: true }, mockLoggerInstance);
            const minimizeButton = mockChatWidgetInstance.getWidgetElement().querySelector<HTMLButtonElement>('.chat-widget-minimize-button');
            expect(minimizeButton).not.toBeNull();
            expect(minimizeButton!.onclick).not.toBeNull();
            const toggleSpy = jest.spyOn(widget, 'toggleChatVisibility');
            minimizeButton!.click();
            expect(toggleSpy).toHaveBeenCalled();
            widget.destroy();
        });
    });

    describe('FloatingChatWidget Visibility and Interactions', () => {
        let widget: FloatingChatWidget;
        let floatingButton: HTMLElement;
        let chatPanel: HTMLElement;

        const setupWidgetAndElements = (config: FloatingChatWidgetConfig = {}) => {
            // Ensure mockLoggerInstance is available in this scope if not passed to setup
            const loggerToUse = config.logLevel ? new MockLogger() as jest.Mocked<Logger> : mockLoggerInstance;
            widget = new FloatingChatWidget(mockChatClientInstance, true, config, loggerToUse);
            floatingButton = document.body.querySelector('.floating-chat-button') as HTMLElement;
            chatPanel = document.body.querySelector('.floating-chat-panel') as HTMLElement;
        };

        beforeEach(() => {
            // mockLoggerInstance is (re)created in the top-level beforeEach, ensure it's fresh for this block too
            // or ensure setupWidgetAndElements uses a consistent or new logger for each sub-test if necessary.
            // For simplicity, we rely on the top-level beforeEach for mockLoggerInstance here.
        });

        it('should initialize with chat hidden and button visible (isOpen:false, showToggleButton:true)', () => {
            setupWidgetAndElements({ isOpen: false, showToggleButton: true });
            expect(chatPanel.style.display).toBe('none');
            expect(floatingButton.style.display).not.toBe('none');
            expect((widget as any).isChatVisible).toBe(false);
            widget.destroy();
        });

        it('should initialize with chat visible and button hidden (isOpen:true, showToggleButton:true)', () => {
            setupWidgetAndElements({ isOpen: true, showToggleButton: true });
            expect(chatPanel.style.display).not.toBe('none'); 
            expect(floatingButton.style.display).toBe('none');
            expect((widget as any).isChatVisible).toBe(true);
            widget.destroy();
        });

        it('toggleChatVisibility should show chat if hidden, and hide button', () => {
            setupWidgetAndElements({ isOpen: false, showToggleButton: true });
            widget.toggleChatVisibility();
            expect(chatPanel.style.display).not.toBe('none');
            expect(floatingButton.style.display).toBe('none');
            expect((widget as any).isChatVisible).toBe(true);
            widget.destroy();
        });

        it('toggleChatVisibility should hide chat if visible, and show button', () => {
            setupWidgetAndElements({ isOpen: true, showToggleButton: true });
            widget.toggleChatVisibility();
            expect(chatPanel.style.display).toBe('none');
            expect(floatingButton.style.display).not.toBe('none');
            expect((widget as any).isChatVisible).toBe(false);
            widget.destroy();
        });

        it('showChat should make chat visible and hide button', () => {
            setupWidgetAndElements({ isOpen: false, showToggleButton: true });
            widget.showChat();
            expect(chatPanel.style.display).not.toBe('none');
            expect(floatingButton.style.display).toBe('none');
            expect((widget as any).isChatVisible).toBe(true);
            widget.destroy();
        });

        it('hideChat should make chat hidden and show button', () => {
            setupWidgetAndElements({ isOpen: true, showToggleButton: true });
            widget.hideChat();
            expect(chatPanel.style.display).toBe('none');
            expect(floatingButton.style.display).not.toBe('none');
            expect((widget as any).isChatVisible).toBe(false);
            widget.destroy();
        });

        it('floating button click should toggle chat visibility', () => {
            setupWidgetAndElements({ isOpen: false, showToggleButton: true });
            floatingButton.click(); 
            expect((widget as any).isChatVisible).toBe(true);
            expect(chatPanel.style.display).not.toBe('none');
            expect(floatingButton.style.display).toBe('none');
            // FloatingChatWidget logic makes button click effectively a toggle on its internal state,
            // then updates visibility. If button is hidden, it can't be clicked again by user,
            // but programmatically calling click() on a hidden button still fires handlers.
            // The test here checks the state inversion and resulting visibility.
            floatingButton.click(); 
            expect((widget as any).isChatVisible).toBe(false);
            expect(chatPanel.style.display).toBe('none');
            expect(floatingButton.style.display).not.toBe('none');
            widget.destroy();
        });

        it('minimize button click should toggle chat visibility if button is shown', () => {
            setupWidgetAndElements({ isOpen: true, showCloseButton: true }); 
            // mockChatWidgetInstance is set by the new FloatingChatWidget in setupWidgetAndElements
            const minimizeButton = mockChatWidgetInstance.getWidgetElement().querySelector<HTMLButtonElement>('.chat-widget-minimize-button');
            expect(minimizeButton).not.toBeNull();
            minimizeButton!.click(); 
            expect((widget as any).isChatVisible).toBe(false);
            expect(chatPanel.style.display).toBe('none');
            expect(floatingButton.style.display).not.toBe('none');
            widget.destroy();
        });

        it('should not show toggle button display if showToggleButton is false', () => {
            setupWidgetAndElements({ isOpen: false, showToggleButton: false });
            expect(floatingButton.style.display).toBe('none');
            widget.toggleChatVisibility(); 
            expect(floatingButton.style.display).toBe('none'); 
            widget.toggleChatVisibility(); 
            expect(floatingButton.style.display).toBe('none');
            widget.destroy();
        });

        it('destroy method should remove elements and call ChatWidget.destroy', () => {
            setupWidgetAndElements();
            const internalChatWidgetInstance = (widget as any).chatWidgetInstance; 
            widget.destroy();
            expect(internalChatWidgetInstance.destroy).toHaveBeenCalled();
            expect(document.body.querySelector('.floating-chat-button')).toBeNull();
            expect(document.body.querySelector('.floating-chat-panel')).toBeNull();
        });
    }); 
}); 