import { LangflowChatClient } from '../clients/LangflowChatClient';
import { Logger } from '../utils/logger';
import { ChatMessageProcessor, MessageProcessorUICallbacks } from './ChatMessageProcessor';
import { ChatDisplayManager, ChatDisplayManagerConfig } from './ChatDisplayManager';
import { ChatTemplateManager, TemplateManagerConfig } from './ChatTemplateManager';
import { ChatSessionManager } from './ChatSessionManager';
import { DatetimeHandler } from '../utils/datetimeUtils';
import { SenderConfig } from '../types';

/**
 * Configuration options for the ChatWidget.
 * Extends Partial<SenderConfig> for optional sender name overrides.
 */
export interface ChatWidgetConfigOptions extends Partial<SenderConfig> {
    /** Optional HTML template for the main chat container. */
    mainContainerTemplate?: string;
    /** Optional HTML template for the chat input area. */
    inputAreaTemplate?: string;
    /** Optional HTML template for a single chat message. */
    messageTemplate?: string;
    /** Optional title for the chat widget. */
    widgetTitle?: string;
    /** Optional datetime format string (e.g., 'HH:mm') for displaying message timestamps. */
    datetimeFormat?: string;
}

/**
 * The main ChatWidget class.
 * Orchestrates the chat functionality by managing various sub-components:
 * - TemplateManager: Handles HTML templates.
 * - DisplayManager: Manages DOM updates for messages.
 * - SessionManager: Manages session ID and history.
 * - MessageProcessor: Handles message sending and processing logic.
 */
export class ChatWidget {
    private element: HTMLElement;
    private chatClient: LangflowChatClient;
    private enableStream: boolean;
    private currentBotMessageElement: HTMLElement | null = null;
    private onSessionIdUpdateCallback?: (sessionId: string) => void;
    
    /** Internal configuration with defaults applied. */
    private config: {
        userSender: string;
        botSender: string;
        errorSender: string;
        systemSender: string;
        mainContainerTemplate?: string;
        inputAreaTemplate?: string;
        messageTemplate?: string;
        widgetTitle?: string;
        datetimeFormat?: string;
    };
    
    private sendButtonClickListener?: () => void;
    private chatInputKeyPressListener?: (event: KeyboardEvent) => void;

    private logger: Logger;
    private messageProcessor: ChatMessageProcessor;
    private displayManager: ChatDisplayManager;
    private templateManager: ChatTemplateManager;
    private sessionManager: ChatSessionManager;

    /**
     * Constructs a ChatWidget instance.
     * @param {HTMLElement} containerElement - The HTML element to render the widget into.
     * @param {LangflowChatClient} chatClient - The client for API interactions.
     * @param {boolean} [enableStream=true] - Whether to enable streaming for bot responses.
     * @param {ChatWidgetConfigOptions} configOptions - Configuration options for the widget.
     * @param {Logger} logger - Logger instance.
     * @param {string} [initialSessionId] - Optional initial session ID.
     * @param {(sessionId: string) => void} [onSessionIdUpdate] - Optional callback for when the session ID is updated.
     */
    constructor(
        containerElement: HTMLElement,
        chatClient: LangflowChatClient, 
        enableStream: boolean = true,
        configOptions: ChatWidgetConfigOptions,
        logger: Logger,
        initialSessionId?: string,
        onSessionIdUpdate?: (sessionId: string) => void
    ) {
        if (!containerElement) {
            throw new Error(`Container element provided to ChatWidget is null or undefined.`);
        }
        if (!chatClient) {
            throw new Error('LangflowChatClient instance is required.');
        }

        this.element = containerElement;
        this.chatClient = chatClient;
        this.enableStream = enableStream;
        this.logger = logger;
        this.onSessionIdUpdateCallback = onSessionIdUpdate;

        // Captured for use in the MessageProcessorUICallbacks.updateSessionId closure.
        // This ensures that the external onSessionIdUpdate callback is only triggered for genuinely new session IDs,
        // or when a session ID is first established if no initialSessionId was provided.
        const capturedInitialSessionId = initialSessionId; 

        this.config = {
            userSender: configOptions.userSender || "You",
            botSender: configOptions.botSender || "Bot",
            errorSender: configOptions.errorSender || "Error",
            systemSender: configOptions.systemSender || "System",
            mainContainerTemplate: configOptions.mainContainerTemplate,
            inputAreaTemplate: configOptions.inputAreaTemplate,
            messageTemplate: configOptions.messageTemplate,
            widgetTitle: configOptions.widgetTitle, 
            datetimeFormat: configOptions.datetimeFormat,
        };
        
        const templateMgrConfig: TemplateManagerConfig = {
            mainContainerTemplate: this.config.mainContainerTemplate,
            inputAreaTemplate: this.config.inputAreaTemplate,
            messageTemplate: this.config.messageTemplate,
        };
        this.templateManager = new ChatTemplateManager(templateMgrConfig, this.logger);

        this.render();

        const displayMgrConfig: ChatDisplayManagerConfig = {
            messageTemplate: this.templateManager.getMessageTemplate(),
            userSender: this.config.userSender,
            botSender: this.config.botSender,
            errorSender: this.config.errorSender,
            systemSender: this.config.systemSender,
            datetimeFormat: this.config.datetimeFormat,
        };
        this.displayManager = new ChatDisplayManager(
            this.element, 
            displayMgrConfig, 
            this.logger
        );

        this.sessionManager = new ChatSessionManager(
            this.chatClient,
            { // SenderConfig for session manager
                userSender: this.config.userSender,
                botSender: this.config.botSender,
                errorSender: this.config.errorSender,
                systemSender: this.config.systemSender,
            },
            { // SessionManagerDisplayCallbacks
                clearMessages: () => this.displayManager.clearMessages(),
                addMessage: (sender: string, message: string, isThinking?: boolean, datetime?: string) => 
                    this.displayManager.addMessageToDisplay(sender, message, isThinking, datetime),
                scrollChatToBottom: () => this.displayManager.scrollChatToBottom(),
            },
            this.logger,
            initialSessionId // Pass initialSessionId to SessionManager for it to handle initial load
        );
        
        const messageProcessorCallbacks: MessageProcessorUICallbacks = {
            addMessage: (sender, message, isThinking, datetime) => this.displayManager.addMessageToDisplay(sender, message, isThinking, datetime),
            updateMessageContent: (element, htmlOrText) => this.displayManager.updateBotMessageContent(element, htmlOrText),
            removeMessage: (element) => this.displayManager.removeMessageElement(element),
            getBotMessageElement: () => this.currentBotMessageElement, 
            setBotMessageElement: (element) => { this.currentBotMessageElement = element; },
            scrollChatToBottom: () => this.displayManager.scrollChatToBottom(),
            updateSessionId: (sessionId) => {
                this.sessionManager.processSessionIdUpdateFromFlow(sessionId); // Inform SessionManager
                // Notify external listeners if the session ID has genuinely changed or is newly established.
                if (this.onSessionIdUpdateCallback && (capturedInitialSessionId !== sessionId || !capturedInitialSessionId)) {
                    this.onSessionIdUpdateCallback(sessionId);
                }
            },
            setInputDisabled: (disabled: boolean) => this.setInputDisabled(disabled),
        };

        this.messageProcessor = new ChatMessageProcessor(
            this.chatClient,
            { // SenderConfig for message processor
                userSender: this.config.userSender,
                botSender: this.config.botSender,
                errorSender: this.config.errorSender,
                systemSender: this.config.systemSender,
            },
            this.logger,
            messageProcessorCallbacks,
            () => this.enableStream, // Pass a function to get the current enableStream state
            () => this.sessionManager.currentSessionId // Pass a function to get the current session ID
        );
    }

    /**
     * Renders the initial structure of the chat widget using templates.
     * Sets the widget title if provided and ensures essential DOM elements are present.
     */
    private render(): void {
        this.element.innerHTML = this.templateManager.getMainContainerTemplate();

        if (this.config.widgetTitle) {
            const headerElement = this.element.querySelector<HTMLElement>('.chat-widget-header');
            const titleTextElement = this.element.querySelector<HTMLElement>('.chat-widget-title-text');
            if (headerElement && titleTextElement) {
                titleTextElement.textContent = this.config.widgetTitle;
                // Assuming header should be visible if title is set. 
                // Default template might hide it if no title, or CSS could manage visibility.
                headerElement.style.display = 'flex'; // Or 'block', depending on desired layout
            } else {
                this.logger.warn("widgetTitle is set, but '.chat-widget-header' or '.chat-widget-title-text' not found in mainContainerTemplate.");
            }
        }

        const inputAreaContainer = this.element.querySelector('#chat-input-area-container');
        if (inputAreaContainer) {
            inputAreaContainer.innerHTML = this.templateManager.getInputAreaTemplate();
        } else {
            this.logger.warn("#chat-input-area-container not found in mainContainerTemplate. Input area will be appended to .chat-widget if possible.");
            const chatWidgetDiv = this.element.querySelector('.chat-widget');
            if (chatWidgetDiv) {
                const tempDiv = document.createElement('div');
                tempDiv.innerHTML = this.templateManager.getInputAreaTemplate();
                if (tempDiv.firstElementChild) {
                    chatWidgetDiv.appendChild(tempDiv.firstElementChild);
                } else {
                    this.logger.error("Input area template did not produce a valid element to append.");
                }
            } else {
                 this.logger.error("Critical rendering error. Neither #chat-input-area-container nor .chat-widget found. Cannot append input area.");
            }
        }

        // Check for essential elements after rendering templates
        const chatMessages = this.element.querySelector('.chat-messages');
        const chatInput = this.element.querySelector<HTMLInputElement>('.chat-input');
        const sendButton = this.element.querySelector<HTMLButtonElement>('.send-button');

        if (!chatMessages || !chatInput || !sendButton) {
            this.logger.error(
                "Essential elements (.chat-messages, .chat-input, .send-button) not found after rendering. " +
                "Functionality may be impaired. This may indicate issues with the provided templates or DOM structure."
            );
            // Depending on severity, could throw an error here if widget is unusable.
        }
        // Ensure inputs are enabled by default after render
        if (chatInput) chatInput.disabled = false;
        if (sendButton) sendButton.disabled = false;

        this.setupEventListeners();
    }

    /**
     * Sets up event listeners for the chat input and send button.
     */
    private setupEventListeners(): void {
        const sendButton = this.element.querySelector<HTMLButtonElement>('.send-button');
        const chatInput = this.element.querySelector<HTMLInputElement>('.chat-input');

        if (sendButton && chatInput) {
            this.sendButtonClickListener = () => this.handleSendButtonClick(chatInput);
            this.chatInputKeyPressListener = (event: KeyboardEvent) => {
                if (event.key === 'Enter' && !chatInput.disabled) {
                    this.handleSendButtonClick(chatInput);
                }
            };

            sendButton.addEventListener('click', this.sendButtonClickListener);
            chatInput.addEventListener('keypress', this.chatInputKeyPressListener);
        }
    }

    /**
     * Removes event listeners from chat input and send button.
     * Called during destruction to prevent memory leaks.
     */
    private removeEventListeners(): void {
        const sendButton = this.element.querySelector<HTMLButtonElement>('.send-button');
        const chatInput = this.element.querySelector<HTMLInputElement>('.chat-input');

        if (sendButton && this.sendButtonClickListener) {
            sendButton.removeEventListener('click', this.sendButtonClickListener);
            this.sendButtonClickListener = undefined;
        }
        if (chatInput && this.chatInputKeyPressListener) {
            chatInput.removeEventListener('keypress', this.chatInputKeyPressListener);
            this.chatInputKeyPressListener = undefined;
        }
    }

    /**
     * Handles the send button click event.
     * @param {HTMLInputElement} chatInput - The chat input element.
     */
    private handleSendButtonClick(chatInput: HTMLInputElement): void {
        const message = chatInput.value;
        this.processMessage(message, chatInput);
    }

    /**
     * Processes the user's message: adds it to the display, clears the input,
     * and passes it to the MessageProcessor.
     * @param {string} message - The message text from the user.
     * @param {HTMLInputElement} chatInput - The chat input element (to clear it after sending).
     */
    private async processMessage(message: string, chatInput: HTMLInputElement): Promise<void> {
        if (!message.trim()) {
            return; // Do not send empty messages
        }

        // Display user's message immediately
        this.displayManager.addMessageToDisplay(this.config.userSender, message, false, new Date().toLocaleString());
        const currentMessageText = message;
        chatInput.value = ''; // Clear input after sending

        // Let MessageProcessor handle the actual sending and bot response
        await this.messageProcessor.process(currentMessageText);
    }

    /**
     * Sets the session ID for the chat widget and loads its history.
     * Delegates to ChatSessionManager and notifies external listeners.
     * @param {string | null} newSessionId - The new session ID, or null to clear the session.
     */
    public async setSessionId(newSessionId: string | null): Promise<void> {
        this.logger.info(`ChatWidget: External call to set session ID to: ${newSessionId}`);
        await this.sessionManager.setSessionIdAndLoadHistory(newSessionId ?? undefined);
        // Notify external listeners if a new session ID is established and a callback is provided.
        if (newSessionId !== null && this.onSessionIdUpdateCallback) {
            this.onSessionIdUpdateCallback(newSessionId);
        }
    }

    /**
     * Destroys the chat widget instance, removing event listeners and clearing its content.
     */
    public destroy(): void {
        this.removeEventListeners();
        if (this.element) {
            this.element.innerHTML = ''; // Clear widget content
        }
        this.currentBotMessageElement = null; // Clear reference
        this.logger.info("ChatWidget instance destroyed.");
    }

    /**
     * Registers a custom datetime handler function with the DisplayManager.
     * @param {DatetimeHandler} handler - The datetime handler function to register.
     */
    public registerDatetimeHandler(handler: DatetimeHandler) {
        if (this.displayManager) {
            this.displayManager.setDatetimeHandler(handler);
        } else {
            this.logger.warn("DisplayManager not available to register datetime handler. Widget might not be fully initialized.");
        }
    }

    /**
     * Enables or disables the chat input field and send button.
     * @param {boolean} disabled - True to disable, false to enable.
     */
    private setInputDisabled(disabled: boolean): void {
        const chatInput = this.element.querySelector<HTMLInputElement>('.chat-input');
        const sendButton = this.element.querySelector<HTMLButtonElement>('.send-button');
        if (chatInput) chatInput.disabled = disabled;
        if (sendButton) sendButton.disabled = disabled;
        if (!disabled && chatInput) {
            chatInput.focus(); // Focus input when enabled
        }
    }

    /**
     * Gets the internal, resolved configuration of the widget (including defaults).
     * @returns {Readonly<typeof this.config>} The read-only internal configuration.
     */
    public getInternalConfig(): Readonly<typeof this.config> {
        return this.config;
    }
} 