/** @jest-environment jsdom */

import { ChatTemplateManager, TemplateManagerConfig } from '../../src/components/ChatTemplateManager';
import { Logger } from '../../src/utils/logger';

// Mock Logger
const mockLogger: jest.Mocked<Logger> = {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    // @ts-ignore
    level: 'debug',
    // @ts-ignore
    prefix: 'TestLogger',
    setLevel: jest.fn(),
    // @ts-ignore
    shouldLog: jest.fn().mockReturnValue(true),
    // @ts-ignore
    format: jest.fn((level, ...args) => [`[TestLogger] [${level.toUpperCase()}]`, ...args]),
    // @ts-ignore 
    constructor: jest.fn(),
};

describe('ChatTemplateManager', () => {
    let manager: ChatTemplateManager;

    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('should be defined', () => {
        manager = new ChatTemplateManager({}, mockLogger);
        expect(manager).toBeDefined();
    });

    describe('constructor and default templates', () => {
        it('should use default templates when no custom templates are provided', () => {
            const manager = new ChatTemplateManager({}, mockLogger);
            // Access private static defaults for comparison - a bit of a hack for testing, but necessary here
            // @ts-ignore
            expect(manager.getMainContainerTemplate()).toBe((ChatTemplateManager as any).DEFAULT_MAIN_CONTAINER_TEMPLATE);
            // @ts-ignore
            expect(manager.getInputAreaTemplate()).toBe((ChatTemplateManager as any).DEFAULT_INPUT_AREA_TEMPLATE);
            // @ts-ignore
            expect(manager.getMessageTemplate()).toBe((ChatTemplateManager as any).DEFAULT_MESSAGE_TEMPLATE);
            expect(mockLogger.error).not.toHaveBeenCalled(); // No errors should be logged for defaults
        });

        it('should use provided valid custom templates', () => {
            const customConfig: TemplateManagerConfig = {
                mainContainerTemplate: '<div id="chat-input-area-container"><div class="chat-messages">Custom Main</div></div>',
                inputAreaTemplate: '<div class="chat-input">Custom Input</div><button class="send-button">Send</button>',
                messageTemplate: '<div class="{{messageClasses}}">{{sender}}: <span class="message-text-content">{{message}}</span></div>',
            };
            const manager = new ChatTemplateManager(customConfig, mockLogger);
            expect(manager.getMainContainerTemplate()).toBe(customConfig.mainContainerTemplate);
            expect(manager.getInputAreaTemplate()).toBe(customConfig.inputAreaTemplate);
            expect(manager.getMessageTemplate()).toBe(customConfig.messageTemplate);
            expect(mockLogger.error).not.toHaveBeenCalled();
        });
    });

    describe('template validation (via constructor)', () => {
        const validMainContainer = '<div id="chat-input-area-container"><div class="chat-messages"></div></div>';
        const validInputArea = '<input class="chat-input" /><button class="send-button"></button>';
        const validMessage = '<div class="{{messageClasses}}">{{sender}}<span class="message-text-content">{{message}}</span></div>';

        // --- Main Container Validation Tests ---
        it('should throw error if mainContainerTemplate is missing id="chat-input-area-container"', () => {
            const invalidConfig: TemplateManagerConfig = { mainContainerTemplate: '<div><div class="chat-messages"></div></div>' };
            expect(() => new ChatTemplateManager(invalidConfig, mockLogger))
                .toThrow('Invalid mainContainerTemplate: Missing element with id="chat-input-area-container".');
            expect(mockLogger.error).toHaveBeenCalledWith('Provided mainContainerTemplate is missing element with id="chat-input-area-container". This is critical for input area placement.');
        });

        it('should throw error if mainContainerTemplate is missing class="chat-messages"', () => {
            const invalidConfig: TemplateManagerConfig = { mainContainerTemplate: '<div id="chat-input-area-container"></div>' };
            expect(() => new ChatTemplateManager(invalidConfig, mockLogger))
                .toThrow('Invalid mainContainerTemplate: Missing an element with class="chat-messages".');
            expect(mockLogger.error).toHaveBeenCalledWith('Provided mainContainerTemplate is missing an element with class="chat-messages". This is critical for message display.');
        });

        // --- Input Area Validation Tests ---
        it('should throw error if inputAreaTemplate is missing class="chat-input"', () => {
            const invalidConfig: TemplateManagerConfig = { 
                mainContainerTemplate: validMainContainer, 
                inputAreaTemplate: '<input /><button class="send-button"></button>' 
            };
            expect(() => new ChatTemplateManager(invalidConfig, mockLogger))
                .toThrow('Invalid inputAreaTemplate: Missing element with class "chat-input".');
            expect(mockLogger.error).toHaveBeenCalledWith('Provided inputAreaTemplate is missing an element with class "chat-input". This is critical for user input.');
        });

        it('should throw error if inputAreaTemplate is missing class="send-button"', () => {
            const invalidConfig: TemplateManagerConfig = { 
                mainContainerTemplate: validMainContainer, 
                inputAreaTemplate: '<input class="chat-input" /><button></button>' 
            };
            expect(() => new ChatTemplateManager(invalidConfig, mockLogger))
                .toThrow('Invalid inputAreaTemplate: Missing element with class "send-button".');
            expect(mockLogger.error).toHaveBeenCalledWith('Provided inputAreaTemplate is missing an element with class "send-button". This is critical for sending messages.');
        });

        // --- Message Template Validation Tests ---
        it('should throw error if messageTemplate is missing {{message}} placeholder', () => {
            const invalidConfig: TemplateManagerConfig = { 
                mainContainerTemplate: validMainContainer, 
                inputAreaTemplate: validInputArea,
                messageTemplate: '<div class="{{messageClasses}}">{{sender}}<span class="message-text-content"></span></div>' 
            };
            expect(() => new ChatTemplateManager(invalidConfig, mockLogger))
                .toThrow('Invalid messageTemplate: Missing {{message}} placeholder.');
            expect(mockLogger.error).toHaveBeenCalledWith('Provided messageTemplate is missing the {{message}} placeholder. This is critical.');
        });

        it('should throw error if messageTemplate is missing {{messageClasses}} placeholder', () => {
            const invalidConfig: TemplateManagerConfig = { 
                mainContainerTemplate: validMainContainer, 
                inputAreaTemplate: validInputArea,
                messageTemplate: '<div>{{sender}}<span class="message-text-content">{{message}}</span></div>' 
            };
            expect(() => new ChatTemplateManager(invalidConfig, mockLogger))
                .toThrow('Invalid messageTemplate: Missing {{messageClasses}} placeholder.');
            expect(mockLogger.error).toHaveBeenCalledWith('Provided messageTemplate is missing the {{messageClasses}} placeholder. This is critical for message styling and identification.');
        });

        it('should throw error if messageTemplate is missing {{sender}} placeholder', () => {
            const invalidConfig: TemplateManagerConfig = { 
                mainContainerTemplate: validMainContainer, 
                inputAreaTemplate: validInputArea,
                messageTemplate: '<div class="{{messageClasses}}"><span class="message-text-content">{{message}}</span></div>' 
            };
            expect(() => new ChatTemplateManager(invalidConfig, mockLogger))
                .toThrow('Invalid messageTemplate: Missing {{sender}} placeholder.');
            expect(mockLogger.error).toHaveBeenCalledWith('Provided messageTemplate is missing the {{sender}} placeholder. This is critical for displaying the message sender.');
        });

        it('should throw error if messageTemplate is missing class="message-text-content"', () => {
            const invalidConfig: TemplateManagerConfig = { 
                mainContainerTemplate: validMainContainer, 
                inputAreaTemplate: validInputArea,
                messageTemplate: '<div class="{{messageClasses}}">{{sender}}<span>{{message}}</span></div>' // Missing class
            };
            expect(() => new ChatTemplateManager(invalidConfig, mockLogger))
                .toThrow('Invalid messageTemplate: Missing element with class "message-text-content" for streaming updates.');
            expect(mockLogger.error).toHaveBeenCalledWith('Provided messageTemplate is missing an element with class "message-text-content". Streaming updates will not work correctly.');
        });

        it('should pass validation if all templates are valid (using default message template with other valid ones)', () => {
            const validConfig: TemplateManagerConfig = {
                mainContainerTemplate: validMainContainer,
                inputAreaTemplate: validInputArea,
                // messageTemplate: validMessage, // Implicitly uses default if not provided or uses the one set if valid
            };
            expect(() => new ChatTemplateManager(validConfig, mockLogger)).not.toThrow();
            expect(mockLogger.error).not.toHaveBeenCalled();
        });

    });

    // Getter tests can be simple confirmations as they are covered by constructor tests
    describe('getter methods', () => {
        it('getMainContainerTemplate should return the main container template', () => {
            const manager = new ChatTemplateManager({}, mockLogger);
            // @ts-ignore
            expect(manager.getMainContainerTemplate()).toBe((ChatTemplateManager as any).DEFAULT_MAIN_CONTAINER_TEMPLATE);
        });

        it('getInputAreaTemplate should return the input area template', () => {
            const manager = new ChatTemplateManager({}, mockLogger);
            // @ts-ignore
            expect(manager.getInputAreaTemplate()).toBe((ChatTemplateManager as any).DEFAULT_INPUT_AREA_TEMPLATE);
        });

        it('getMessageTemplate should return the message template', () => {
            const manager = new ChatTemplateManager({}, mockLogger);
            // @ts-ignore
            expect(manager.getMessageTemplate()).toBe((ChatTemplateManager as any).DEFAULT_MESSAGE_TEMPLATE);
        });
    });
}); 