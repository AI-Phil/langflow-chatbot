import { LangflowChatClient, BotResponse, StreamEvent, TokenEventData, EndEventData, AddMessageEventData, StreamEventType, StreamEventDataMap, ChatMessageData } from '../clients/LangflowChatClient'; // Adjusted import path
// import { PROXY_FLOWS_PATH } from '../config/apiPaths'; // No longer needed for flow resolution
import { format as formatDate, formatDistanceToNow } from 'date-fns';

export interface ChatWidgetConfigOptions {
    userSender?: string;
    botSender?: string;
    errorSender?: string;
    systemSender?: string;
    mainContainerTemplate?: string;
    inputAreaTemplate?: string;
    messageTemplate?: string;
    widgetTitle?: string;
    // Future: Add HTML template strings or functions here
}

// Define default templates
const DEFAULT_MAIN_CONTAINER_TEMPLATE = `
    <div class="chat-widget" style="display: flex; flex-direction: column; height: 100%;">
        <div class="chat-widget-header" style="display: none;">
            <span class="chat-widget-title-text"></span>
        </div>
        <div class="chat-messages">
            <!-- Messages will appear here -->
        </div>
        <div id="chat-input-area-container" style="flex-shrink: 0;"></div> <!-- Renamed for clarity -->
    </div>
`;

const DEFAULT_INPUT_AREA_TEMPLATE = `
    <div class="chat-input-area">
        <input type="text" class="chat-input" placeholder="Type your message..." />
        <button class="send-button">Send</button>
    </div>
`;

const DEFAULT_MESSAGE_TEMPLATE = `
    <div class="{{messageClasses}}">
        <!-- <strong>{{sender}}:</strong> -->
        <span class="message-text-content" style="white-space: pre-wrap;">{{message}}</span>
    </div>
`;

export type DatetimeHandler = (datetime: string, format: string) => string;

export const defaultDatetimeHandler: DatetimeHandler = (datetime, format) => {
    try {
        const dateObj = new Date(datetime);
        if (format === 'relative') {
            return formatDistanceToNow(dateObj, { addSuffix: true });
        } else if (typeof format === 'string' && format.trim() !== '') {
            return formatDate(dateObj, format);
        } else {
            return dateObj.toLocaleString();
        }
    } catch {
        return datetime;
    }
};

// Helper to normalize Langflow timestamps (e.g., '2025-05-19 13:33:46 UTC') to ISO format
function normalizeLangflowTimestamp(ts?: string): string | undefined {
    if (!ts) return undefined;
    // Replace ' ' with 'T' (only the first occurrence), and ' UTC' with 'Z'
    return ts.replace(' ', 'T').replace(' UTC', 'Z');
}

export class ChatWidget {
    private element: HTMLElement;
    private chatClient: LangflowChatClient;
    private currentSessionId: string | null = null;
    private enableStream: boolean;
    private currentBotMessageElement: HTMLElement | null = null;
    // private sessionIdInput: HTMLInputElement | null = null; // Removed, rely on initialSessionId
    private config: Omit<Required<ChatWidgetConfigOptions>, 'widgetTitle'> & { widgetTitle?: string }; // Allow widgetTitle to be optional
    
    private isHistoryLoaded: boolean = false;

    // Store references to event listener handlers to remove them
    private sendButtonClickListener?: () => void;
    private chatInputKeyPressListener?: (event: KeyboardEvent) => void;
    private onSessionIdUpdateCallback?: (sessionId: string) => void; // Callback for session ID changes

    // Add pluggable datetime handler
    private datetimeHandler: DatetimeHandler = defaultDatetimeHandler;

    constructor(
        containerId: string, 
        chatClient: LangflowChatClient, 
        enableStream: boolean = true,
        configOptions: ChatWidgetConfigOptions = {},
        initialSessionId?: string,
        onSessionIdUpdate?: (sessionId: string) => void // Added callback parameter
    ) {
        const container = document.getElementById(containerId);
        if (!container) {
            throw new Error(`Container with id #${containerId} not found.`);
        }
        if (!chatClient) {
            throw new Error('LangflowChatClient instance is required.');
        }

        this.element = container;
        this.chatClient = chatClient;
        this.enableStream = enableStream;
        this.onSessionIdUpdateCallback = onSessionIdUpdate; // Store the callback

        this.config = {
            userSender: configOptions.userSender || "You",
            botSender: configOptions.botSender || "Bot",
            errorSender: configOptions.errorSender || "Error",
            systemSender: configOptions.systemSender || "System",
            mainContainerTemplate: configOptions.mainContainerTemplate || DEFAULT_MAIN_CONTAINER_TEMPLATE,
            inputAreaTemplate: configOptions.inputAreaTemplate || DEFAULT_INPUT_AREA_TEMPLATE,
            messageTemplate: configOptions.messageTemplate || DEFAULT_MESSAGE_TEMPLATE,
            widgetTitle: configOptions.widgetTitle, // Assign directly, it can be undefined
        };
        
        this._validateAndPrepareTemplates();
        this.render(); // Render first
        
        if (initialSessionId) {
            this.updateCurrentSessionId(initialSessionId, false); // Use a unified method, don't call callback yet
            console.log(`ChatWidget: Initialized with session ID: ${this.currentSessionId}`);
            // Load history if session ID is provided
            if (!this.isHistoryLoaded) { // ensure not to reload if already loaded by some other means (though unlikely here)
                this.loadAndDisplayHistory(this.currentSessionId!);
            }
        } else {
            console.log("ChatWidget: Initialized without a session ID.");
        }
    }

    private updateCurrentSessionId(newSessionId: string | null, notify: boolean = true) {
        if (newSessionId && this.currentSessionId !== newSessionId) {
            this.currentSessionId = newSessionId;
            console.log(`ChatWidget: Session ID updated to: ${this.currentSessionId}`);
            if (notify && this.onSessionIdUpdateCallback && this.currentSessionId) {
                this.onSessionIdUpdateCallback(this.currentSessionId);
            }
        } else if (newSessionId === null && this.currentSessionId !== null) {
             this.currentSessionId = null;
             console.log("ChatWidget: Session ID cleared.");
             // Typically, we don't notify for clearing, but depends on desired behavior
        }
    }

    private _validateAndPrepareTemplates(): void {
        if (!this.config.mainContainerTemplate.includes('id="chat-input-area-container"')) {
            console.warn('ChatWidget: Custom mainContainerTemplate is missing id="chat-input-area-container". Input area might not be placed correctly.');
        }

        const tempMessageDiv = document.createElement('div');
        const testRenderedTemplate = this.config.messageTemplate
            .replace("{{messageClasses}}", "message")
            .replace("{{sender}}", "test")
            .replace("{{message}}", "test");
        tempMessageDiv.innerHTML = testRenderedTemplate;
        if (!tempMessageDiv.querySelector('.message-text-content')) {
            console.error('ChatWidget: Custom messageTemplate is missing an element with class "message-text-content". Streaming updates will not work correctly. Reverting to default message template.');
            this.config.messageTemplate = DEFAULT_MESSAGE_TEMPLATE;
        }

        if (!this.config.messageTemplate.includes('{{message}}')) {
            console.warn('ChatWidget: Custom messageTemplate is missing the {{message}} placeholder. This is critical for displaying messages.');
        }
        if (!this.config.messageTemplate.includes('{{messageClasses}}')) {
            console.warn('ChatWidget: Custom messageTemplate is missing the {{messageClasses}} placeholder. This is important for message styling.');
        }
    }

    private render(): void {
        this.element.innerHTML = this.config.mainContainerTemplate;

        if (this.config.widgetTitle) {
            const headerElement = this.element.querySelector<HTMLElement>('.chat-widget-header');
            const titleTextElement = this.element.querySelector<HTMLElement>('.chat-widget-title-text');
            if (headerElement && titleTextElement) {
                titleTextElement.textContent = this.config.widgetTitle;
                headerElement.style.display = 'block';
            } else {
                console.warn("ChatWidget: widgetTitle is set, but '.chat-widget-header' or '.chat-widget-title-text' not found in mainContainerTemplate.");
            }
        }

        const inputAreaContainer = this.element.querySelector('#chat-input-area-container');
        if (inputAreaContainer) {
            inputAreaContainer.innerHTML = this.config.inputAreaTemplate; 
        } else {
            console.warn("ChatWidget: #chat-input-area-container not found in mainContainerTemplate. Input area will be appended to .chat-widget if possible.");
            const chatWidgetDiv = this.element.querySelector('.chat-widget');
            if (chatWidgetDiv) {
                const tempDiv = document.createElement('div');
                tempDiv.innerHTML = this.config.inputAreaTemplate;
                if (tempDiv.firstElementChild) {
                    chatWidgetDiv.appendChild(tempDiv.firstElementChild);
                } else {
                    const defaultInputWrapper = document.createElement('div');
                    defaultInputWrapper.innerHTML = DEFAULT_INPUT_AREA_TEMPLATE;
                    chatWidgetDiv.appendChild(defaultInputWrapper.firstElementChild!);
                }
            } else {
                 console.error("ChatWidget: Critical rendering error. Neither #chat-input-area-container nor .chat-widget found. Reverting to full default.");
                 this.element.innerHTML = DEFAULT_MAIN_CONTAINER_TEMPLATE;
                 const container = this.element.querySelector('#chat-input-area-container');
                 if(container) container.innerHTML = DEFAULT_INPUT_AREA_TEMPLATE;
            }
        }

        const chatMessages = this.element.querySelector('.chat-messages');
        const chatInput = this.element.querySelector<HTMLInputElement>('.chat-input');
        const sendButton = this.element.querySelector<HTMLButtonElement>('.send-button');

        if (!chatMessages || !chatInput || !sendButton) {
            console.error(
                "ChatWidget: Essential elements (.chat-messages, .chat-input, .send-button) not found after rendering custom templates. " +
                "Functionality may be impaired. Reverting to default full template."
            );
            this.element.innerHTML = `
                <div class="chat-widget">
                    <div class="chat-messages">
                        <!-- Messages will appear here -->
                    </div>
                    <div class="chat-input-area">
                        <input type="text" class="chat-input" placeholder="Type your message..." />
                        <button class="send-button">Send</button>
                    </div>
                </div>
            `;
        }
        if (chatInput) chatInput.disabled = false;
        if (sendButton) sendButton.disabled = false;

        this.setupEventListeners();
    }

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

    private handleSendButtonClick(chatInput: HTMLInputElement): void {
        const message = chatInput.value;
        this.processMessage(message, chatInput);
    }

    private async processMessage(message: string, chatInput: HTMLInputElement): Promise<void> {
        if (!message.trim()) {
            return;
        }

        const useStream = this.enableStream;
        let sessionIdToSend: string | undefined = this.currentSessionId || undefined;

        this.addMessageToDisplay(this.config.userSender, message, false, new Date().toLocaleString());
        const currentMessage = message;
        chatInput.value = '';

        chatInput.disabled = true;
        const sendButtonElem = this.element.querySelector<HTMLButtonElement>('.send-button');
        if (sendButtonElem) sendButtonElem.disabled = true;

        this.currentBotMessageElement = null;
        const thinkingBubbleHTML = '<div class="thinking-bubble"><span class="dot"></span><span class="dot"></span><span class="dot"></span></div>';

        if (useStream) {
            this.currentBotMessageElement = this.addMessageToDisplay(this.config.botSender, thinkingBubbleHTML, true, new Date().toLocaleString());
            let accumulatedResponse = "";

            try {
                for await (const event of this.chatClient.streamMessage(currentMessage, sessionIdToSend)) { 
                    if (event.event === 'stream_started') {
                        const startData = event.data as StreamEventDataMap['stream_started'];
                        if (startData.sessionId) {
                            this.updateCurrentSessionId(startData.sessionId);
                        }
                        continue;
                    }

                    if (this.currentBotMessageElement && this.currentBotMessageElement.classList.contains('thinking')) {
                        let shouldClearThinking = false;
                        if (event.event === 'token' && (event.data as StreamEventDataMap['token']).chunk.length > 0) {
                            shouldClearThinking = true;
                        }
                        if (event.event === 'end') {
                             const endData = event.data as StreamEventDataMap['end'];
                             if (endData.flowResponse?.reply || accumulatedResponse.length > 0) {
                                shouldClearThinking = true;
                             }
                        }
                        if (event.event === 'error') {
                            shouldClearThinking = true;
                        }

                        if (shouldClearThinking) {
                            this.updateBotMessageContent(this.currentBotMessageElement, ""); 
                            this.currentBotMessageElement.classList.remove('thinking');
                        }
                    }

                    switch (event.event) {
                        case 'token':
                            const tokenData = event.data as StreamEventDataMap['token'];
                            accumulatedResponse += tokenData.chunk;
                            if (this.currentBotMessageElement) {
                                const textContentSpan = this.currentBotMessageElement.querySelector('.message-text-content');
                                if (textContentSpan) {
                                    textContentSpan.innerHTML += tokenData.chunk;
                                    this.scrollChatToBottom();
                                } else {
                                     this.updateBotMessageContent(this.currentBotMessageElement, accumulatedResponse);
                                }
                            }
                            break;
                        case 'error':
                            const errorData = event.data as StreamEventDataMap['error'];
                            console.error("Streaming Error:", errorData.message, errorData.detail);
                            if (this.currentBotMessageElement && !this.currentBotMessageElement.classList.contains('error-message')) {
                                this.updateBotMessageContent(this.currentBotMessageElement, `Error: ${errorData.message}`);
                                this.currentBotMessageElement.classList.remove('bot-message', 'thinking');
                                this.currentBotMessageElement.classList.add('error-message');
                            } else if (!this.currentBotMessageElement) {
                                this.addMessageToDisplay(this.config.errorSender, `Error: ${errorData.message}${errorData.detail ? " Details: " + JSON.stringify(errorData.detail) : ""}`, false, new Date().toLocaleString());
                            }
                            break;
                        case 'add_message':
                            console.log("ChatWidget: Received 'add_message' event. Data:", event.data);
                            break;
                        case 'end':
                            const endData = event.data as StreamEventDataMap['end'];
                            const sessionIdFromEndEvent: string | undefined = (endData.flowResponse?.sessionId) || (endData as any).sessionId;

                            if (sessionIdFromEndEvent) {
                                this.updateCurrentSessionId(sessionIdFromEndEvent);
                            }

                            if (accumulatedResponse.trim() === "" && endData.flowResponse && endData.flowResponse.reply) {
                                if (this.currentBotMessageElement) {
                                    this.updateBotMessageContent(this.currentBotMessageElement, endData.flowResponse.reply);
                                }
                            } else if (accumulatedResponse.trim() === "") {
                                if (this.currentBotMessageElement) {
                                    if(this.currentBotMessageElement.classList.contains('thinking')) {
                                        this.updateBotMessageContent(this.currentBotMessageElement, "(empty response)");
                                        this.currentBotMessageElement.classList.remove('thinking');
                                    } else if (this.currentBotMessageElement.querySelector('.message-text-content')?.innerHTML.trim() === "") {
                                         this.updateBotMessageContent(this.currentBotMessageElement, "(empty response)");
                                    }
                                }
                            }
                            if (this.currentBotMessageElement && this.currentBotMessageElement.classList.contains('thinking')) {
                                 this.currentBotMessageElement.classList.remove('thinking');
                                 if (this.currentBotMessageElement.querySelector('.message-text-content')?.innerHTML.trim() === "") {
                                     this.updateBotMessageContent(this.currentBotMessageElement, "(empty response)");
                                 }
                            }
                            break;
                        default:
                            console.warn("ChatWidget: Received unknown stream event type: " + (event as StreamEvent<StreamEventType>).event);
                    }
                }
            } catch (error: any) {
                console.error("Failed to process stream message:", error);
                 if (this.currentBotMessageElement && this.currentBotMessageElement.classList.contains('thinking')) {
                    this.updateBotMessageContent(this.currentBotMessageElement, "Error processing stream.");
                    this.currentBotMessageElement.classList.remove('thinking');
                    this.currentBotMessageElement.classList.add('error-message');
                } else {
                    this.addMessageToDisplay(this.config.errorSender, `Stream processing error: ${error.message || 'Unknown error'}`, false, new Date().toLocaleString());
                }
            } finally {
                 if (this.currentBotMessageElement && this.currentBotMessageElement.classList.contains('thinking')) {
                    this.currentBotMessageElement.classList.remove('thinking');
                    const messageSpan = this.currentBotMessageElement.querySelector('.message-text-content');
                    if(messageSpan && messageSpan.innerHTML.trim() === "" && !this.currentBotMessageElement.classList.contains('error-message')){ 
                        this.updateBotMessageContent(this.currentBotMessageElement, "(No content streamed)");
                    } else if (messageSpan && messageSpan.innerHTML.includes('thinking-bubble') && !this.currentBotMessageElement.classList.contains('error-message')) {
                        this.updateBotMessageContent(this.currentBotMessageElement, "(No content streamed)");
                    }
                }
            }
        } else {
            const thinkingMsg = this.addMessageToDisplay(this.config.botSender, thinkingBubbleHTML, true, new Date().toLocaleString());
            try {
                const botResponse: BotResponse = await this.chatClient.sendMessage(currentMessage, sessionIdToSend);
                if(thinkingMsg) this.removeMessageElement(thinkingMsg);

                if (botResponse.sessionId) {
                    this.updateCurrentSessionId(botResponse.sessionId);
                }
                if (botResponse.error) {
                    this.addMessageToDisplay(this.config.errorSender, `${botResponse.error}${botResponse.detail ? ": " + botResponse.detail : ""}`, false, new Date().toLocaleString());
                } else if (botResponse.reply) {
                    this.addMessageToDisplay(this.config.botSender, botResponse.reply, false, new Date().toLocaleString());
                } else {
                    this.addMessageToDisplay(this.config.botSender, "Sorry, I couldn't get a valid response.", false, new Date().toLocaleString());
                }
            } catch (error: any) {
                if(thinkingMsg) this.removeMessageElement(thinkingMsg);
                console.error("Failed to send non-stream message via ChatClient:", error);
                this.addMessageToDisplay(this.config.errorSender, `Communication error: ${error.message || 'Unknown error'}`, false, new Date().toLocaleString());
            }
        }

        chatInput.disabled = false;
        if (sendButtonElem) sendButtonElem.disabled = false;
        chatInput.focus();
    }
    
    private removeThinkingMessage(): void { 
        const thinkingMessage = this.element.querySelector('.message.thinking');
        if (thinkingMessage) {
            thinkingMessage.remove();
        }
    }

    private removeMessageElement(messageElement: HTMLElement): void {
        if (messageElement && messageElement.parentNode) {
            messageElement.parentNode.removeChild(messageElement);
        }
    }

    private addMessageToDisplay(sender: string, message: string, isThinking: boolean = false, datetime?: string): HTMLElement | null {
        const chatMessages = this.element.querySelector('.chat-messages');
        if (chatMessages) {
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

            let datetimeStr = datetime;
            if (!datetimeStr) {
                datetimeStr = new Date().toISOString();
            }
            const formatOption = (this.config as any).datetimeFormat || 'relative';
            const formattedDatetime = this.datetimeHandler(datetimeStr, formatOption);

            let populatedTemplate = this.config.messageTemplate
                .replace("{{messageClasses}}", messageClasses)
                .replace("{{sender}}", sender)
                .replace("{{message}}", message)
                .replace("{{datetime}}", formattedDatetime);
            
            const tempDiv = document.createElement('div');
            tempDiv.innerHTML = populatedTemplate.trim();
            const messageElement = tempDiv.firstElementChild as HTMLElement | null;

            if (messageElement) {
                chatMessages.appendChild(messageElement);
                this.scrollChatToBottom();
                return messageElement;
            }
        }
        return null;
    }

    private updateBotMessageContent(messageElement: HTMLElement, htmlOrText: string): void {
        const textContentSpan = messageElement.querySelector('.message-text-content');
        if (textContentSpan) {
            textContentSpan.innerHTML = htmlOrText;
        } else {
            let mainContentArea = messageElement.firstElementChild as HTMLElement || messageElement;
            if(mainContentArea.classList.contains('sender-name-display')){ 
                mainContentArea = mainContentArea.nextElementSibling as HTMLElement || messageElement;
            }
            if (mainContentArea) {
                mainContentArea.innerHTML = htmlOrText;
            } else {
                 messageElement.innerHTML = htmlOrText;
            }
        }
        this.scrollChatToBottom();
    }

    private scrollChatToBottom(): void {
        const chatMessages = this.element.querySelector('.chat-messages');
        if (chatMessages) {
            requestAnimationFrame(() => {
                chatMessages.scrollTop = chatMessages.scrollHeight;
            });
        }
    }

    private async loadAndDisplayHistory(sessionId: string): Promise<void> {
        if (this.isHistoryLoaded && this.currentSessionId === sessionId) { 
            console.log("ChatWidget: History already loaded for this session, skipping reload.");
            return;
        }
        if (!sessionId) {
            console.log("ChatWidget: No session ID provided, cannot load history.");
            return;
        }

        console.log(`ChatWidget: Loading history for session ID: ${sessionId}`);
        this.isHistoryLoaded = false; // Reset for the new session if different
        const chatMessagesContainer = this.element.querySelector('.chat-messages');
        if (chatMessagesContainer) {
            chatMessagesContainer.innerHTML = ''; // Clear previous messages for new session history
        }

        if (!this.chatClient.getMessageHistory) {
            console.warn("ChatWidget: getMessageHistory method not available on chatClient.");
            return;
        }
        try {
            const history = await this.chatClient.getMessageHistory(sessionId);
            if (history && history.length > 0) {
                history.forEach(message => {
                    if (message.text) {
                        let senderType: string;
                        if (message.sender === 'User') {
                            senderType = this.config.userSender;
                        } else if (message.sender === 'Machine') {
                            senderType = this.config.botSender;
                        } else if (message.sender_name) { 
                            senderType = message.sender_name; 
                        } else {
                            senderType = message.sender || this.config.systemSender; 
                        }
                        const normalizedTimestamp = normalizeLangflowTimestamp(message.timestamp);
                        this.addMessageToDisplay(
                            senderType,
                            message.text,
                            false,
                            normalizedTimestamp
                        );
                    }
                });
                const chatMsgs = this.element.querySelector('.chat-messages');
                if (chatMsgs) { 
                    chatMsgs.scrollTop = chatMsgs.scrollHeight;
                }
                this.isHistoryLoaded = true;
                this.updateCurrentSessionId(sessionId); // Confirm current session after loading its history
            } else if (history && history.length === 0) {
                console.log("ChatWidget: No message history found for this session.");
                this.isHistoryLoaded = true;
                this.updateCurrentSessionId(sessionId);
            } else if (history === null) {
                console.log("ChatWidget: No message history returned (possibly empty or error fetching).");
                this.isHistoryLoaded = true; // Consider it checked
                this.updateCurrentSessionId(sessionId);
            }
        } catch (error) {
            console.error("ChatWidget: Error loading message history:", error);
            this.addMessageToDisplay(this.config.errorSender, "Could not load message history.", false, new Date().toLocaleString());
        }
    }

    public async setSessionIdAndLoadHistory(newSessionId: string | null): Promise<void> {
        if (newSessionId && newSessionId.trim() !== "") {
            if (this.currentSessionId !== newSessionId) {
                console.log(`ChatWidget: External call to set session ID to: ${newSessionId}`);
                this.isHistoryLoaded = false; 
                this.updateCurrentSessionId(newSessionId, false); // Update internally first, don't notify yet
                await this.loadAndDisplayHistory(this.currentSessionId!); // Then load history
                // After history load, if successful, loadAndDisplayHistory will call updateCurrentSessionId again to notify
            } else {
                console.log("ChatWidget: Session ID is already set to", newSessionId, "Not reloading history.");
            }
        } else {
            console.log("ChatWidget: External call to clear session ID.");
            this.updateCurrentSessionId(null);
            this.isHistoryLoaded = false;
            const chatMessagesContainer = this.element.querySelector('.chat-messages');
            if (chatMessagesContainer) {
                chatMessagesContainer.innerHTML = ''; 
            }
        }
    }

    public destroy(): void {
        this.removeEventListeners(); // Remove event listeners
        if (this.element) {
            this.element.innerHTML = ''; // Clear the widget content from the DOM
        }
        this.currentBotMessageElement = null;
        this.isHistoryLoaded = false;
        this.updateCurrentSessionId(null, false); // Clear session ID without notifying
        // Any other cleanup specific to ChatWidget
        console.log("ChatWidget: Instance destroyed.");
    }

    // Allow user to register a custom datetime handler
    public registerDatetimeHandler(handler: DatetimeHandler) {
        if (typeof handler === 'function') {
            this.datetimeHandler = handler;
        }
    }

} 