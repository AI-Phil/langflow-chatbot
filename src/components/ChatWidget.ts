import { LangflowChatClient, BotResponse, StreamEvent, TokenEventData, EndEventData, AddMessageEventData, StreamEventType, StreamEventDataMap, ChatMessageData } from '../clients/LangflowChatClient'; // Adjusted import path

export class ChatWidget {
    private element: HTMLElement;
    private chatClient: LangflowChatClient;
    private currentSessionId: string | null = null; // Added to store sessionId
    private enableStream: boolean; // For the stream toggle
    private currentBotMessageElement: HTMLElement | null = null; // To update during streaming
    private sessionIdInput: HTMLInputElement | null = null; // Added for the session ID input field
    private flowId: string;

    constructor(containerId: string, chatClient: LangflowChatClient, flowId: string, enableStream: boolean = true) {
        const container = document.getElementById(containerId);
        if (!container) {
            throw new Error(`Container with id #${containerId} not found.`);
        }
        if (!chatClient) {
            throw new Error('LangflowChatClient instance is required.');
        }
        if (!flowId || typeof flowId !== 'string' || flowId.trim() === '') {
            throw new Error('flowId is required and must be a non-empty string.');
        }
        this.element = container;
        this.chatClient = chatClient;
        this.flowId = flowId;
        this.enableStream = enableStream; // Store the stream preference
        this.render(); // Render first to ensure session-id-input exists
        
        // Attempt to find the session ID input field from the document,
        // as it's rendered by chatbot.ejs, not this component's render method.
        this.sessionIdInput = document.getElementById('session-id-input') as HTMLInputElement | null;
        
        if (this.sessionIdInput && this.sessionIdInput.value.trim() !== '') {
            this.currentSessionId = this.sessionIdInput.value.trim();
        }
        // Optionally, you could try to load a sessionId from localStorage here if you want persistence across page loads

        // Load message history if sessionId is available
        if (this.currentSessionId) {
            this.loadAndDisplayHistory(this.currentSessionId);
        }
    }

    private render(): void {
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
        this.setupEventListeners();
    }

    private setupEventListeners(): void {
        const sendButton = this.element.querySelector('.send-button');
        const chatInput = this.element.querySelector<HTMLInputElement>('.chat-input');

        if (sendButton && chatInput) {
            sendButton.addEventListener('click', () => this.handleSendButtonClick(chatInput));
            chatInput.addEventListener('keypress', (event) => {
                if (event.key === 'Enter' && !chatInput.disabled) { // Prevent sending if disabled
                    this.handleSendButtonClick(chatInput);
                }
            });
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

        const useStream = this.enableStream; // Use the class member
        
        // Get session ID from input field if available, otherwise use currentSessionId
        let sessionIdToSend: string | null = this.currentSessionId;
        let sessionIdInputWasEmpty = true;
        if (this.sessionIdInput) {
            const sessionIdFromInput = this.sessionIdInput.value.trim();
            if (sessionIdFromInput !== '') {
                sessionIdToSend = sessionIdFromInput;
                sessionIdInputWasEmpty = false;
                if (this.currentSessionId !== sessionIdFromInput) { // User changed it
                    this.currentSessionId = sessionIdFromInput;
                }
            }
        }

        this.addMessageToDisplay("You", message);
        const currentMessage = message;
        chatInput.value = '';

        chatInput.disabled = true;
        const sendButtonElem = this.element.querySelector<HTMLButtonElement>('.send-button');
        if (sendButtonElem) sendButtonElem.disabled = true;

        this.currentBotMessageElement = null;

        if (useStream) {
            this.currentBotMessageElement = this.addMessageToDisplay("Bot", "", true); // Add 'thinking' class
            let accumulatedResponse = "";
            let thinkingText = "Thinking";
            let dotCount = 0;
            const thinkingInterval = setInterval(() => {
                dotCount = (dotCount + 1) % 4;
                if (this.currentBotMessageElement && accumulatedResponse.length === 0 && this.currentBotMessageElement.classList.contains('thinking')) {
                    this.updateBotMessageContent(this.currentBotMessageElement, `${thinkingText}${'.'.repeat(dotCount)}`);
                }
            }, 500);

            try {
                for await (const event of this.chatClient.streamMessage(currentMessage, this.flowId, sessionIdToSend)) {
                    if (this.currentBotMessageElement && this.currentBotMessageElement.classList.contains('thinking')) {
                        // Clear "Thinking..." text if first token arrives or if stream ends with a reply
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
                            shouldClearThinking = true; // Clear thinking on error too
                        }

                        if (shouldClearThinking) {
                            this.updateBotMessageContent(this.currentBotMessageElement, ""); 
                            this.currentBotMessageElement.classList.remove('thinking');
                        }
                    }

                    switch (event.event) {
                        case 'stream_started': // New event handler
                            const startedData = event.data as StreamEventDataMap['stream_started'];
                            if (startedData.sessionId) {
                                this.currentSessionId = startedData.sessionId;
                                if (this.sessionIdInput) {
                                    this.sessionIdInput.value = this.currentSessionId;
                                }
                            }
                            break;
                        case 'token':
                            const tokenData = event.data as StreamEventDataMap['token'];
                            accumulatedResponse += tokenData.chunk;
                            if (this.currentBotMessageElement) {
                                this.updateBotMessageContent(this.currentBotMessageElement, accumulatedResponse);
                            }
                            break;
                        case 'add_message':
                            // const addMessageData = event.data as StreamEventDataMap['add_message'];
                            // console.log("ChatWidget: Stream event 'add_message':", addMessageData);
                            break;
                        case 'end':
                            const endData = event.data as StreamEventDataMap['end'];
                            // SessionId should ideally be set by 'stream_started' now.
                            // This remains as a fallback or for completeness if needed, 
                            // but primary update should happen on 'stream_started'.
                            const sessionIdFromEndEvent: string | undefined = (endData.flowResponse?.sessionId) || (endData as any).sessionId;

                            if (sessionIdFromEndEvent && !this.currentSessionId) { // Only if not already set by stream_started
                                this.currentSessionId = sessionIdFromEndEvent;
                                if (this.sessionIdInput) { 
                                    this.sessionIdInput.value = this.currentSessionId; 
                                }
                            }

                            if (accumulatedResponse.trim() === "" && endData.flowResponse && endData.flowResponse.reply) {
                                if (this.currentBotMessageElement) {
                                    this.updateBotMessageContent(this.currentBotMessageElement, endData.flowResponse.reply);
                                }
                            } else if (accumulatedResponse.trim() === "") {
                                if (this.currentBotMessageElement) {
                                    this.updateBotMessageContent(this.currentBotMessageElement, "(empty response)");
                                }
                            }
                            // Ensure thinking class is removed if somehow still present
                            if (this.currentBotMessageElement && this.currentBotMessageElement.classList.contains('thinking')) {
                                 this.currentBotMessageElement.classList.remove('thinking');
                            }
                            break;
                        case 'error':
                            const errorData = event.data as StreamEventDataMap['error'];
                            console.error('ChatWidget: Stream error event:', errorData);
                            if (this.currentBotMessageElement) {
                                this.updateBotMessageContent(this.currentBotMessageElement, `Error: ${errorData.message || 'Stream error'}`);
                                this.currentBotMessageElement.classList.add('error-message');
                                this.currentBotMessageElement.classList.remove('bot-message', 'thinking');
                            } else {
                                this.addMessageToDisplay("Error", `Stream Error: ${errorData.message || 'Unknown stream error'}${errorData.detail ? ": " + errorData.detail : ""}`);
                            }
                            break;
                    }
                }
            } catch (error: any) {
                console.error("ChatWidget: Failed to process stream:", error);
                if (this.currentBotMessageElement) {
                    this.updateBotMessageContent(this.currentBotMessageElement, `Error: ${error.message || 'Streaming failed'}`);
                    this.currentBotMessageElement.classList.add('error-message');
                    this.currentBotMessageElement.classList.remove('bot-message', 'thinking');
                } else {
                    this.addMessageToDisplay("Error", `Streaming communication error: ${error.message || 'Unknown error'}`);
                }
            } finally {
                clearInterval(thinkingInterval);
                 if (this.currentBotMessageElement && this.currentBotMessageElement.classList.contains('thinking')) {
                    this.currentBotMessageElement.classList.remove('thinking');
                    // If still empty and not an error, indicate no content
                    const messageSpan = this.currentBotMessageElement.querySelector('span');
                    if(messageSpan && messageSpan.textContent === "" && !this.currentBotMessageElement.classList.contains('error-message')){
                        this.updateBotMessageContent(this.currentBotMessageElement, "(No content streamed)");
                    }
                }
            }
        } else {
            // Non-streaming logic
            const thinkingMsg = this.addMessageToDisplay("Bot", "Thinking...", true);
            try {
                const botResponse: BotResponse = await this.chatClient.sendMessage(currentMessage, this.flowId, sessionIdToSend);
                if(thinkingMsg) this.removeMessageElement(thinkingMsg);

                if (botResponse.sessionId) {
                    this.currentSessionId = botResponse.sessionId;
                    if (this.sessionIdInput) { // Always update the input field if it exists
                        this.sessionIdInput.value = this.currentSessionId;
                    }
                }
                if (botResponse.error) {
                    this.addMessageToDisplay("Error", `${botResponse.error}${botResponse.detail ? ": " + botResponse.detail : ""}`);
                } else if (botResponse.reply) {
                    this.addMessageToDisplay("Bot", botResponse.reply);
                } else {
                    this.addMessageToDisplay("Bot", "Sorry, I couldn't get a valid response.");
                }
            } catch (error: any) {
                if(thinkingMsg) this.removeMessageElement(thinkingMsg);
                console.error("Failed to send non-stream message via ChatClient:", error);
                this.addMessageToDisplay("Error", `Communication error: ${error.message || 'Unknown error'}`);
            }
        }

        chatInput.disabled = false;
        if (sendButtonElem) sendButtonElem.disabled = false;
        chatInput.focus();
    }
    
    private removeThinkingMessage(): void { // Kept for potential direct use, though streaming uses classList
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

    private addMessageToDisplay(sender: string, message: string, isThinking: boolean = false): HTMLElement | null {
        const chatMessages = this.element.querySelector('.chat-messages');
        if (chatMessages) {
            const messageElement = document.createElement('div');
            messageElement.classList.add('message');
            if (sender === "You") {
                messageElement.classList.add('user-message');
            } else if (sender === "Bot") {
                messageElement.classList.add('bot-message');
            } else if (sender === "Error") {
                 messageElement.classList.add('error-message');
            }
            if (isThinking) {
                messageElement.classList.add('thinking');
            }
            const senderStrong = document.createElement('strong');
            senderStrong.textContent = `${sender}: `;
            const messageSpan = document.createElement('span');
            messageSpan.style.whiteSpace = 'pre-wrap';
            messageSpan.textContent = message;

            messageElement.appendChild(senderStrong);
            messageElement.appendChild(messageSpan);
            
            chatMessages.appendChild(messageElement);
            chatMessages.scrollTop = chatMessages.scrollHeight;
            return messageElement;
        }
        return null;
    }

    private updateBotMessageContent(messageElement: HTMLElement, text: string): void {
        const messageSpan = messageElement.querySelector('span');
        if (messageSpan) {
            messageSpan.textContent = text;
        } else {
            messageElement.textContent = text;
        }
        const chatMessages = this.element.querySelector('.chat-messages');
        if (chatMessages) {
            chatMessages.scrollTop = chatMessages.scrollHeight;
        }
    }

    private async loadAndDisplayHistory(sessionId: string): Promise<void> {
        if (!this.chatClient.getMessageHistory) {
            console.warn("ChatWidget: getMessageHistory method not available on chatClient.");
            return;
        }
        try {
            const history = await this.chatClient.getMessageHistory(this.flowId, sessionId /*, this.userId - if/when available */);
            if (history && history.length > 0) {
                const chatMessagesContainer = this.element.querySelector('.chat-messages');
                if (chatMessagesContainer) {
                    // Clear any existing messages like "Thinking..." from initial render or previous state
                    // chatMessagesContainer.innerHTML = ''; // Or more selectively remove placeholder messages
                }
                history.forEach(message => {
                    if (message.text) {
                        let senderType = "Bot"; // Default to Bot
                        if (message.sender === 'user') {
                            senderType = "You";
                        } else if (message.sender === 'bot') {
                            senderType = "Bot";
                        } else if (message.sender_name) { // Fallback to sender_name if sender is ambiguous
                            // This part might need refinement based on actual sender_name values
                            senderType = message.sender_name; 
                        }
                        // Add message to display without the 'thinking' animation
                        this.addMessageToDisplay(senderType, message.text, false);
                    }
                });
                const chatMessages = this.element.querySelector('.chat-messages');
                if (chatMessages) { // Scroll to bottom after loading history
                    chatMessages.scrollTop = chatMessages.scrollHeight;
                }
            } else if (history === null) {
                console.log("ChatWidget: No message history returned or error fetching history.");
            }
        } catch (error) {
            console.error("ChatWidget: Error loading message history:", error);
            // Optionally, display an error message in the chat widget
            // this.addMessageToDisplay("Error", "Could not load message history.");
        }
    }
} 