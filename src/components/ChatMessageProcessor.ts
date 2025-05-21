/**
 * ChatMessageProcessor is responsible for the core logic of processing user input,
 * managing the interaction with the LangflowChatClient (for sending messages and handling stream events),
 * and coordinating UI updates through callbacks.
 *
 * Its main responsibilities include:
 * - Receiving raw message text from the user.
 * - Determining whether to use streaming or non-streaming mode based on configuration.
 * - Interacting with `LangflowChatClient` to send the message and receive responses (either full or streamed chunks).
 * - Handling various stream events (`token`, `error`, `end`, `stream_started`, `add_message`) to update the UI progressively.
 * - Managing the display of "thinking" indicators during bot processing.
 * - Updating the session ID based on responses from the Langflow backend.
 * - Relaying UI changes (like adding messages, updating content, disabling/enabling input)
     to the main ChatWidget or other UI controller via the `MessageProcessorUICallbacks`.
 * - Encapsulating the logic for both successful message exchanges and error handling during communication.
 */
import { LangflowChatClient, BotResponse, StreamEvent, StreamEventType, StreamEventDataMap } from '../clients/LangflowChatClient';
import { Logger } from './logger';
import { SenderConfig } from '../types';

export interface MessageProcessorUICallbacks {
    addMessage: (sender: string, message: string, isThinking?: boolean, datetime?: string) => HTMLElement | null;
    updateMessageContent: (element: HTMLElement, htmlOrText: string) => void;
    removeMessage: (element: HTMLElement) => void;
    getBotMessageElement: () => HTMLElement | null;
    setBotMessageElement: (element: HTMLElement | null) => void;
    scrollChatToBottom: () => void;
    updateSessionId: (sessionId: string, notify?: boolean) => void; // notify is important for ChatWidget's logic
    setInputDisabled: (disabled: boolean) => void;
}

export class ChatMessageProcessor {
    private readonly thinkingBubbleHTML = '<div class="thinking-bubble"><span class="dot"></span><span class="dot"></span><span class="dot"></span></div>';

    /**
     * Constructs a ChatMessageProcessor.
     * @param chatClient The client for interacting with the Langflow API.
     * @param config Configuration defining the sender names/roles (e.g., user, bot, error, system).
     * @param logger Logger instance for logging messages.
     * @param ui Callbacks for UI interactions related to message processing.
     * @param getEnableStream Function to dynamically get the current stream enabled status.
     * @param getCurrentSessionId Function to dynamically get the current session ID.
     */
    constructor(
        private chatClient: LangflowChatClient,
        private config: SenderConfig,
        private logger: Logger,
        private ui: MessageProcessorUICallbacks,
        private getEnableStream: () => boolean,
        private getCurrentSessionId: () => string | null
    ) {}

    /**
     * Displays the initial "thinking" indicator in the UI.
     */
    private displayInitialThinkingIndicator(): void {
        const thinkingMsgElement = this.ui.addMessage(this.config.botSender, this.thinkingBubbleHTML, true, new Date().toISOString());
        this.ui.setBotMessageElement(thinkingMsgElement);
    }

    /**
     * Main public method to process a user's message.
     * It disables input, determines streaming vs. non-streaming, calls the appropriate handler,
     * and re-enables input.
     * @param messageText The text of the message from the user.
     */
    public async process(messageText: string): Promise<void> {
        this.logger.info(`ChatMessageProcessor starting to process: "${messageText}"`);

        const useStream = this.getEnableStream();
        let sessionIdToSend: string | undefined = this.getCurrentSessionId() || undefined;

        this.ui.setInputDisabled(true);
        this.ui.setBotMessageElement(null); 

        if (useStream) {
            await this.handleStreamingResponse(messageText, sessionIdToSend);
        } else {
            await this.handleNonStreamingResponse(messageText, sessionIdToSend);
        }

        this.ui.setInputDisabled(false);
        this.logger.info(`ChatMessageProcessor finished processing: "${messageText}"`);
    }

    /**
     * Attempts to update an existing "thinking" message bubble to display an error.
     * @param baseErrorMessage The main error message text.
     * @param detailErrorMessage Optional additional details for the error.
     * @returns True if a thinking bubble was successfully updated to an error, false otherwise.
     */
    private tryUpdateThinkingToError(baseErrorMessage: string, detailErrorMessage?: string): boolean {
        const botElement = this.ui.getBotMessageElement();
        if (botElement && botElement.classList.contains('thinking')) {
            const fullErrorMessage = detailErrorMessage ? `${baseErrorMessage}: ${detailErrorMessage}` : baseErrorMessage;
            this.ui.updateMessageContent(botElement, fullErrorMessage);
            botElement.classList.remove('thinking', 'bot-message');
            botElement.classList.add('error-message');
            return true;
        }
        return false;
    }

    /**
     * Handles the message processing logic when streaming is enabled.
     * Iterates through stream events, updates UI progressively, and handles errors/completion.
     * @param messageText The user's message text.
     * @param sessionIdToSend The session ID to use for the request.
     */
    private async handleStreamingResponse(messageText: string, sessionIdToSend?: string): Promise<void> {
        this.displayInitialThinkingIndicator();

        let accumulatedResponse = "";

        try {
            for await (const event of this.chatClient.streamMessage(messageText, sessionIdToSend)) {
                const currentBotElement = this.ui.getBotMessageElement();

                if (event.event === 'stream_started') {
                    const startData = event.data as StreamEventDataMap['stream_started'];
                    if (startData.sessionId) {
                        this.ui.updateSessionId(startData.sessionId);
                    }
                    continue;
                }

                this.clearThinkingIndicatorIfNeeded(event, currentBotElement, accumulatedResponse);
                accumulatedResponse = this.processStreamEvent(event, accumulatedResponse);
            }
        } catch (error: any) {
            this.logger.error("Failed to process stream message:", error);
            const displayMessage = error.message || "Error processing stream.";
            if (!this.tryUpdateThinkingToError("Stream Error", displayMessage)) {
                this.ui.addMessage(this.config.errorSender, `Stream Error: ${displayMessage}`, false, new Date().toISOString());
            }
        } finally {
            const botElementForFinally = this.ui.getBotMessageElement();
            if (botElementForFinally && botElementForFinally.classList.contains('thinking')) {
                botElementForFinally.classList.remove('thinking');
                const messageSpan = botElementForFinally.querySelector('.message-text-content');
                if(messageSpan && messageSpan.innerHTML.trim() === "" && !botElementForFinally.classList.contains('error-message')){
                    this.ui.updateMessageContent(botElementForFinally, "(No content streamed)");
                } else if (messageSpan && messageSpan.innerHTML.includes('thinking-bubble') && !botElementForFinally.classList.contains('error-message')) {
                    this.ui.updateMessageContent(botElementForFinally, "(No content streamed)");
                }
            }
            this.ui.setBotMessageElement(null);
        }
    }

    /**
     * Clears the "thinking" indicator from a message element if conditions are met
     * (e.g., content starts streaming, or an error/end event occurs).
     * @param event The current stream event.
     * @param currentBotElement The current bot message HTML element.
     * @param accumulatedResponse The accumulated response text so far.
     */
    private clearThinkingIndicatorIfNeeded(event: StreamEvent, currentBotElement: HTMLElement | null, accumulatedResponse: string): void {
        if (currentBotElement && currentBotElement.classList.contains('thinking')) {
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
                this.ui.updateMessageContent(currentBotElement, "");
                currentBotElement.classList.remove('thinking');
            }
        }
    }

    /**
     * Processes an individual stream event by dispatching to event-specific handlers.
     * @param event The stream event to process.
     * @param accumulatedResponse The accumulated response string before this event.
     * @returns The updated accumulated response string.
     */
    private processStreamEvent(event: StreamEvent, accumulatedResponse: string): string {
        switch (event.event) {
            case 'token':
                accumulatedResponse = this.handleStreamTokenEvent(event.data as StreamEventDataMap['token'], accumulatedResponse);
                break;
            case 'error':
                this.handleStreamErrorEvent(event.data as StreamEventDataMap['error']);
                break;
            case 'add_message':
                this.handleStreamAddMessageEvent(event.data as StreamEventDataMap['add_message']);
                break;
            case 'end':
                this.handleStreamEndEvent(event.data as StreamEventDataMap['end'], accumulatedResponse);
                break;
            default:
                this.logger.warn(`Received unknown stream event type: ${(event as StreamEvent<StreamEventType>).event}`);
        }
        return accumulatedResponse;
    }

    /**
     * Handles a 'token' event from the stream.
     * Appends the token to the accumulated response and updates the UI.
     * @param data The data associated with the token event.
     * @param accumulatedResponse The response accumulated so far.
     * @returns The new accumulated response.
     */
    private handleStreamTokenEvent(data: StreamEventDataMap['token'], accumulatedResponse: string): string {
        const botMessageElement = this.ui.getBotMessageElement();
        if (botMessageElement) {
            const textSpan = botMessageElement.querySelector<HTMLElement>('.message-text-content');
            if (textSpan) {
                textSpan.innerHTML += data.chunk; // Append new chunk to existing content
                this.ui.scrollChatToBottom();
            } else {
                // This case should ideally not happen if the message template is correct and thinking indicator was cleared properly
                this.logger.warn("Stream token: message-text-content span not found in bot message element. Cannot append token.");
            }
        }
        return accumulatedResponse + data.chunk;
    }
    

    /**
     * Handles an 'error' event from the stream.
     * Updates the UI to display the error.
     * @param data The data associated with the error event.
     */
    private handleStreamErrorEvent(data: StreamEventDataMap['error']): void {
        const currentBotElement = this.ui.getBotMessageElement();
        if (currentBotElement) {
            const displayMessage = data.detail ? `${data.message}: ${data.detail}` : data.message;
            this.ui.updateMessageContent(currentBotElement, displayMessage);
            currentBotElement.classList.remove('thinking', 'bot-message');
            currentBotElement.classList.add('error-message');
        } else {
            // If no current bot element, add a new error message
            this.ui.addMessage(this.config.errorSender, `Stream Error: ${data.message}${data.detail ? " Details: " + JSON.stringify(data.detail) : ""}`, false, new Date().toISOString());
        }
    }

    /**
     * Handles an 'add_message' event from the stream (e.g. for auxiliary messages).
     * Currently, it only logs the event.
     * @param data The data associated with the add_message event.
     */
    private handleStreamAddMessageEvent(data: StreamEventDataMap['add_message']): void {
        this.logger.debug("Received 'add_message' event during stream. Data:", data);
        // Depending on requirements, one might want to use this.ui.addMessage here
        // to display these auxiliary messages in the chat.
        // For now, it's just logged.
    }

    /**
     * Handles an 'end' event from the stream.
     * Finalizes the message content in the UI and updates the session ID.
     * @param data The data associated with the end event.
     * @param accumulatedResponse The total response accumulated from tokens.
     */
    private handleStreamEndEvent(data: StreamEventDataMap['end'], accumulatedResponse: string): void {
        const currentBotElement = this.ui.getBotMessageElement();

        if (currentBotElement) {
            if (data.flowResponse?.reply) {
                this.ui.updateMessageContent(currentBotElement, data.flowResponse.reply);
            } else if (accumulatedResponse) {
                // If no explicit reply in 'end' event, but we accumulated tokens, ensure that's the final content.
                this.ui.updateMessageContent(currentBotElement, accumulatedResponse);
            } else {
                // No reply in end event, and no accumulated tokens from 'token' events
                this.ui.updateMessageContent(currentBotElement, "(empty response)");
            }
            currentBotElement.classList.remove('thinking'); // Ensure thinking class is removed
        }

        if (data.flowResponse?.sessionId) {
            this.ui.updateSessionId(data.flowResponse.sessionId);
        }
    }


    /**
     * Handles the message processing logic when streaming is disabled.
     * Sends the message, waits for a full response, and updates the UI.
     * @param messageText The user's message text.
     * @param sessionIdToSend The session ID to use for the request.
     */
    private async handleNonStreamingResponse(messageText: string, sessionIdToSend?: string): Promise<void> {
        this.displayInitialThinkingIndicator();

        try {
            const result: BotResponse = await this.chatClient.sendMessage(messageText, sessionIdToSend);
            const botElement = this.ui.getBotMessageElement();

            if (botElement && botElement.classList.contains('thinking')) {
                if (result.reply) {
                    this.ui.updateMessageContent(botElement, result.reply);
                } else if (result.error) {
                    const errorMessage = result.detail ? `${result.error}: ${result.detail}` : result.error;
                    this.ui.updateMessageContent(botElement, errorMessage);
                    botElement.classList.remove('bot-message'); // It's an error, not a regular bot message
                    botElement.classList.add('error-message');
                } else {
                    this.logger.warn("handleNonStreamingResponse: No reply content or error from bot.");
                    this.ui.updateMessageContent(botElement, "Sorry, I couldn't get a valid response.");
                }
                botElement.classList.remove('thinking');
            } else {
                // Fallback if the thinking bubble was somehow lost or not set correctly
                this.logger.warn("handleNonStreamingResponse: Thinking message element was not found or not in expected state. Adding new message.");
                this.ui.addMessage(this.config.botSender, result.reply || "Sorry, I couldn't get a valid response.", false, new Date().toISOString());
            }

            if (result.sessionId) {
                this.ui.updateSessionId(result.sessionId);
            }

        } catch (error: any) {
            this.logger.error("Failed to send message via ChatClient:", error);
            const exceptionMessage = error.message || "Failed to send message.";
            if (!this.tryUpdateThinkingToError("Error sending message", exceptionMessage)) {
                this.ui.addMessage(this.config.errorSender, `Error: ${exceptionMessage}`, false, new Date().toISOString());
            }
        } finally {
            this.ui.setBotMessageElement(null);
        }
    }
} 