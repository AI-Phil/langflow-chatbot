/** @jest-environment jsdom */

import { ChatDisplayManager, ChatDisplayManagerConfig } from '../src/components/ChatDisplayManager';
import { Logger } from '../src/utils/logger';
import { DatetimeHandler } from '../src/utils/datetimeUtils';
import * as datetimeUtils from '../src/utils/datetimeUtils'; // Import for mocking

// Mock Logger
const mockLogger: jest.Mocked<Logger> = {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    level: 'debug', 
    prefix: 'TestLogger', 
    setLevel: jest.fn(),
    shouldLog: jest.fn().mockReturnValue(true), 
    format: jest.fn((level, ...args) => [`[TestLogger] [${level.toUpperCase()}]`, ...args]),
    // @ts-ignore - a bit of a hack to allow for partial mocking if we were to extend this
    constructor: jest.fn(), 
};

// Mock DatetimeHandler
const mockDatetimeHandler: DatetimeHandler = jest.fn(); // Default mock, specific implementations per test or in beforeEach
const mockInvalidDatetimeHandler = jest.fn(() => { throw new Error("Test error")});

// Spy on createDefaultDatetimeHandler BEFORE describe block
// This ensures ChatDisplayManager instances always get our mockDatetimeHandler.
const createDefaultDatetimeHandlerSpy = jest.spyOn(datetimeUtils, 'createDefaultDatetimeHandler');

describe('ChatDisplayManager', () => {
    let widgetElement: HTMLElement;
    let chatMessagesContainer: HTMLElement;
    let config: ChatDisplayManagerConfig;
    let chatDisplayManager: ChatDisplayManager;
    let scrollSpy: jest.SpyInstance; // To hold the spy for scrollChatToBottom

    beforeEach(() => {
        jest.clearAllMocks(); // Clear all mocks, including spies and datetimeHandler calls

        // Configure createDefaultDatetimeHandlerSpy to return our global mockDatetimeHandler for each test
        createDefaultDatetimeHandlerSpy.mockReturnValue(mockDatetimeHandler);

        // Default implementation for mockDatetimeHandler for most tests (HH:mm format)
        (mockDatetimeHandler as jest.Mock).mockImplementation(isoString => {
            const date = new Date(isoString);
            const hours = date.getHours().toString().padStart(2, '0');
            const minutes = date.getMinutes().toString().padStart(2, '0');
            return `${hours}:${minutes}`;
        });

        widgetElement = document.createElement('div');
        chatMessagesContainer = document.createElement('div');
        chatMessagesContainer.className = 'chat-messages';
        widgetElement.appendChild(chatMessagesContainer);
        document.body.appendChild(widgetElement);

        config = {
            messageTemplate: '<div class="{{messageClasses}}"><span>{{sender}}</span>: <div>{{message}}</div><span class="datetime">{{datetime}}</span></div>',
            userSender: 'User',
            botSender: 'Bot',
            errorSender: 'Error',
            systemSender: 'System',
            datetimeFormat: 'HH:mm', // Critical for constructor and default formatting
        };

        chatDisplayManager = new ChatDisplayManager(widgetElement, config, mockLogger);
        // Spy on the instance method for scrollChatToBottom AFTER chatDisplayManager is created
        scrollSpy = jest.spyOn(chatDisplayManager, 'scrollChatToBottom').mockImplementation(() => {});
    });

    afterEach(() => {
        if (widgetElement.parentNode) {
            widgetElement.parentNode.removeChild(widgetElement);
        }
    });

    describe('constructor', () => {
        it('should initialize correctly with a valid .chat-messages container', () => {
            expect(chatDisplayManager).toBeInstanceOf(ChatDisplayManager);
            expect(mockLogger.error).not.toHaveBeenCalled();
            // @ts-expect-error private property access
            expect(chatDisplayManager.chatMessagesContainer).toBe(chatMessagesContainer);
        });

        it('should log an error if .chat-messages container is not found', () => {
            const emptyWidgetElement = document.createElement('div');
            new ChatDisplayManager(emptyWidgetElement, config, mockLogger); // This will use the mocked createDefaultDatetimeHandler
            expect(mockLogger.error).toHaveBeenCalledWith("ChatDisplayManager: .chat-messages container not found in widgetElement.");
        });

        it('should initialize with a datetime handler configured by datetimeFormat', () => {
            const now = new Date();
            const expectedFormattedTime = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;

            // Verify that createDefaultDatetimeHandler was called with the format from config
            expect(createDefaultDatetimeHandlerSpy).toHaveBeenCalledWith(config.datetimeFormat);
            
            // Call the handler (which is our mockDatetimeHandler) and check its output
            // @ts-expect-error private property access - this accesses the internal handler, which is mockDatetimeHandler
            const actualTime = chatDisplayManager.datetimeHandler(now.toISOString());
            expect(actualTime).toBe(expectedFormattedTime);
            // Ensure our global mock (which is the one returned by the spy) was called
            expect(mockDatetimeHandler).toHaveBeenCalledWith(now.toISOString());
        });
    });

    describe('setDatetimeHandler', () => {
        it('should set a new valid datetime handler', () => {
            const customHandler: DatetimeHandler = jest.fn(isoString => `Custom: ${new Date(isoString).getFullYear()}`);
            chatDisplayManager.setDatetimeHandler(customHandler);
            const testDate = new Date().toISOString();
            // Adding a message will trigger the currently set datetimeHandler
            chatDisplayManager.addMessageToDisplay('User', 'Test', false, testDate);
            expect(customHandler).toHaveBeenCalledWith(testDate);
            expect(mockLogger.info).toHaveBeenCalledWith("ChatDisplayManager: Custom datetime handler set successfully.");
        });

        it('should log a warning and not set an invalid datetime handler (throws error)', () => {
            // @ts-expect-error private property access 
            const originalHandler = chatDisplayManager.datetimeHandler; // This is mockDatetimeHandler initially
            chatDisplayManager.setDatetimeHandler(mockInvalidDatetimeHandler);
            expect(mockLogger.warn).toHaveBeenCalledWith("ChatDisplayManager: Attempted to set an invalid or misbehaving datetime handler. Using previous or default handler.");
            // @ts-expect-error private property access
            expect(chatDisplayManager.datetimeHandler).toBe(originalHandler);
        });

        it('should log a warning and not set an invalid datetime handler (returns non-string)', () => {
            // @ts-expect-error private property access
            const originalHandler = chatDisplayManager.datetimeHandler;
            const badHandler = (() => 123) as unknown as DatetimeHandler;
            chatDisplayManager.setDatetimeHandler(badHandler);
            expect(mockLogger.warn).toHaveBeenCalledWith("ChatDisplayManager: Attempted to set an invalid or misbehaving datetime handler. Using previous or default handler.");
            // @ts-expect-error private property access
            expect(chatDisplayManager.datetimeHandler).toBe(originalHandler);
        });
    });

    describe('addMessageToDisplay', () => {
        // scrollSpy is set up in the main beforeEach and mockClear is called here
        beforeEach(() => {
            scrollSpy.mockClear();
        });

        it('should add a user message to the display and scroll to bottom', () => {
            const messageElement = chatDisplayManager.addMessageToDisplay('User', 'Hello user!', false);
            expect(messageElement).not.toBeNull();
            expect(messageElement?.classList.contains('user-message')).toBe(true);
            expect(messageElement?.innerHTML).toContain('Hello user!');
            expect(messageElement?.innerHTML).toContain('User');
            expect(chatMessagesContainer.children.length).toBe(1);
            expect(chatMessagesContainer.firstElementChild).toBe(messageElement);
            expect(scrollSpy).toHaveBeenCalled();
        });

        it('should add a bot message to the display', () => {
            const messageElement = chatDisplayManager.addMessageToDisplay('Bot', 'Hello from bot!');
            expect(messageElement?.classList.contains('bot-message')).toBe(true);
            expect(messageElement?.innerHTML).toContain('Hello from bot!');
            expect(messageElement?.innerHTML).toContain('Bot');
        });

        it('should add an error message to the display', () => {
            const messageElement = chatDisplayManager.addMessageToDisplay('Error', 'An error occurred.');
            expect(messageElement?.classList.contains('error-message')).toBe(true);
            expect(messageElement?.innerHTML).toContain('An error occurred.');
            expect(messageElement?.innerHTML).toContain('Error');
        });

        it('should add a system message to the display', () => {
            const messageElement = chatDisplayManager.addMessageToDisplay('System', 'System update.');
            expect(messageElement?.classList.contains('system-message')).toBe(true);
            expect(messageElement?.innerHTML).toContain('System update.');
            expect(messageElement?.innerHTML).toContain('System');
        });

        it('should add a thinking message to the display', () => {
            const messageElement = chatDisplayManager.addMessageToDisplay('Bot', 'Thinking...', true);
            expect(messageElement?.classList.contains('bot-message')).toBe(true);
            expect(messageElement?.classList.contains('thinking')).toBe(true);
            expect(messageElement?.innerHTML).toContain('Thinking...');
        });

        it('should use the datetime handler to format the datetime', () => {
            const testDate = new Date(2023, 0, 15, 10, 30, 0); // Jan 15, 2023, 10:30:00
            const expectedFormattedTime = `10:30`; // Based on HH:mm mock implementation
            
            // mockDatetimeHandler is already configured to format as HH:mm by the top-level beforeEach
            const messageElement = chatDisplayManager.addMessageToDisplay('User', 'Test with date', false, testDate.toISOString());
            expect(mockDatetimeHandler).toHaveBeenCalledWith(testDate.toISOString()); // Check if the correct handler was called
            expect(messageElement?.querySelector('.datetime')?.textContent).toBe(expectedFormattedTime);
        });

        it('should use current time if datetime is not provided', () => {
            const now = new Date();
            // Spy on the internal datetimeHandler to check its argument
            // The internal handler IS mockDatetimeHandler due to the createDefaultDatetimeHandlerSpy
            // No need to spy on chatDisplayManager.datetimeHandler directly if we trust the spy setup.

            chatDisplayManager.addMessageToDisplay('User', 'Test without date');
            
            expect(mockDatetimeHandler).toHaveBeenCalled();
            const lastCallArgs = (mockDatetimeHandler as jest.Mock).mock.calls[
                (mockDatetimeHandler as jest.Mock).mock.calls.length - 1
            ];
            const calledWithDate = new Date(lastCallArgs[0] as string);
            expect(Math.abs(calledWithDate.getTime() - now.getTime())).toBeLessThan(5000); 
        });

        it('should return null and log error if chatMessagesContainer is not available', () => {
            // @ts-expect-error private property access
            chatDisplayManager.chatMessagesContainer = null; 
            const messageElement = chatDisplayManager.addMessageToDisplay('User', 'Test');
            expect(messageElement).toBeNull();
            expect(mockLogger.error).toHaveBeenCalledWith("Cannot add message, .chat-messages container not found.");
            // @ts-expect-error private property access
            chatDisplayManager.chatMessagesContainer = chatMessagesContainer; 
        });

        it('should return null and log error if message template fails to create an element', () => {
            const originalTemplate = config.messageTemplate;
            config.messageTemplate = ''; 
            // Re-initialize ChatDisplayManager with the problematic config
            // createDefaultDatetimeHandlerSpy will ensure mockDatetimeHandler is used.
            // The new ChatDisplayManager instance needs its scrollChatToBottom spied on.
            chatDisplayManager = new ChatDisplayManager(widgetElement, config, mockLogger); 
            scrollSpy = jest.spyOn(chatDisplayManager, 'scrollChatToBottom').mockImplementation(() => {}); 

            const messageElement = chatDisplayManager.addMessageToDisplay('User', 'Test');
            expect(messageElement).toBeNull();
            expect(mockLogger.error).toHaveBeenCalledWith("ChatDisplayManager: Failed to create message element from template.");
            
            config.messageTemplate = originalTemplate; // Restore
            // Re-create with original config for subsequent tests / other describe blocks
            chatDisplayManager = new ChatDisplayManager(widgetElement, config, mockLogger); 
            scrollSpy = jest.spyOn(chatDisplayManager, 'scrollChatToBottom').mockImplementation(() => {}); 
        });

    });

    describe('updateBotMessageContent', () => {
        let botMessageElement: HTMLElement;
        const initialBotMessage = 'Initial bot message';
        const updatedBotMessage = 'Updated bot message content';

        beforeEach(() => {
            // scrollSpy is spied in the main beforeEach and cleared here
            scrollSpy.mockClear();
            
            botMessageElement = chatDisplayManager.addMessageToDisplay('Bot', initialBotMessage) as HTMLElement;
            expect(botMessageElement).not.toBeNull();
            // Clear calls to scrollSpy that happened during addMessageToDisplay
            scrollSpy.mockClear(); 
        });

        it('should update content of .message-text-content span if it exists and scroll', () => {
            const originalTemplate = config.messageTemplate;
            config.messageTemplate = '<div class="{{messageClasses}}"><span>{{sender}}</span>: <div class="message-text-content">{{message}}</div><span class="datetime">{{datetime}}</span></div>';
            
            // Re-initialize ChatDisplayManager for this specific template
            chatDisplayManager = new ChatDisplayManager(widgetElement, config, mockLogger); 
            scrollSpy = jest.spyOn(chatDisplayManager, 'scrollChatToBottom').mockImplementation(() => {}); // Re-spy on new instance
            
            botMessageElement = chatDisplayManager.addMessageToDisplay('Bot', initialBotMessage) as HTMLElement;
            scrollSpy.mockClear(); // Clear for the actual test assertion

            chatDisplayManager.updateBotMessageContent(botMessageElement, updatedBotMessage);

            const textContentSpan = botMessageElement.querySelector('.message-text-content');
            expect(textContentSpan).not.toBeNull();
            expect(textContentSpan?.innerHTML).toBe(updatedBotMessage);
            expect(scrollSpy).toHaveBeenCalled();

            config.messageTemplate = originalTemplate; // Restore template
            // Crucially, restore chatDisplayManager to the one set up in the main beforeEach for other tests in this describe block
            // or if other describe blocks rely on the main instance.
            // However, it's safer if each test/describe block manages its own instance if configs change this drastically.
            // For now, let's re-create with original config to ensure subsequent tests are not affected.
            chatDisplayManager = new ChatDisplayManager(widgetElement, config, mockLogger); 
            scrollSpy = jest.spyOn(chatDisplayManager, 'scrollChatToBottom').mockImplementation(() => {}); // Re-spy
        });

        it('should log a warning and use fallback if .message-text-content span is not found', () => {
            chatDisplayManager.updateBotMessageContent(botMessageElement, updatedBotMessage);
            expect(mockLogger.warn).toHaveBeenCalledWith("ChatDisplayManager: .message-text-content span not found in messageElement. Using fallback logic to update content.");
            // The SUT's fallback, for the default template, updates the first child (sender span).
            const firstChildElement = botMessageElement.firstElementChild as HTMLElement;
            expect(firstChildElement?.innerHTML).toBe(updatedBotMessage);
            expect(scrollSpy).toHaveBeenCalled();
        });

        it('should fallback to updating the first child element if not sender display', () => {
            botMessageElement.innerHTML = '<div class="content-area">Old</div><span class="datetime">Time</span>';
            chatDisplayManager.updateBotMessageContent(botMessageElement, 'New Content');
            const contentArea = botMessageElement.querySelector('.content-area');
            expect(contentArea?.innerHTML).toBe('New Content');
            expect(scrollSpy).toHaveBeenCalled();
        });

        it('should fallback to updating the next sibling if first child is sender-name-display', () => {
            botMessageElement.innerHTML = '<span class="sender-name-display">Bot</span><div class="actual-content">Old</div><span class="datetime">Time</span>';
            chatDisplayManager.updateBotMessageContent(botMessageElement, 'New Actual Content');
            const actualContent = botMessageElement.querySelector('.actual-content');
            expect(actualContent?.innerHTML).toBe('New Actual Content');
            expect(scrollSpy).toHaveBeenCalled();
        });

        it('should fallback to updating the messageElement itself if no other specific area found', () => {
            botMessageElement.innerHTML = ''; 
            chatDisplayManager.updateBotMessageContent(botMessageElement, 'Direct Update');
            expect(botMessageElement.innerHTML).toBe('Direct Update');
            expect(scrollSpy).toHaveBeenCalled();

            scrollSpy.mockClear();
            botMessageElement.innerHTML = '<span class="sender-name-display">Bot</span>';
            chatDisplayManager.updateBotMessageContent(botMessageElement, 'Updated Sender Area'); 
            expect(botMessageElement.innerHTML).toBe('Updated Sender Area');
            expect(scrollSpy).toHaveBeenCalled();
        });
    });

    describe('scrollChatToBottom', () => {
        let rAFCallback: FrameRequestCallback | undefined;
        let rAFMock: jest.SpyInstance;

        // scrollSpy (for the instance method) is already handled by the main beforeEach.
        // Here we mock the global requestAnimationFrame.
        beforeEach(() => {
            rAFCallback = undefined;
            rAFMock = jest.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
                rAFCallback = cb;
                return 0; 
            });
            // We are testing the scrollChatToBottom method itself, so we want the original implementation for this test.
            scrollSpy.mockRestore(); // Restore original scrollChatToBottom for these specific tests
                                   // OR, if it's simpler, create a new instance not spied on:
            // chatDisplayManager = new ChatDisplayManager(widgetElement, config, mockLogger); 
        });

        afterEach(() => {
            rAFMock.mockRestore();
            // Re-spy for other tests if it was restored for this block
            scrollSpy = jest.spyOn(chatDisplayManager, 'scrollChatToBottom').mockImplementation(() => {});
        });

        it('should set scrollTop to scrollHeight within requestAnimationFrame callback', () => {
            if (!chatMessagesContainer) throw new Error("chatMessagesContainer is null");
            Object.defineProperty(chatMessagesContainer, 'scrollHeight', { configurable: true, value: 500 });
            chatMessagesContainer.scrollTop = 100;

            chatDisplayManager.scrollChatToBottom(); // This will call the original method

            expect(rAFMock).toHaveBeenCalledTimes(1);
            expect(rAFCallback).toBeDefined();

            if (rAFCallback) {
                rAFCallback(Date.now()); 
                expect(chatMessagesContainer.scrollTop).toBe(500);
            }
        });

        it('should not throw if chatMessagesContainer is null when rAF callback executes', () => {
            if (!chatMessagesContainer) throw new Error("chatMessagesContainer is null");
             // @ts-expect-error private property access
            const originalContainer = chatDisplayManager.chatMessagesContainer;
            Object.defineProperty(chatMessagesContainer, 'scrollHeight', { configurable: true, value: 200 });
            chatMessagesContainer.scrollTop = 0;

            chatDisplayManager.scrollChatToBottom();
            expect(rAFMock).toHaveBeenCalledTimes(1);

            // Simulate container becoming null before rAF callback executes
             // @ts-expect-error private property access
            chatDisplayManager.chatMessagesContainer = null;

            expect(() => {
                if (rAFCallback) {
                    rAFCallback(Date.now());
                }
            }).not.toThrow();
            
             // @ts-expect-error private property access
            chatDisplayManager.chatMessagesContainer = originalContainer; // Restore
        });

        it('should do nothing if chatMessagesContainer is null initially', () => {
            // @ts-expect-error private property access
            const originalContainer = chatDisplayManager.chatMessagesContainer;
            // @ts-expect-error private property access
            chatDisplayManager.chatMessagesContainer = null;
            const mockRequestAnimationFrame = jest.spyOn(window, 'requestAnimationFrame');

            chatDisplayManager.scrollChatToBottom();
            expect(mockRequestAnimationFrame).not.toHaveBeenCalled();

            mockRequestAnimationFrame.mockRestore();
            // @ts-expect-error private property access
            chatDisplayManager.chatMessagesContainer = originalContainer; // Restore
        });
    });

    describe('removeMessageElement', () => {
        it('should remove the specified message element from the DOM', () => {
            const messageElement = chatDisplayManager.addMessageToDisplay('User', 'To be removed');
            expect(chatMessagesContainer.contains(messageElement)).toBe(true);
            if (messageElement) {
                chatDisplayManager.removeMessageElement(messageElement);
                expect(chatMessagesContainer.contains(messageElement)).toBe(false);
            }
        });

        it('should do nothing if element is null or has no parent', () => {
            const detachedElement = document.createElement('div');
            expect(() => chatDisplayManager.removeMessageElement(detachedElement)).not.toThrow();
            // @ts-expect-error testing with null
            expect(() => chatDisplayManager.removeMessageElement(null)).not.toThrow(); 
        });
    });

    describe('removeThinkingMessage', () => {
        it('should remove the message with class .thinking', () => {
            chatDisplayManager.addMessageToDisplay('Bot', 'Thinking...', true);
            let thinkingMessage = widgetElement.querySelector('.message.thinking');
            expect(thinkingMessage).not.toBeNull();

            chatDisplayManager.removeThinkingMessage();
            thinkingMessage = widgetElement.querySelector('.message.thinking');
            expect(thinkingMessage).toBeNull();
        });

        it('should do nothing if no thinking message is present', () => {
            chatDisplayManager.addMessageToDisplay('Bot', 'Not thinking', false);
            const initialMessageCount = chatMessagesContainer.children.length;
            
            chatDisplayManager.removeThinkingMessage();
            expect(chatMessagesContainer.children.length).toBe(initialMessageCount);
        });
    });

    describe('clearMessages', () => {
        it('should remove all messages from the chat messages container', () => {
            chatDisplayManager.addMessageToDisplay('User', 'Message 1');
            chatDisplayManager.addMessageToDisplay('Bot', 'Message 2');
            expect(chatMessagesContainer.children.length).toBeGreaterThan(0);

            chatDisplayManager.clearMessages();
            expect(chatMessagesContainer.children.length).toBe(0);
            expect(chatMessagesContainer.innerHTML).toBe('');
        });

        it('should do nothing if chatMessagesContainer is null', () => {
             // @ts-expect-error private property access
            const originalContainer = chatDisplayManager.chatMessagesContainer;
             // @ts-expect-error private property access
            chatDisplayManager.chatMessagesContainer = null;
            
            expect(() => chatDisplayManager.clearMessages()).not.toThrow();
            
             // @ts-expect-error private property access
            chatDisplayManager.chatMessagesContainer = originalContainer; // Restore
        });
    });

}); 