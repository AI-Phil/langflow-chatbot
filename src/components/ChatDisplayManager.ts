import { Logger } from './logger';
import { DatetimeHandler, createDefaultDatetimeHandler, isValidDatetimeHandler } from '../utils/datetimeUtils';
import { SenderConfig } from '../types';

/**
 * Configuration for the ChatDisplayManager.
 */
export interface ChatDisplayManagerConfig extends SenderConfig {
    /** The HTML template string for a single message. */
    messageTemplate: string;
    /** Optional datetime format string (e.g., 'HH:mm') for the default datetime handler. */
    datetimeFormat?: string;
}

/**
 * Manages the display of messages and other UI elements within the chat widget.
 * Handles DOM manipulations for adding, updating, and removing messages, scrolling, etc.
 */
export class ChatDisplayManager {
    private chatMessagesContainer: HTMLElement | null;
    private datetimeHandler: DatetimeHandler;

    /**
     * Constructs a ChatDisplayManager instance.
     * @param {HTMLElement} widgetElement - The main HTML element of the chat widget.
     * @param {ChatDisplayManagerConfig} config - Configuration for display behavior and templates.
     * @param {Logger} logger - An instance of the Logger for logging messages.
     */
    constructor(
        private widgetElement: HTMLElement,
        private config: ChatDisplayManagerConfig,
        private logger: Logger
    ) {
        this.chatMessagesContainer = this.widgetElement.querySelector('.chat-messages');
        if (!this.chatMessagesContainer) {
            this.logger.error("ChatDisplayManager: .chat-messages container not found in widgetElement.");
            // It will be harder to operate, but we don't throw here to allow potential recovery or partial functionality.
        }
        this.datetimeHandler = createDefaultDatetimeHandler(this.config.datetimeFormat); 
    }

    /**
     * Sets a custom datetime handler function.
     * If the new handler is invalid, the existing handler is retained.
     * @param {DatetimeHandler} newHandler - The new datetime handler function.
     */
    public setDatetimeHandler(newHandler: DatetimeHandler): void {
        if (isValidDatetimeHandler(newHandler)) {
            this.datetimeHandler = newHandler;
            this.logger.info("ChatDisplayManager: Custom datetime handler set successfully.");
        } else {
            this.logger.warn("ChatDisplayManager: Attempted to set an invalid or misbehaving datetime handler. Using previous or default handler.");
        }
    }

    /**
     * Adds a message to the chat display.
     * @param {string} sender - The sender of the message (e.g., user, bot).
     * @param {string} message - The message content (HTML or plain text).
     * @param {boolean} [isThinking=false] - Whether the message is a "thinking" indicator.
     * @param {string} [datetime] - Optional ISO datetime string for the message. Defaults to current time.
     * @returns {HTMLElement | null} The created message element, or null if an error occurred.
     */
    public addMessageToDisplay(sender: string, message: string, isThinking: boolean = false, datetime?: string): HTMLElement | null {
        if (!this.chatMessagesContainer) {
            this.logger.error("Cannot add message, .chat-messages container not found.");
            return null;
        }

        let messageClasses = "message";
        if (sender === this.config.userSender) {
            messageClasses += " user-message";
        } else if (sender === this.config.botSender) {
            messageClasses += " bot-message";
        } else if (sender === this.config.errorSender) {
            messageClasses += " error-message";
        } else if (sender === this.config.systemSender) {
            messageClasses += " system-message";
        }
        if (isThinking) {
            messageClasses += " thinking";
        }

        const effectiveDatetime = datetime || new Date().toISOString();
        const formattedDatetime = this.datetimeHandler(effectiveDatetime); 

        // Ensure message content is treated as text to prevent XSS if it's not explicitly HTML.
        // For this component, we assume `message` can be HTML as it's used for bot thinking bubbles.
        // Proper sanitization should happen before this stage if content is purely user-generated and untrusted.
        let populatedTemplate = this.config.messageTemplate
            .replace("{{messageClasses}}", messageClasses)
            .replace("{{sender}}", sender)
            .replace("{{message}}", message)
            .replace("{{datetime}}", formattedDatetime);
        
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = populatedTemplate.trim();
        const messageElement = tempDiv.firstElementChild as HTMLElement | null;

        if (messageElement) {
            this.chatMessagesContainer.appendChild(messageElement);
            this.scrollChatToBottom();
            return messageElement;
        }
        this.logger.error("ChatDisplayManager: Failed to create message element from template.");
        return null;
    }

    /**
     * Updates the content of an existing bot message element, typically used for streaming responses.
     * Prioritizes updating the `.message-text-content` span within the element.
     * If not found, falls back to updating the first child (if not sender display) or the element itself.
     * @param {HTMLElement} messageElement - The bot message HTML element to update.
     * @param {string} htmlOrText - The new HTML or text content.
     */
    public updateBotMessageContent(messageElement: HTMLElement, htmlOrText: string): void {
        const textContentSpan = messageElement.querySelector('.message-text-content');
        if (textContentSpan) {
            textContentSpan.innerHTML = htmlOrText;
        } else {
            this.logger.warn("ChatDisplayManager: .message-text-content span not found in messageElement. Using fallback logic to update content.");
            // Fallback logic inspired by original ChatWidget behavior:
            let mainContentArea = messageElement.firstElementChild as HTMLElement || messageElement;
            // Skip over sender-name-display if it's the first child
            if(mainContentArea.classList.contains('sender-name-display')){ 
                mainContentArea = mainContentArea.nextElementSibling as HTMLElement || messageElement;
            }
            // If after skipping, we still have a valid element, update it. Otherwise, update the root messageElement.
            if (mainContentArea && mainContentArea !== messageElement) {
                mainContentArea.innerHTML = htmlOrText;
            } else {
                 messageElement.innerHTML = htmlOrText; // Safest fallback if no specific content area is identified
            }
        }
        this.scrollChatToBottom();
    }

    /**
     * Scrolls the chat messages container to the bottom.
     * Uses requestAnimationFrame for smoother rendering.
     */
    public scrollChatToBottom(): void {
        if (this.chatMessagesContainer) {
            requestAnimationFrame(() => {
                if (this.chatMessagesContainer) { // Re-check in case the element was removed between frames
                    this.chatMessagesContainer.scrollTop = this.chatMessagesContainer.scrollHeight;
                }
            });
        }
    }

    /**
     * Removes a specific message element from the display.
     * @param {HTMLElement} messageElement - The HTML element of the message to remove.
     */
    public removeMessageElement(messageElement: HTMLElement): void {
        if (messageElement && messageElement.parentNode) {
            messageElement.parentNode.removeChild(messageElement);
        }
    }

    /**
     * Removes any message element currently marked with the 'thinking' class.
     */
    public removeThinkingMessage(): void { 
        const thinkingMessage = this.widgetElement.querySelector('.message.thinking');
        if (thinkingMessage) {
            thinkingMessage.remove();
        }
    }

    /**
     * Clears all messages from the chat messages container.
     */
    public clearMessages(): void {
        if (this.chatMessagesContainer) {
            this.chatMessagesContainer.innerHTML = '';
        }
    }
} 