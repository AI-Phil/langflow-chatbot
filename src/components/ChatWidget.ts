import { LangflowChatClient, BotResponse, StreamEvent, TokenEventData, EndEventData, AddMessageEventData, StreamEventType, StreamEventDataMap, ChatMessageData } from '../clients/LangflowChatClient'; // Adjusted import path
import { PROXY_FLOWS_PATH } from '../config/apiPaths';

export interface ChatWidgetConfigOptions {
    userSender?: string;
    botSender?: string;
    errorSender?: string;
    systemSender?: string;
    mainContainerTemplate?: string;
    inputAreaTemplate?: string;
    messageTemplate?: string;
    // Future: Add HTML template strings or functions here
}

// Define default templates
const DEFAULT_MAIN_CONTAINER_TEMPLATE = `
    <div class="chat-widget" style="display: flex; flex-direction: column; height: 100%;">
        <div class="chat-messages" style="flex-grow: 1; overflow-y: auto; padding: 10px;">
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

export class ChatWidget {
    private element: HTMLElement;
    private chatClient: LangflowChatClient;
    private currentSessionId: string | null = null;
    private enableStream: boolean;
    private currentBotMessageElement: HTMLElement | null = null;
    private sessionIdInput: HTMLInputElement | null = null;
    private config: Required<ChatWidgetConfigOptions>;
    
    private flowId: string | null = null; // This will be the resolved UUID
    private flowName: string | null = null;
    private flowEndpointName: string | null = null;

    private isHistoryLoaded: boolean = false;
    private isResolvingFlow: boolean = false;

    constructor(
        containerId: string, 
        chatClient: LangflowChatClient, 
        inputFlowIdOrName: string, 
        enableStream: boolean = true,
        configOptions: ChatWidgetConfigOptions = {}
    ) {
        const container = document.getElementById(containerId);
        if (!container) {
            throw new Error(`Container with id #${containerId} not found.`);
        }
        if (!chatClient) {
            throw new Error('LangflowChatClient instance is required.');
        }
        if (!inputFlowIdOrName || typeof inputFlowIdOrName !== 'string' || inputFlowIdOrName.trim() === '') {
            throw new Error('inputFlowIdOrName is required and must be a non-empty string.');
        }
        this.element = container;
        this.chatClient = chatClient;
        this.enableStream = enableStream;

        this.config = {
            userSender: configOptions.userSender || "You",
            botSender: configOptions.botSender || "Bot",
            errorSender: configOptions.errorSender || "Error",
            systemSender: configOptions.systemSender || "System",
            mainContainerTemplate: configOptions.mainContainerTemplate || DEFAULT_MAIN_CONTAINER_TEMPLATE,
            inputAreaTemplate: configOptions.inputAreaTemplate || DEFAULT_INPUT_AREA_TEMPLATE,
            messageTemplate: configOptions.messageTemplate || DEFAULT_MESSAGE_TEMPLATE,
        };
        
        this._validateAndPrepareTemplates();

        this.render(); // Render first to ensure session-id-input exists
        
        this.sessionIdInput = document.getElementById('session-id-input') as HTMLInputElement | null;
        
        if (this.sessionIdInput && this.sessionIdInput.value.trim() !== '') {
            this.currentSessionId = this.sessionIdInput.value.trim();
        }

        this._resolveFlowAndInitialize(inputFlowIdOrName);
    }

    private _validateAndPrepareTemplates(): void {
        if (!this.config.mainContainerTemplate.includes('id="chat-input-area-container"')) {
            console.warn('ChatWidget: Custom mainContainerTemplate is missing id="chat-input-area-container". Input area might not be placed correctly.');
        }

        // Validate messageTemplate for .message-text-content using DOM parsing
        const tempMessageDiv = document.createElement('div');
        // We inject a dummy message to ensure placeholders don't break the structure too much for querySelector
        const testRenderedTemplate = this.config.messageTemplate
            .replace("{{messageClasses}}", "message")
            .replace("{{sender}}", "test")
            .replace("{{message}}", "test");
        tempMessageDiv.innerHTML = testRenderedTemplate;
        if (!tempMessageDiv.querySelector('.message-text-content')) {
            console.error('ChatWidget: Custom messageTemplate is missing an element with class "message-text-content". Streaming updates will not work correctly. Reverting to default message template.');
            this.config.messageTemplate = DEFAULT_MESSAGE_TEMPLATE;
        }

        // {{sender}} is now optional
        // if (!this.config.messageTemplate.includes('{{sender}}')) {
        //     console.warn('ChatWidget: Custom messageTemplate is missing the {{sender}} placeholder.');
        // }
        if (!this.config.messageTemplate.includes('{{message}}')) {
            console.warn('ChatWidget: Custom messageTemplate is missing the {{message}} placeholder. This is critical for displaying messages.');
        }
        if (!this.config.messageTemplate.includes('{{messageClasses}}')) {
            console.warn('ChatWidget: Custom messageTemplate is missing the {{messageClasses}} placeholder. This is important for message styling.');
        }
    }

    private async _resolveFlowAndInitialize(idOrName: string): Promise<void> {
        if (this.isResolvingFlow) return;
        this.isResolvingFlow = true;
        let flowDetailsResolved = false;

        try {
            const flowsApiUrl = PROXY_FLOWS_PATH; 

            console.log(`ChatWidget: Attempting to resolve flow '${idOrName}' via proxy endpoint: ${flowsApiUrl}`);

            const response = await fetch(flowsApiUrl);
            
            if (!response.ok) {
                let errorDetail = `Status: ${response.status} ${response.statusText}`;
                try {
                    const errorData = await response.json();
                    errorDetail = errorData.detail || errorData.error || JSON.stringify(errorData);
                } catch (e) {
                    // If error response isn't JSON, use text
                    try {
                         errorDetail = await response.text();
                    } catch (textErr) {
                        // Keep original status text if all else fails
                    }
                }
                console.error(`ChatWidget: Error response from proxy ${flowsApiUrl}. Detail: ${errorDetail}`);
                this.addMessageToDisplay(this.config.errorSender, `System Error: Failed to fetch flow list from proxy. ${errorDetail.substring(0,100)}`);
                this.disableChatFunctionality();
                return;
            }
            
            const responseData: {flows?: Array<{ id: string; name: string; endpoint_name?: string }>, detail?: string} | Array<{ id: string; name: string; endpoint_name?: string }> = await response.json();
            
            let flowsList: Array<{ id: string; name: string; endpoint_name?: string }> = [];

            if (Array.isArray(responseData)) {
                flowsList = responseData;
            } else if (responseData && Array.isArray(responseData.flows)) {
                flowsList = responseData.flows;
            } else {
                console.error(`ChatWidget: Unexpected API response structure from ${flowsApiUrl}. Expected an array of flows or an object with a 'flows' array. Got:`, responseData);
                 this.addMessageToDisplay(this.config.errorSender, `System Error: Unexpected response when fetching flow list. Chat may not function.`);
                this.disableChatFunctionality();
                return;
            }
            
            let foundFlow = null;
            for (const flow of flowsList) {
                if (flow.id === idOrName || flow.name === idOrName || (flow.endpoint_name && flow.endpoint_name === idOrName)) {
                    foundFlow = flow;
                    break;
                }
            }

            if (foundFlow) {
                this.flowId = foundFlow.id;
                this.flowName = foundFlow.name;
                this.flowEndpointName = foundFlow.endpoint_name || null;
                console.log(`ChatWidget: Flow resolved. ID (UUID): ${this.flowId}, Name: ${this.flowName}, Endpoint: ${this.flowEndpointName || 'N/A'}`);
                flowDetailsResolved = true;
            } else {
                console.error(`ChatWidget: Flow with ID or name '${idOrName}' not found in list from ${flowsApiUrl}.`);
                this.addMessageToDisplay(this.config.errorSender, `Error: Flow '${idOrName}' not found. Chat is disabled.`);
                this.disableChatFunctionality();
            }
        } catch (error: any) {
            console.error("ChatWidget: Exception during flow resolution:", error);
            this.addMessageToDisplay(this.config.errorSender, `System Error: Could not initialize chat by resolving flow. Details: ${error.message || 'Unknown error'}. See console.`);
            this.disableChatFunctionality();
        } finally {
            this.isResolvingFlow = false;
        }

        if (flowDetailsResolved && this.currentSessionId && !this.isHistoryLoaded) {
            await this.loadAndDisplayHistory(this.currentSessionId);
        } else if (flowDetailsResolved && !this.currentSessionId) {
            console.log("ChatWidget: Flow resolved, no current session ID. Ready for interaction.");
            // Enable input if it was initially disabled
            const chatInput = this.element.querySelector<HTMLInputElement>('.chat-input');
            const sendButton = this.element.querySelector<HTMLButtonElement>('.send-button');
            if (chatInput && chatInput.placeholder.startsWith("Chat disabled")) chatInput.placeholder = "Type your message...";
            if (chatInput) chatInput.disabled = false;
            if (sendButton) sendButton.disabled = false;

        }
    }

    private disableChatFunctionality(): void {
        const chatInput = this.element.querySelector<HTMLInputElement>('.chat-input');
        const sendButton = this.element.querySelector<HTMLButtonElement>('.send-button');
        if (chatInput) {
            chatInput.disabled = true;
            chatInput.placeholder = "Chat disabled: Flow not resolved or error.";
        }
        if (sendButton) {
            sendButton.disabled = true;
        }
    }

    private render(): void {
        // Use the configured main container template
        this.element.innerHTML = this.config.mainContainerTemplate;

        // Find the container and inject the input area template
        const inputAreaContainer = this.element.querySelector('#chat-input-area-container'); // Renamed selector
        if (inputAreaContainer) {
            inputAreaContainer.innerHTML = this.config.inputAreaTemplate; 
        } else {
            console.warn("ChatWidget: #chat-input-area-container not found in mainContainerTemplate. Input area will be appended to .chat-widget if possible.");
            const chatWidgetDiv = this.element.querySelector('.chat-widget');
            if (chatWidgetDiv) {
                // Create a temporary div to parse the inputAreaTemplate
                const tempDiv = document.createElement('div');
                tempDiv.innerHTML = this.config.inputAreaTemplate;
                // Append the first child of tempDiv (which should be the .chat-input-area div)
                if (tempDiv.firstElementChild) {
                    chatWidgetDiv.appendChild(tempDiv.firstElementChild);
                } else {
                     // Fallback if inputAreaTemplate was empty or invalid
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

        // Validate essential elements
        const chatMessages = this.element.querySelector('.chat-messages');
        const chatInput = this.element.querySelector<HTMLInputElement>('.chat-input');
        const sendButton = this.element.querySelector<HTMLButtonElement>('.send-button');

        if (!chatMessages || !chatInput || !sendButton) {
            console.error(
                "ChatWidget: Essential elements (.chat-messages, .chat-input, .send-button) not found after rendering custom templates. " +
                "Functionality may be impaired. Reverting to default full template."
            );
            // Fallback to the original known good structure
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

        if (!this.flowId) { // Check for resolved flowId (UUID)
            if (this.isResolvingFlow) {
                this.addMessageToDisplay(this.config.systemSender, "Chat is initializing, please wait...");
            } else {
                this.addMessageToDisplay(this.config.errorSender, "Chat is not properly initialized. Flow ID could not be resolved. Cannot send message.");
            }
            chatInput.value = message; // Put message back if it couldn't be sent
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

        this.addMessageToDisplay(this.config.userSender, message);
        const currentMessage = message;
        chatInput.value = '';

        chatInput.disabled = true;
        const sendButtonElem = this.element.querySelector<HTMLButtonElement>('.send-button');
        if (sendButtonElem) sendButtonElem.disabled = true;

        this.currentBotMessageElement = null;

        const thinkingBubbleHTML = '<div class="thinking-bubble"><span class="dot"></span><span class="dot"></span><span class="dot"></span></div>';

        if (useStream) {
            this.currentBotMessageElement = this.addMessageToDisplay(this.config.botSender, thinkingBubbleHTML, true); // Add 'thinking' class and bubble
            let accumulatedResponse = "";

            try {
                for await (const event of this.chatClient.streamMessage(currentMessage, this.flowId!, sessionIdToSend)) {
                    if (event.event === 'stream_started') {
                        const startData = event.data as StreamEventDataMap['stream_started'];
                        if (startData.sessionId && !this.currentSessionId) { // Check if currentSessionId is not already set
                            this.currentSessionId = startData.sessionId;
                             if (this.sessionIdInput) { 
                                this.sessionIdInput.value = this.currentSessionId; 
                            }
                        }
                        continue; // Skip to next event
                    }

                    if (this.currentBotMessageElement && this.currentBotMessageElement.classList.contains('thinking')) {
                        // Clear "Thinking..." bubble if first token arrives or if stream ends with a reply
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
                        case 'token':
                            const tokenData = event.data as StreamEventDataMap['token'];
                            accumulatedResponse += tokenData.chunk;
                            if (this.currentBotMessageElement) {
                                // Append new content; ensure it's appended, not replacing existing if already cleared from thinking
                                const textContentSpan = this.currentBotMessageElement.querySelector('.message-text-content');
                                if (textContentSpan) {
                                    textContentSpan.innerHTML += tokenData.chunk; // Use innerHTML for consistency, though textContent might be fine here
                                    this.scrollChatToBottom(); // Scroll after direct token append
                                } else {
                                     this.updateBotMessageContent(this.currentBotMessageElement, accumulatedResponse); // Fallback, will also scroll
                                }
                            }
                            break;
                        case 'error':
                            const errorData = event.data as StreamEventDataMap['error'];
                            console.error("Streaming Error:", errorData.message, errorData.detail);
                            if (this.currentBotMessageElement && !this.currentBotMessageElement.classList.contains('error-message')) {
                                // If current message element is not already an error, transform it or add new
                                this.updateBotMessageContent(this.currentBotMessageElement, `Error: ${errorData.message}`);
                                this.currentBotMessageElement.classList.remove('bot-message', 'thinking'); // Remove bot specific classes
                                this.currentBotMessageElement.classList.add('error-message'); // Add error class for styling
                            } else if (!this.currentBotMessageElement) { // If no current message element, add a new error message
                                this.addMessageToDisplay(this.config.errorSender, `Error: ${errorData.message}${errorData.detail ? " Details: " + JSON.stringify(errorData.detail) : ""}`);
                            }
                            break;
                        case 'add_message':
                            const addMessageData = event.data as StreamEventDataMap['add_message'];
                            // Handle additional messages if needed, perhaps system messages or mid-stream updates
                            if (addMessageData && typeof addMessageData.message === 'string' && addMessageData.message.trim() !== '') {
                                this.addMessageToDisplay(this.config.systemSender, addMessageData.message);
                            } else {
                                console.warn("ChatWidget: Received 'add_message' event with missing, undefined, or empty message content. Event data:", event.data);
                            }
                            break;
                        case 'end':
                            const endData = event.data as StreamEventDataMap['end'];
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
                                    // If it was a thinking bubble and still is, and no content, make it (empty response)
                                    if(this.currentBotMessageElement.classList.contains('thinking')) {
                                        this.updateBotMessageContent(this.currentBotMessageElement, "(empty response)");
                                        this.currentBotMessageElement.classList.remove('thinking');
                                    } else if (this.currentBotMessageElement.querySelector('.message-text-content')?.innerHTML.trim() === "") {
                                        // If it was cleared but no tokens came, also show (empty response)
                                         this.updateBotMessageContent(this.currentBotMessageElement, "(empty response)");
                                    }
                                }
                            }
                            // Ensure thinking class is removed if somehow still present
                            if (this.currentBotMessageElement && this.currentBotMessageElement.classList.contains('thinking')) {
                                 this.currentBotMessageElement.classList.remove('thinking');
                                 // If it was cleared to empty but was thinking, make sure it's not just an empty bubble
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
                    this.addMessageToDisplay(this.config.errorSender, `Stream processing error: ${error.message || 'Unknown error'}`);
                }
            } finally {
                 if (this.currentBotMessageElement && this.currentBotMessageElement.classList.contains('thinking')) {
                    this.currentBotMessageElement.classList.remove('thinking');
                    // If still empty and not an error, indicate no content
                    const messageSpan = this.currentBotMessageElement.querySelector('.message-text-content');
                    if(messageSpan && messageSpan.innerHTML.trim() === "" && !this.currentBotMessageElement.classList.contains('error-message')){ // Check innerHTML
                        this.updateBotMessageContent(this.currentBotMessageElement, "(No content streamed)");
                    } else if (messageSpan && messageSpan.innerHTML.includes('thinking-bubble') && !this.currentBotMessageElement.classList.contains('error-message')) {
                        // If the bubble is still there, replace it.
                        this.updateBotMessageContent(this.currentBotMessageElement, "(No content streamed)");
                    }
                }
            }
        } else {
            // Non-streaming logic
            const thinkingMsg = this.addMessageToDisplay(this.config.botSender, thinkingBubbleHTML, true);
            try {
                const botResponse: BotResponse = await this.chatClient.sendMessage(currentMessage, this.flowId!, sessionIdToSend);
                if(thinkingMsg) this.removeMessageElement(thinkingMsg);

                if (botResponse.sessionId) {
                    this.currentSessionId = botResponse.sessionId;
                    if (this.sessionIdInput) { // Always update the input field if it exists
                        this.sessionIdInput.value = this.currentSessionId;
                    }
                }
                if (botResponse.error) {
                    this.addMessageToDisplay(this.config.errorSender, `${botResponse.error}${botResponse.detail ? ": " + botResponse.detail : ""}`);
                } else if (botResponse.reply) {
                    this.addMessageToDisplay(this.config.botSender, botResponse.reply);
                } else {
                    this.addMessageToDisplay(this.config.botSender, "Sorry, I couldn't get a valid response.");
                }
            } catch (error: any) {
                if(thinkingMsg) this.removeMessageElement(thinkingMsg);
                console.error("Failed to send non-stream message via ChatClient:", error);
                this.addMessageToDisplay(this.config.errorSender, `Communication error: ${error.message || 'Unknown error'}`);
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

            // Populate the template
            let populatedTemplate = this.config.messageTemplate
                .replace("{{messageClasses}}", messageClasses)
                .replace("{{sender}}", sender)
                .replace("{{message}}", message);
            
            // Create element from template string
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
            textContentSpan.innerHTML = htmlOrText; // Use innerHTML to support rich content like the thinking bubble
        } else {
            // Fallback if the specific span isn't found
            let mainContentArea = messageElement.firstElementChild as HTMLElement || messageElement;
            if(mainContentArea.classList.contains('sender-name-display')){ 
                mainContentArea = mainContentArea.nextElementSibling as HTMLElement || messageElement;
            }
            // Ensure we are not trying to set innerHTML on a null or undefined element
            if (mainContentArea) {
                mainContentArea.innerHTML = htmlOrText; // Use innerHTML here too
            } else {
                 messageElement.innerHTML = htmlOrText; // Last resort, replace entire content of messageElement
            }
            // console.warn("ChatWidget: '.message-text-content' span not found in message element. Using fallback for content update. This might indicate an issue with your custom messageTemplate.");
        }
        this.scrollChatToBottom(); // Ensure scroll after update
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
        if (!this.flowId) { // Check for resolved flowId (UUID)
            console.warn("ChatWidget: Cannot load history, flowId not resolved yet.");
            // This method will be called by _resolveFlowAndInitialize once flowId is available.
            return;
        }
        if (this.isHistoryLoaded) { // Prevent re-loading if already loaded
            console.log("ChatWidget: History already loaded, skipping reload.");
            return;
        }
        if (!this.chatClient.getMessageHistory) {
            console.warn("ChatWidget: getMessageHistory method not available on chatClient.");
            return;
        }
        try {
            const history = await this.chatClient.getMessageHistory(this.flowId, sessionId); // Use this.flowId (resolved UUID)
            if (history && history.length > 0) {
                const chatMessagesContainer = this.element.querySelector('.chat-messages');
                if (chatMessagesContainer) {
                    // chatMessagesContainer.innerHTML = ''; // Clear existing messages if needed
                }
                history.forEach(message => {
                    if (message.text) {
                        // console.log("History message item:", message); 
                        let senderType: string;
                        if (message.sender === 'User') {
                            senderType = this.config.userSender;
                        } else if (message.sender === 'Machine') {
                            senderType = this.config.botSender;
                        } else if (message.sender_name) { 
                            // Use sender_name if sender is not User/Machine and sender_name is available
                            senderType = message.sender_name; 
                        } else {
                            // Fallback if sender is not User/Machine and sender_name is not available
                            senderType = message.sender || this.config.systemSender; 
                        }
                        this.addMessageToDisplay(senderType, message.text, false);
                    }
                });
                const chatMessages = this.element.querySelector('.chat-messages');
                if (chatMessages) { 
                    chatMessages.scrollTop = chatMessages.scrollHeight;
                }
                this.isHistoryLoaded = true; // Set flag on successful load and display
            } else if (history && history.length === 0) {
                console.log("ChatWidget: No message history found for this session.");
                this.isHistoryLoaded = true; // Successfully checked, no history.
            } else if (history === null) { // Typically indicates an issue or that the endpoint behaves this way for "no history"
                console.log("ChatWidget: No message history returned (possibly empty or error fetching).");
                // Consider if isHistoryLoaded should be true here. If null means "successfully fetched empty", then yes.
                // If null implies an error that wasn't thrown, then no. For now, let's assume an empty array is the "no history" success case.
            }
        } catch (error) {
            console.error("ChatWidget: Error loading message history:", error);
            this.addMessageToDisplay(this.config.errorSender, "Could not load message history.");
        }
    }
} 