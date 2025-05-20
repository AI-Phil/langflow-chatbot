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
                this.logger.warn("Received unknown stream event type: " + (event as StreamEvent<StreamEventType>).event);
        }
        return accumulatedResponse;
    }

    /**
     * Handles a 'token' stream event: appends the token to the UI and the accumulated response.
     * @param data The data from the 'token' event.
     * @param accumulatedResponse The current accumulated response string.
     * @returns The updated accumulated response string.
     */
    private handleStreamTokenEvent(data: StreamEventDataMap['token'], accumulatedResponse: string): string {
        accumulatedResponse += data.chunk;
        const botElementForToken = this.ui.getBotMessageElement();
        if (botElementForToken) {
            const textContentSpan = botElementForToken.querySelector('.message-text-content');
            if (textContentSpan) {
                textContentSpan.innerHTML += data.chunk;
                this.ui.scrollChatToBottom();
            } else {
                this.ui.updateMessageContent(botElementForToken, accumulatedResponse);
            }
        }
        return accumulatedResponse;
    }

    /**
     * Handles an 'error' stream event: logs the error and updates the UI to show the error message.
     * @param data The data from the 'error' event.
     */
    private handleStreamErrorEvent(data: StreamEventDataMap['error']): void {
        this.logger.error("Streaming Error:", data.message, data.detail);
        const botElementForError = this.ui.getBotMessageElement();
        if (botElementForError && !botElementForError.classList.contains('error-message')) {
            this.ui.updateMessageContent(botElementForError, `Error: ${data.message}`);
            botElementForError.classList.remove('bot-message', 'thinking');
            botElementForError.classList.add('error-message');
        } else if (!botElementForError) {
            this.ui.addMessage(this.config.errorSender, `Error: ${data.message}${data.detail ? " Details: " + JSON.stringify(data.detail) : ""}`, false, new Date().toISOString());
        }
    }

    /**
     * Handles an 'add_message' stream event (currently logs it).
     * This could be used for auxiliary messages sent during a stream.
     * @param data The data from the 'add_message' event.
     */
    private handleStreamAddMessageEvent(data: StreamEventDataMap['add_message']): void {
        this.logger.debug("Received 'add_message' event during stream. Data:", data);
    }

    /**
     * Handles an 'end' stream event: updates session ID if provided, and finalizes the bot message display,
     * potentially showing "(empty response)" if no content was streamed.
     * @param data The data from the 'end' event.
     * @param accumulatedResponse The total accumulated response string from tokens.
     */
    private handleStreamEndEvent(data: StreamEventDataMap['end'], accumulatedResponse: string): void {
        const sessionIdFromEndEvent: string | undefined = (data.flowResponse?.sessionId) || (data as any).sessionId;

        if (sessionIdFromEndEvent) {
            this.ui.updateSessionId(sessionIdFromEndEvent);
        }
        const botElementForEnd = this.ui.getBotMessageElement();
        if (accumulatedResponse.trim() === "" && data.flowResponse && data.flowResponse.reply) {
            if (botElementForEnd) {
                this.ui.updateMessageContent(botElementForEnd, data.flowResponse.reply);
            }
        } else if (accumulatedResponse.trim() === "") {
            if (botElementForEnd) {
                if(botElementForEnd.classList.contains('thinking')) {
                    this.ui.updateMessageContent(botElementForEnd, "(empty response)");
                    botElementForEnd.classList.remove('thinking');
                } else if (botElementForEnd.querySelector('.message-text-content')?.innerHTML.trim() === "") {
                    this.ui.updateMessageContent(botElementForEnd, "(empty response)");
                }
            }
        }
        if (botElementForEnd && botElementForEnd.classList.contains('thinking')) {
            botElementForEnd.classList.remove('thinking');
            if (botElementForEnd.querySelector('.message-text-content')?.innerHTML.trim() === "") {
                this.ui.updateMessageContent(botElementForEnd, "(empty response)");
            }
        }
    }

    /**
     * Handles the message processing logic when streaming is disabled.
     * Displays a thinking indicator, sends the message, and then updates the UI with the response or error.
     * @param messageText The user's message text.
     * @param sessionIdToSend The session ID to use for the request.
     */
    private async handleNonStreamingResponse(messageText: string, sessionIdToSend?: string): Promise<void> {
        this.displayInitialThinkingIndicator();

        try {
            const botResponse: BotResponse = await this.chatClient.sendMessage(messageText, sessionIdToSend);
            
            const currentBotMsg = this.ui.getBotMessageElement(); 

            if (botResponse.sessionId) {
                this.ui.updateSessionId(botResponse.sessionId);
            }

            if (currentBotMsg && currentBotMsg.classList.contains('thinking')) {
                if (botResponse.error) {
                    this.ui.updateMessageContent(currentBotMsg, `${botResponse.error}${botResponse.detail ? ": " + botResponse.detail : ""}`);
                    currentBotMsg.classList.remove('thinking', 'bot-message');
                    currentBotMsg.classList.add('error-message');
                } else if (botResponse.reply) {
                    this.ui.updateMessageContent(currentBotMsg, botResponse.reply);
                    currentBotMsg.classList.remove('thinking');
                } else {
                    this.ui.updateMessageContent(currentBotMsg, "Sorry, I couldn't get a valid response.");
                    currentBotMsg.classList.remove('thinking');
                }
            } else {
                // If currentBotMsg is null or not a thinking bubble (e.g. cleared by another process, unlikely here),
                // we fall back to adding a new message. This covers the case where the thinking bubble was lost.
                this.logger.warn("handleNonStreamingResponse: Thinking message element was not found or not in expected state. Adding new message.");
                if (botResponse.error) {
                    this.ui.addMessage(this.config.errorSender, `${botResponse.error}${botResponse.detail ? ": " + botResponse.detail : ""}`, false, new Date().toISOString());
                } else if (botResponse.reply) {
                    this.ui.addMessage(this.config.botSender, botResponse.reply, false, new Date().toISOString());
                } else {
                    this.ui.addMessage(this.config.botSender, "Sorry, I couldn't get a valid response.", false, new Date().toISOString());
                }
            }

        } catch (error: any) {
            this.logger.error("Failed to send non-stream message via ChatClient:", error);
            const displayMessage = error.message || "Unknown communication error.";
            if (!this.tryUpdateThinkingToError("Communication Error", displayMessage)) {
                this.ui.addMessage(this.config.errorSender, `Communication Error: ${displayMessage}`, false, new Date().toISOString());
            }
        } finally {
            this.ui.setBotMessageElement(null);
        }
    }
} 