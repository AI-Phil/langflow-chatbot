/** @jest-environment jsdom */

import { FloatingChatWidget, FloatingChatWidgetConfig } from '../src/components/FloatingChatWidget';
import { ChatWidget, ChatWidgetConfigOptions } from '../src/components/ChatWidget';
import { LangflowChatClient } from '../src/clients/LangflowChatClient';
import { Logger, LogLevel } from '../src/components/logger';

// Mock LangflowChatClient
jest.mock('../src/clients/LangflowChatClient');

// Mock ChatWidget (the main dependency being wrapped)
jest.mock('../src/components/ChatWidget');

// Mock Logger (though FloatingChatWidget can create its own if none is provided)
jest.mock('../src/components/logger');

const MockLangflowChatClient = LangflowChatClient as jest.MockedClass<typeof LangflowChatClient>;
const MockChatWidget = ChatWidget as jest.MockedClass<typeof ChatWidget>;
const MockLogger = Logger as jest.MockedClass<typeof Logger>;

describe('FloatingChatWidget', () => {
    let mockChatClientInstance: jest.Mocked<LangflowChatClient>;
    let mockChatWidgetInstance: jest.Mocked<ChatWidget>;
    let mockLoggerInstance: jest.Mocked<Logger>;
    let minimalUserConfig: FloatingChatWidgetConfig;

    // Global DOM and prototype mocks
    beforeAll(() => {
        // Mock document.body.appendChild to actually append
        const originalAppendChild = document.body.appendChild.bind(document.body);
        jest.spyOn(document.body, 'appendChild').mockImplementation((node) => {
            return originalAppendChild(node);
        });

        // Mock document.body.removeChild to actually remove
        const originalRemoveChild = document.body.removeChild.bind(document.body);
        jest.spyOn(document.body, 'removeChild').mockImplementation((node) => {
            return originalRemoveChild(node);
        });

        // Mock HTMLElement.prototype.remove to actually remove from parent
        jest.spyOn(HTMLElement.prototype, 'remove').mockImplementation(function(this: HTMLElement) {
            if (this.parentNode) {
                this.parentNode.removeChild(this);
            }
        });
    });

    afterAll(() => {
        // Restore all global mocks
        jest.restoreAllMocks(); 
    });

    beforeEach(() => {
        jest.clearAllMocks(); // Clear interaction mocks like LangflowChatClient, ChatWidget, Logger calls
        document.body.innerHTML = ''; // Clean the DOM for each test

        mockChatClientInstance = new MockLangflowChatClient('test-proxy', 'http://dummy.api') as jest.Mocked<LangflowChatClient>;

        MockChatWidget.mockImplementation((containerElement, client, enableStream, config, logger, initialSessionId, onSessionIdUpdate) => {
            mockChatWidgetInstance = {
                destroy: jest.fn(),
                setSessionId: jest.fn().mockResolvedValue(undefined),
                registerDatetimeHandler: jest.fn(),
                getInternalConfig: jest.fn().mockReturnValue({}),
            } as any;
            (mockChatWidgetInstance as any)._test_hostElement = containerElement; 
            return mockChatWidgetInstance;
        });
        
        minimalUserConfig = {};
        // Specific logger mocks will be inside describe blocks or tests if needed for specific instances
    });

    // No global afterEach for document.body.appendChild etc. as they are restored in afterAll

    it('should be defined', () => {
        const mockLoggerInstance = new MockLogger() as jest.Mocked<Logger>; // Provide a logger for this simple test
        const widget = new FloatingChatWidget(mockChatClientInstance, true, minimalUserConfig, mockLoggerInstance);
        expect(widget).toBeDefined();
        widget.destroy(); // cleanup
    });

    describe('constructor configuration merging', () => {
        let mockLoggerInstance: jest.Mocked<Logger>;

        beforeEach(() => {
            // Setup a fresh logger mock for this describe block
            mockLoggerInstance = {
                debug: jest.fn(),
                info: jest.fn(),
                warn: jest.fn(),
                error: jest.fn(),
                setLevel: jest.fn(),
            } as any;
            MockLogger.mockImplementation(() => mockLoggerInstance);
            // No specific document.body.appendChild mocks here, use global one
        });

        it('should use default floating config values when none are provided', () => {
            const widget = new FloatingChatWidget(mockChatClientInstance, true, {}, mockLoggerInstance);
            
            const floatingButton = document.body.querySelector('.floating-chat-button') as HTMLElement;
            const chatContainer = document.body.querySelector('.floating-chat-panel') as HTMLElement;

            expect(floatingButton).not.toBeNull();
            expect(chatContainer).not.toBeNull();

            expect(floatingButton.innerHTML).toContain('<svg'); 
            // Default: isOpen=false, showToggleButton=true. Button visible, panel hidden.
            expect(floatingButton.style.display).not.toBe('none'); 

            expect(chatContainer.className).toContain('floating-chat-panel bottom-right');
            expect(chatContainer.style.display).toBe('none'); 

            const headerTitle = chatContainer.querySelector('.chat-widget-title-text') as HTMLElement;
            expect(headerTitle).not.toBeNull();
            expect(headerTitle.textContent).toBe('Chatbot'); 

            const minimizeButton = chatContainer.querySelector('.minimize-button') as HTMLElement;
            expect(minimizeButton).not.toBeNull(); 
            expect(minimizeButton.innerHTML).toContain('<svg'); 

            expect(MockChatWidget).toHaveBeenCalledTimes(1);
            const constructorArgs = MockChatWidget.mock.calls[0];
            const chatWidgetHostElement = constructorArgs[0] as HTMLElement;
            const actualHostInDOM = chatContainer.querySelector('.chat-widget-inner-host');
            expect(actualHostInDOM).not.toBeNull();
            expect(chatWidgetHostElement).toBe(actualHostInDOM); 
            expect(chatWidgetHostElement.className).toBe('chat-widget-inner-host');

            const expectedChatWidgetConfig: Partial<ChatWidgetConfigOptions> = {
                mainContainerTemplate: undefined,
                inputAreaTemplate: undefined,
                messageTemplate: undefined,
                widgetTitle: undefined, // Floating widget title is separate
                datetimeFormat: undefined,
            };

            expect(constructorArgs[1]).toBe(mockChatClientInstance);
            expect(constructorArgs[2]).toBe(true); // enableStream
            expect(constructorArgs[3]).toEqual(expectedChatWidgetConfig);
            expect(constructorArgs[4]).toBe(mockLoggerInstance);
            expect(constructorArgs[5]).toBe(undefined); // initialSessionId
            expect(constructorArgs[6]).toBe(undefined); // onSessionIdUpdate
            // Check logger usage (check the passed-in mockLoggerInstance directly)
            expect(mockLoggerInstance.info).toHaveBeenCalledWith('FloatingChatWidget initialized with config:', expect.any(Object));
        });

        it('should correctly merge user-provided floating config with defaults and pass to ChatWidget', () => {
            const onSessionIdUpdateMock = jest.fn();
            const userConfig: FloatingChatWidgetConfig = {
                isOpen: true,
                position: 'bottom-left',
                showCloseButton: false,
                showToggleButton: false,
                widgetTitle: 'My Custom Float',
                logLevel: 'error',
                initialSessionId: 'float-init-sess',
                onSessionIdUpdate: onSessionIdUpdateMock,
                datetimeFormat: 'HH:mm',
                chatWidgetConfig: {
                    userSender: 'TestUser',
                    messageTemplate: '<p>{{message}}</p>',
                    widgetTitle: 'Inner Widget Title Should Be Ignored'
                }
            };
            
            MockLogger.mockClear(); 
            const newLoggerInstance = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(), setLevel: jest.fn(), constructorName: 'Logger' } as any;
            MockLogger.mockImplementationOnce(() => newLoggerInstance);

            const widget = new FloatingChatWidget(mockChatClientInstance, false, userConfig, newLoggerInstance);
            const floatingButton = document.body.querySelector('.floating-chat-button') as HTMLElement;
            const chatContainer = document.body.querySelector('.floating-chat-panel') as HTMLElement;
            expect(floatingButton).not.toBeNull();
            expect(chatContainer).not.toBeNull();

            // Check logger usage (check the passed-in newLoggerInstance directly)
            expect(newLoggerInstance.info).toHaveBeenCalledWith('FloatingChatWidget initialized with config:', expect.any(Object));

            expect(floatingButton.className).toContain('floating-chat-button bottom-left');
            expect(floatingButton.style.display).toBe('none'); 

            expect(chatContainer.className).toContain('floating-chat-panel bottom-left');
            expect(chatContainer.style.display).not.toBe('none'); 

            const headerTitle = chatContainer.querySelector('.chat-widget-title-text') as HTMLElement;
            expect(headerTitle).not.toBeNull();
            expect(headerTitle.textContent).toBe('My Custom Float');

            const minimizeButton = chatContainer.querySelector('.minimize-button');
            expect(minimizeButton).toBeNull(); // showCloseButton is false in this userConfig

            expect(MockChatWidget).toHaveBeenCalledTimes(1);
            const constructorArgs = MockChatWidget.mock.calls[0];
            const chatWidgetHostElement = constructorArgs[0]as HTMLElement;
            const actualHostInDOM = chatContainer.querySelector('.chat-widget-inner-host');
            expect(actualHostInDOM).not.toBeNull();
            expect(chatWidgetHostElement).toBe(actualHostInDOM);
            
            const expectedChatWidgetConfig: Partial<ChatWidgetConfigOptions> = {
                userSender: 'TestUser',
                messageTemplate: '<p>{{message}}</p>',
                mainContainerTemplate: undefined, 
                inputAreaTemplate: undefined,   
                widgetTitle: undefined, // FloatingWidget ensures ChatWidget's title is not set from its own config
                datetimeFormat: 'HH:mm', 
            };

            expect(constructorArgs[1]).toBe(mockChatClientInstance);
            expect(constructorArgs[2]).toBe(false); // enableStream
            expect(constructorArgs[3]).toEqual(expectedChatWidgetConfig);
            expect(constructorArgs[4]).toBe(newLoggerInstance); // The logger created internally
            expect(constructorArgs[5]).toBe('float-init-sess');
            expect(constructorArgs[6]).toBe(onSessionIdUpdateMock);
        });

        it('should use provided logger instance if available', () => {
            const userConfig: FloatingChatWidgetConfig = { logLevel: 'debug' }; // logLevel on config won't be used if logger is passed
            new FloatingChatWidget(mockChatClientInstance, true, userConfig, mockLoggerInstance);
            expect(MockLogger).not.toHaveBeenCalled(); // Should not create a new one
            // Check logger usage (check the passed-in mockLoggerInstance directly)
            expect(mockLoggerInstance.info).toHaveBeenCalledWith('FloatingChatWidget initialized with config:', expect.any(Object));
            expect(mockLoggerInstance.setLevel).not.toHaveBeenCalled(); // setLevel is internal to Logger constructor
            
            const constructorArgs = MockChatWidget.mock.calls[0];
            expect(constructorArgs[4]).toBe(mockLoggerInstance); // Passed-in logger
        });
        
        it('should handle showToggleButton correctly', () => {
            let widget = new FloatingChatWidget(mockChatClientInstance, true, { showToggleButton: true, isOpen: false }, mockLoggerInstance);
            let floatingButton = document.body.querySelector('.floating-chat-button') as HTMLElement;
            expect(floatingButton.style.display).not.toBe('none'); 

            widget.destroy();
            document.body.innerHTML = ''; // Clear body for next widget
            MockChatWidget.mockClear(); 
            MockLogger.mockClear();

            widget = new FloatingChatWidget(mockChatClientInstance, true, { showToggleButton: false, isOpen: false }, mockLoggerInstance);
            floatingButton = document.body.querySelector('.floating-chat-button') as HTMLElement;
            // Debug log
            if (floatingButton) {
                // eslint-disable-next-line no-console
                console.log('floatingButton.outerHTML:', floatingButton.outerHTML, 'style.display:', floatingButton.style.display);
            } else {
                // eslint-disable-next-line no-console
                console.log('floatingButton is null. document.body.innerHTML:', document.body.innerHTML);
            }
            expect(floatingButton.style.display).toBe('none');

            widget.destroy();
            document.body.innerHTML = '';
            MockChatWidget.mockClear();
            MockLogger.mockClear();

            widget = new FloatingChatWidget(mockChatClientInstance, true, { showToggleButton: true, isOpen: true }, mockLoggerInstance);
            floatingButton = document.body.querySelector('.floating-chat-button') as HTMLElement;
            expect(floatingButton.style.display).toBe('none'); 
        });

        it('should pass datetimeFormat from chatWidgetConfig if not on FloatingChatWidgetConfig', () => {
            const userConfig: FloatingChatWidgetConfig = {
                chatWidgetConfig: {
                    datetimeFormat: 'hh:mm a'
                }
            };
            new FloatingChatWidget(mockChatClientInstance, true, userConfig, mockLoggerInstance);
            const constructorArgs = MockChatWidget.mock.calls[0];
            const passedChatWidgetConfig = constructorArgs[3] as Partial<ChatWidgetConfigOptions>; 
            expect(passedChatWidgetConfig.datetimeFormat).toBe('hh:mm a');
        });
    });

    // More tests for element creation, visibility toggling, and destroy will follow
}); 

describe('FloatingChatWidget Positioning', () => {
    let mockChatClientInstance: jest.Mocked<LangflowChatClient>;
    let mockLoggerInstance: jest.Mocked<Logger>;

    beforeEach(() => {
        jest.clearAllMocks();
        mockChatClientInstance = new MockLangflowChatClient('test-proxy', 'http://dummy.api') as jest.Mocked<LangflowChatClient>;
        mockLoggerInstance = new MockLogger() as jest.Mocked<Logger>; // Instantiated for each test
        MockChatWidget.mockImplementation(() => ({
            destroy: jest.fn(),
            setSessionId: jest.fn().mockResolvedValue(undefined),
            registerDatetimeHandler: jest.fn(),
            getInternalConfig: jest.fn().mockReturnValue({}),
        } as any));
        // Use the real appendChild so DOM queries work
        // jest.spyOn(document.body, 'appendChild').mockImplementation(node => node as any);
        jest.spyOn(HTMLElement.prototype, 'remove').mockImplementation(() => {});
    });

    afterEach(() => {
        // Remove only the remove mock
        (HTMLElement.prototype.remove as jest.Mock).mockRestore();
        // Clear the DOM between tests
        document.body.innerHTML = '';
    });

    const positions: Array<'bottom-right' | 'bottom-left' | 'top-right' | 'top-left'> = [
        'bottom-right', 
        'bottom-left', 
        'top-right', 
        'top-left'
    ];

    positions.forEach(position => {
        it(`should apply correct classes for position: ${position}`, () => {
            new FloatingChatWidget(mockChatClientInstance, true, { position }, mockLoggerInstance);

            // Use DOM queries instead of appendChild.mock.calls
            const floatingButton = document.body.querySelector('.floating-chat-button') as HTMLElement;
            const chatContainer = document.body.querySelector('.floating-chat-panel') as HTMLElement;

            expect(floatingButton).not.toBeNull();
            expect(chatContainer).not.toBeNull();
            expect(floatingButton.className).toContain(`floating-chat-button`);
            expect(floatingButton.className).toContain(position);
            expect(chatContainer.className).toContain(`floating-chat-panel`);
            expect(chatContainer.className).toContain(position);
        });
    });

    it('should default to bottom-right if position is invalid or not specified', () => {
        // Test with an undefined position (should default to bottom-right)
        let widget = new FloatingChatWidget(mockChatClientInstance, true, { position: undefined }, mockLoggerInstance);
        let floatingButton1 = document.body.querySelector('.floating-chat-button.bottom-right') as HTMLElement;
        let chatContainer1 = document.body.querySelector('.floating-chat-panel.bottom-right') as HTMLElement;
        if (!floatingButton1 || !chatContainer1) {
            // eslint-disable-next-line no-console
            console.log('DOM after widget 1:', document.body.innerHTML);
        }
        expect(floatingButton1).not.toBeNull();
        expect(chatContainer1).not.toBeNull();
        expect(floatingButton1.className).toContain('bottom-right');
        expect(chatContainer1.className).toContain('bottom-right');
        widget.destroy();
        document.body.innerHTML = '';
        MockLogger.mockClear();

        // Test with an actual invalid string (should default to bottom-right)
        widget = new FloatingChatWidget(mockChatClientInstance, true, { position: 'invalid-position' as any }, mockLoggerInstance);
        let floatingButton2 = document.body.querySelector('.floating-chat-button.bottom-right') as HTMLElement;
        let chatContainer2 = document.body.querySelector('.floating-chat-panel.bottom-right') as HTMLElement;
        if (!floatingButton2 || !chatContainer2) {
            // eslint-disable-next-line no-console
            console.log('DOM after widget 2:', document.body.innerHTML);
        }
        expect(floatingButton2).not.toBeNull();
        expect(chatContainer2).not.toBeNull();
        expect(floatingButton2.className).toContain('bottom-right');
        expect(chatContainer2.className).toContain('bottom-right');
        widget.destroy();
        document.body.innerHTML = '';
        MockLogger.mockClear();

        // Test with no position property (should also default to bottom-right)
        widget = new FloatingChatWidget(mockChatClientInstance, true, { }, mockLoggerInstance); 
        let floatingButton3 = document.body.querySelector('.floating-chat-button.bottom-right') as HTMLElement;
        let chatContainer3 = document.body.querySelector('.floating-chat-panel.bottom-right') as HTMLElement;
        if (!floatingButton3 || !chatContainer3) {
            // eslint-disable-next-line no-console
            console.log('DOM after widget 3:', document.body.innerHTML);
        }
        expect(floatingButton3).not.toBeNull();
        expect(chatContainer3).not.toBeNull();
        expect(floatingButton3.className).toContain('bottom-right');
        expect(chatContainer3.className).toContain('bottom-right');
        widget.destroy();

    });
}); 

describe('FloatingChatWidget Visibility and Interactions', () => {
    let mockChatClientInstance: jest.Mocked<LangflowChatClient>;
    let mockLoggerInstance: jest.Mocked<Logger>;
    let widget: FloatingChatWidget;
    let floatingButton: HTMLElement;
    let chatContainer: HTMLElement;
    // let minimizeButton: HTMLButtonElement; // Will retrieve this dynamically in tests that need it

    beforeEach(() => {
        jest.clearAllMocks();
        mockChatClientInstance = new MockLangflowChatClient('test-proxy', 'http://dummy.api') as jest.Mocked<LangflowChatClient>;
        mockLoggerInstance = new MockLogger() as jest.Mocked<Logger>;
        MockChatWidget.mockImplementation(() => ({
            destroy: jest.fn(),
            setSessionId: jest.fn().mockResolvedValue(undefined),
            registerDatetimeHandler: jest.fn(),
            getInternalConfig: jest.fn().mockReturnValue({}),
        } as any));

        document.body.innerHTML = ''; // Clean slate
        
        // More robust appendChild mock that actually appends, so querySelector works on document.body
        const originalAppendChild = document.body.appendChild.bind(document.body);
        jest.spyOn(document.body, 'appendChild').mockImplementation((node) => {
            return originalAppendChild(node);
        });

        const originalRemoveChild = document.body.removeChild.bind(document.body);
        jest.spyOn(document.body, 'removeChild').mockImplementation((node) => {
            return originalRemoveChild(node);
        });
        
        // HTMLElement.prototype.remove is called by SUT's destroy method
        // Make it actually remove the element from its parent for test cleanliness
        jest.spyOn(HTMLElement.prototype, 'remove').mockImplementation(function(this: HTMLElement) {
            if (this.parentNode) {
                this.parentNode.removeChild(this);
            }
        });
    });

    afterEach(() => {
        if (widget) {
            widget.destroy(); // Clean up elements from body
        }
        // Restore all spied methods
        jest.restoreAllMocks(); 
    });

    // Helper to initialize widget and retrieve elements for tests
    const setupWidget = (config: FloatingChatWidgetConfig = {}) => {
        widget = new FloatingChatWidget(mockChatClientInstance, true, config, mockLoggerInstance);
        floatingButton = document.body.querySelector('.floating-chat-button') as HTMLElement;
        chatContainer = document.body.querySelector('.floating-chat-panel') as HTMLElement;
        // Ensure elements are found, otherwise tests might fail cryptically
        if (!floatingButton) throw new Error('Test setup: floatingButton not found in body');
        if (!chatContainer) throw new Error('Test setup: chatContainer not found in body');
    };

    it('should initialize with chat hidden and button visible (isOpen:false, showToggleButton:true)', () => {
        setupWidget({ isOpen: false, showToggleButton: true });
        expect(chatContainer.style.display).toBe('none');
        expect(floatingButton.style.display).not.toBe('none');
        expect((widget as any).isChatVisible).toBe(false);
    });

    it('should initialize with chat visible and button hidden (isOpen:true, showToggleButton:true)', () => {
        setupWidget({ isOpen: true, showToggleButton: true });
        expect(chatContainer.style.display).not.toBe('none'); 
        expect(floatingButton.style.display).toBe('none');
        expect((widget as any).isChatVisible).toBe(true);
    });

    it('toggleChatVisibility should show chat if hidden, and hide button', () => {
        setupWidget({ isOpen: false, showToggleButton: true });
        expect((widget as any).isChatVisible).toBe(false);
        
        widget.toggleChatVisibility();
        
        expect(chatContainer.style.display).not.toBe('none');
        expect(floatingButton.style.display).toBe('none');
        expect((widget as any).isChatVisible).toBe(true);
    });

    it('toggleChatVisibility should hide chat if visible, and show button', () => {
        setupWidget({ isOpen: true, showToggleButton: true });
        expect((widget as any).isChatVisible).toBe(true);

        widget.toggleChatVisibility();

        expect(chatContainer.style.display).toBe('none');
        expect(floatingButton.style.display).not.toBe('none');
        expect((widget as any).isChatVisible).toBe(false);
    });

    it('showChat should make chat visible and hide button', () => {
        setupWidget({ isOpen: false, showToggleButton: true });
        widget.showChat();
        expect(chatContainer.style.display).not.toBe('none');
        expect(floatingButton.style.display).toBe('none');
        expect((widget as any).isChatVisible).toBe(true);
    });

    it('hideChat should make chat hidden and show button', () => {
        setupWidget({ isOpen: true, showToggleButton: true }); // Start with chat shown
        expect((widget as any).isChatVisible).toBe(true);

        widget.hideChat();
        expect(chatContainer.style.display).toBe('none');
        expect(floatingButton.style.display).not.toBe('none');
        expect((widget as any).isChatVisible).toBe(false);
    });

    it('floating button click should toggle chat visibility', () => {
        setupWidget({ isOpen: false, showToggleButton: true });
        expect((widget as any).isChatVisible).toBe(false);
        
        floatingButton.click(); 
        expect((widget as any).isChatVisible).toBe(true);
        expect(chatContainer.style.display).not.toBe('none');
        expect(floatingButton.style.display).toBe('none');

        floatingButton.click(); // Click again (though it's hidden, SUT re-evals visibility based on isChatVisible)
        expect((widget as any).isChatVisible).toBe(false);
        expect(chatContainer.style.display).toBe('none');
        expect(floatingButton.style.display).not.toBe('none');
    });

    it('minimize button click should toggle chat visibility if button is shown', () => {
        setupWidget({ isOpen: true, showToggleButton: true, showCloseButton: true });
        const minimizeButton = chatContainer.querySelector('.minimize-button') as HTMLButtonElement;
        
        expect(minimizeButton).toBeDefined();
        expect(minimizeButton).not.toBeNull();
        expect((widget as any).isChatVisible).toBe(true); // Chat starts visible
        
        minimizeButton.click(); 
        
        expect((widget as any).isChatVisible).toBe(false);
        expect(chatContainer.style.display).toBe('none');
        // Floating button should become visible if showToggleButton is true
        expect(floatingButton.style.display).not.toBe('none');
    });

    it('should not show toggle button display if showToggleButton is false', () => {
        setupWidget({ isOpen: false, showToggleButton: false });

        // Debug log
        if (floatingButton) {
            // eslint-disable-next-line no-console
            console.log('floatingButton.outerHTML:', floatingButton.outerHTML, 'style.display:', floatingButton.style.display);
        } else {
            // eslint-disable-next-line no-console
            console.log('floatingButton is null. document.body.innerHTML:', document.body.innerHTML);
        }
        expect(floatingButton.style.display).toBe('none'); // Button initially hidden
        widget.toggleChatVisibility(); // Open chat
        expect(chatContainer.style.display).not.toBe('none');
        expect(floatingButton.style.display).toBe('none'); // Still hidden
        widget.toggleChatVisibility(); // Close chat
        expect(chatContainer.style.display).toBe('none');
        expect(floatingButton.style.display).toBe('none'); // Still hidden
    });

    it('destroy method should remove elements and call ChatWidget.destroy', () => {
        setupWidget();
        const chatWidgetInstance = (widget as any).chatWidgetInstance;
        expect(document.body.contains(floatingButton)).toBe(true);
        expect(document.body.contains(chatContainer)).toBe(true);

        widget.destroy();

        expect(chatWidgetInstance.destroy).toHaveBeenCalled();
        expect(document.body.contains(floatingButton)).toBe(false);
        expect(document.body.contains(chatContainer)).toBe(false);
        expect((widget as any).floatingButton).toBeNull();
        expect((widget as any).chatContainer).toBeNull();
    });
}); 