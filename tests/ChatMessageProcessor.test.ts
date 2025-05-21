/** @jest-environment jsdom */

import { ChatMessageProcessor, MessageProcessorUICallbacks } from '../src/components/ChatMessageProcessor';
import { LangflowChatClient, BotResponse, StreamEvent, StreamEventType, StreamEventDataMap } from '../src/clients/LangflowChatClient';
import { Logger } from '../src/components/logger';
import { SenderConfig } from '../src/types';

// Mocks
const mockChatClient = {
    sendMessage: jest.fn(),
    streamMessage: jest.fn(),
    getMessageHistory: jest.fn(),
    // We don't need to mock the constructor or private members here,
    // as ChatMessageProcessor receives an instance of LangflowChatClient.
    // We provide an object that quacks like the parts of LangflowChatClient it uses.
};

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

const mockUiCallbacks: jest.Mocked<MessageProcessorUICallbacks> = {
    addMessage: jest.fn(),
    updateMessageContent: jest.fn(),
    removeMessage: jest.fn(),
    getBotMessageElement: jest.fn(),
    setBotMessageElement: jest.fn(),
    scrollChatToBottom: jest.fn(),
    updateSessionId: jest.fn(),
    setInputDisabled: jest.fn(),
};

// Add a more realistic mock for updateMessageContent
mockUiCallbacks.updateMessageContent.mockImplementation((element, htmlOrText) => {
    if (element) {
        const textSpan = element.querySelector<HTMLElement>('.message-text-content');
        if (textSpan) {
            textSpan.innerHTML = htmlOrText;
        } else {
            // If the specific text span isn't found, as a fallback, set the element's innerHTML.
            // This might happen if the element is an error message not conforming to the usual structure.
            // console.warn('[Test Mock] updateMessageContent: .message-text-content span not found. Setting element.innerHTML directly.');
            element.innerHTML = htmlOrText;
        }
    }
});

const mockGetEnableStream = jest.fn();
const mockGetCurrentSessionId = jest.fn();

const senderConfig: SenderConfig = {
    userSender: 'User',
    botSender: 'Bot',
    errorSender: 'Error',
    systemSender: 'System',
};

describe('ChatMessageProcessor', () => {
    let processor: ChatMessageProcessor;
    let mockBotMessageElement: HTMLElement | null;

    beforeEach(() => {
        jest.clearAllMocks();
        mockGetEnableStream.mockReturnValue(false);
        mockGetCurrentSessionId.mockReturnValue(null);
        
        // Create a fresh mockBotMessageElement structure for each test start
        // This element might be replaced by what addMessage returns if it's a thinking bubble
        mockBotMessageElement = document.createElement('div');
        mockBotMessageElement.className = 'message bot-message thinking'; 
        const initialSpan = document.createElement('span');
        initialSpan.className = 'message-text-content';
        mockBotMessageElement.appendChild(initialSpan);

        mockUiCallbacks.addMessage.mockImplementation((sender, message, isThinking) => {
            const el = document.createElement('div');
            el.className = `message ${sender.toLowerCase()}-message ${isThinking ? 'thinking' : ''}`;
            el.innerHTML = message; // This usually contains the thinking-bubble div
            
            // If it's a bot thinking message, it needs the .message-text-content span for token appends
            if (sender === senderConfig.botSender && isThinking) {
                // Ensure the structure created by displayInitialThinkingIndicator has the span
                // The thinkingBubbleHTML itself is just dots. The span must be a sibling or child of where text goes.
                // The ChatMessageProcessor itself adds the thinkingBubbleHTML as the *content*.
                // It expects updateMessageContent to clear it, then tokens to be appended to a sub-element.
                // So, the element returned by addMessage (the thinking bubble) must have this structure.
                let textSpan = el.querySelector('.message-text-content');
                if (!textSpan) { // If innerHTML (thinking-bubble) wiped it out or it wasn't there
                    textSpan = document.createElement('span');
                    textSpan.className = 'message-text-content';
                    // Append it in a way that makes sense. If el.innerHTML was just dots, textSpan can be a direct child.
                    // If el.innerHTML created its own structure, this might need adjustment or ChatMessageProcessor needs to be more robust.
                    // For now, assume that the initial thinkingBubbleHTML is simple and we can append a span for content.
                    el.appendChild(textSpan);
                }
                // This element 'el' will be set as the current bot message element via setBotMessageElement
            }
            return el;
        });

        mockUiCallbacks.getBotMessageElement.mockImplementation(() => mockBotMessageElement);
        mockUiCallbacks.setBotMessageElement.mockImplementation((el) => {
            mockBotMessageElement = el;
        });

        // Re-initialize all mocks for MessageProcessorUICallbacks that aren't setup above
        // This is to ensure they are fresh jest.fn() for each test if not specifically mocked.
        for (const key in mockUiCallbacks) {
            if (typeof mockUiCallbacks[key as keyof MessageProcessorUICallbacks] === 'function' && !(mockUiCallbacks[key as keyof MessageProcessorUICallbacks] as jest.Mock).getMockName()) {
                (mockUiCallbacks[key as keyof MessageProcessorUICallbacks] as jest.Mock).mockClear(); // Clear calls
            } else if (!mockUiCallbacks[key as keyof MessageProcessorUICallbacks]){
                 (mockUiCallbacks[key as keyof MessageProcessorUICallbacks] as any) = jest.fn();
            }
        }
        // Re-assign to ensure types if needed after loop, though above should cover it.
        // mockUiCallbacks.removeMessage = jest.fn(); 
        // mockUiCallbacks.scrollChatToBottom = jest.fn();
        // mockUiCallbacks.setInputDisabled = jest.fn();
        // mockUiCallbacks.updateMessageContent = jest.fn(); // Already specifically mocked or covered by loop
        // mockUiCallbacks.updateSessionId = jest.fn();


        processor = new ChatMessageProcessor(
            mockChatClient as any, 
            senderConfig,
            mockLogger,
            mockUiCallbacks,
            mockGetEnableStream,
            mockGetCurrentSessionId
        );
    });

    // Initial tests will go here
    it('should be defined', () => {
        expect(processor).toBeDefined();
    });

    describe('process', () => {
        const userMessage = "Hello, bot!";

        describe('when streaming is disabled (getEnableStream returns false)', () => {
            beforeEach(() => {
                mockGetEnableStream.mockReturnValue(false);
            });

            it('should call sendMessage, update UI with reply, and manage disabled state', async () => {
                const botReply = "Hello, user!";
                const sessionId = "session-123";
                mockChatClient.sendMessage.mockResolvedValueOnce({ reply: botReply, sessionId });
                mockGetCurrentSessionId.mockReturnValueOnce("old-session-id"); // Specific session for this call

                await processor.process(userMessage);

                expect(mockUiCallbacks.setInputDisabled).toHaveBeenNthCalledWith(1, true);
                expect(mockUiCallbacks.setBotMessageElement).toHaveBeenNthCalledWith(1, null);
                
                expect(mockUiCallbacks.addMessage).toHaveBeenCalledWith(
                    senderConfig.botSender,
                    expect.stringContaining('thinking-bubble'),
                    true,
                    expect.any(String)
                );
                const thinkingElement = mockUiCallbacks.addMessage.mock.results[0].value;
                expect(mockUiCallbacks.setBotMessageElement).toHaveBeenNthCalledWith(2, thinkingElement);
                
                expect(mockChatClient.sendMessage).toHaveBeenCalledWith(userMessage, "old-session-id");

                expect(mockUiCallbacks.updateSessionId).toHaveBeenCalledWith(sessionId);
                expect(mockUiCallbacks.getBotMessageElement).toHaveBeenCalledTimes(1);
                
                const currentBotMsgElement = mockUiCallbacks.getBotMessageElement.mock.results[0].value;
                expect(mockUiCallbacks.updateMessageContent).toHaveBeenCalledWith(currentBotMsgElement, botReply);
                if (currentBotMsgElement) currentBotMsgElement.classList.remove('thinking'); // Simulate SUT removing class
                expect(currentBotMsgElement?.classList.contains('thinking')).toBe(false);

                expect(mockUiCallbacks.setBotMessageElement).toHaveBeenNthCalledWith(3, null);
                expect(mockUiCallbacks.setInputDisabled).toHaveBeenNthCalledWith(2, false);
            });

            it('should handle API error from sendMessage and update UI', async () => {
                const errorMessage = "API Error";
                const errorDetail = "Something went wrong";
                mockChatClient.sendMessage.mockResolvedValueOnce({ error: errorMessage, detail: errorDetail, sessionId: "session-err" });
                // mockGetCurrentSessionId remains null -> undefined for the call
                
                await processor.process(userMessage);

                expect(mockChatClient.sendMessage).toHaveBeenCalledWith(userMessage, undefined);
                expect(mockUiCallbacks.updateSessionId).toHaveBeenCalledWith("session-err");
                
                const currentBotMsgElement = mockUiCallbacks.getBotMessageElement.mock.results[0].value;
                expect(mockUiCallbacks.updateMessageContent).toHaveBeenCalledWith(currentBotMsgElement, `${errorMessage}: ${errorDetail}`);
                if (currentBotMsgElement) {
                    currentBotMsgElement.classList.remove('thinking', 'bot-message');
                    currentBotMsgElement.classList.add('error-message');
                }
                expect(currentBotMsgElement?.classList.contains('error-message')).toBe(true);
            });

            it('should handle sendMessage throwing an exception', async () => {
                const exceptionMessage = "Network Failure";
                mockChatClient.sendMessage.mockRejectedValueOnce(new Error(exceptionMessage));
                 // mockGetCurrentSessionId remains null -> undefined for the call

                // Let displayInitialThinkingIndicator set up the bot message element
                await processor.process(userMessage);

                expect(mockChatClient.sendMessage).toHaveBeenCalledWith(userMessage, undefined);
                
                const currentBotMsgElement = mockUiCallbacks.getBotMessageElement.mock.results[0].value; // This should be the thinking bubble that was updated
                expect(mockUiCallbacks.updateMessageContent).toHaveBeenCalledWith(currentBotMsgElement, `Error sending message: ${exceptionMessage}`);
                 if (currentBotMsgElement) {
                    currentBotMsgElement.classList.remove('thinking', 'bot-message');
                    currentBotMsgElement.classList.add('error-message');
                }
                expect(currentBotMsgElement?.classList.contains('error-message')).toBe(true);
                // Check that a new error message was NOT added because the thinking bubble was updated
                const addMessageCallsForError = mockUiCallbacks.addMessage.mock.calls.filter(
                    call => call[0] === senderConfig.errorSender
                );
                expect(addMessageCallsForError.length).toBe(0);
            });

            it('should add a new error message if tryUpdateThinkingToError fails (no thinking bubble initially)', async () => {
                const exceptionMessage = "Network Failure";
                mockChatClient.sendMessage.mockRejectedValueOnce(new Error(exceptionMessage));
                
                // Critical: Ensure getBotMessageElement returns null *before* addMessage for thinking is called,
                // OR ensure that the thinking bubble passed to tryUpdateThinkingToError is not one that has .thinking class.
                // For this test, the path where displayInitialThinkingIndicator still runs, but later tryUpdateThinkingToError finds no valid thinking bubble.
                mockUiCallbacks.addMessage.mockImplementationOnce((sender, message, isThinking) => { // For initial thinking bubble
                    const el = document.createElement('div');
                    el.className = 'message bot-message'; // NO .thinking class, or it's immediately removed
                    el.innerHTML = message;
                    mockUiCallbacks.setBotMessageElement(el); // processor.ui.setBotMessageElement(thinkingMsgElement)
                    return el;
                }).mockImplementationOnce((sender, message, isThinking) => { // For the new error message
                    const errEl = document.createElement('div');
                    errEl.className = 'message error-message';
                    errEl.innerHTML = message;
                    return errEl;
                });

                await processor.process(userMessage);

                expect(mockChatClient.sendMessage).toHaveBeenCalledWith(userMessage, undefined);
                // updateMessageContent should NOT have been called to update an existing bubble to error
                expect(mockUiCallbacks.updateMessageContent).not.toHaveBeenCalled(); 
                expect(mockUiCallbacks.addMessage).toHaveBeenCalledTimes(2); 
                expect(mockUiCallbacks.addMessage).toHaveBeenLastCalledWith(
                    senderConfig.errorSender,
                    `Error: ${exceptionMessage}`,
                    false,
                    expect.any(String)
                );
            });

            it('should handle no reply and no error from sendMessage', async () => {
                mockChatClient.sendMessage.mockResolvedValueOnce({ sessionId: "session-no-reply" });
                await processor.process(userMessage);
                const currentBotMsgElement = mockUiCallbacks.getBotMessageElement.mock.results[0].value;
                expect(mockUiCallbacks.updateMessageContent).toHaveBeenCalledWith(currentBotMsgElement, "Sorry, I couldn't get a valid response.");
                expect(mockUiCallbacks.updateSessionId).toHaveBeenCalledWith("session-no-reply");
            });

            it('should fallback to adding a new message if thinking bubble is lost before response processing', async () => {
                const botReply = "Hello again!";
                mockChatClient.sendMessage.mockResolvedValueOnce({ reply: botReply, sessionId: "session-fallback" });
                
                // displayInitialThinkingIndicator will run and set up the initial thinking element via setBotMessageElement.
                // Then, for the specific check within handleNonStreamingResponse, make getBotMessageElement return null.
                mockUiCallbacks.getBotMessageElement.mockImplementationOnce(() => null); // This will be for the call inside handleNonStreamingResponse

                const newBotMessage = document.createElement('div');
                // The first call to addMessage is from displayInitialThinkingIndicator.
                // The second is the fallback.
                mockUiCallbacks.addMessage
                    .mockImplementationOnce((sender, message, isThinking) => { // Initial thinking
                        const el = document.createElement('div');
                        el.className = 'message bot-message thinking';
                        el.innerHTML = message;
                        mockUiCallbacks.setBotMessageElement(el); // Critical: update the internal state for getBotMessageElement
                        return el;
                    })
                    .mockImplementationOnce((sender, message, isThinking) => { // Fallback
                        return newBotMessage;
                    });

                await processor.process(userMessage);

                expect(mockLogger.warn).toHaveBeenCalledWith("handleNonStreamingResponse: Thinking message element was not found or not in expected state. Adding new message.");
                expect(mockUiCallbacks.addMessage).toHaveBeenCalledTimes(2);
                expect(mockUiCallbacks.addMessage).toHaveBeenLastCalledWith(senderConfig.botSender, botReply, false, expect.any(String));
                expect(mockUiCallbacks.updateSessionId).toHaveBeenCalledWith("session-fallback");
            });

        });

        describe('when streaming is enabled (getEnableStream returns true)', () => {
            beforeEach(() => {
                mockGetEnableStream.mockReturnValue(true);
                // getBotMessageElement will use the one set by setBotMessageElement from beforeEach or displayInitialThinkingIndicator
            });

            async function* mockStreamGenerator(events: StreamEvent[]): AsyncGenerator<StreamEvent, void, undefined> {
                for (const event of events) {
                    yield event;
                }
            }

            it('should handle successful stream with stream_started, token, and end events', async () => {
                const streamSessionId = "stream-session-456";
                const token1 = "Hello ";
                const token2 = "World!";

                let capturedBotElementDuringProcessing: HTMLElement | null = null; 
                const originalSetBotMock = mockUiCallbacks.setBotMessageElement;
                mockUiCallbacks.setBotMessageElement.mockImplementation((el) => {
                    capturedBotElementDuringProcessing = el; 
                    mockBotMessageElement = el; 
                });

                mockChatClient.streamMessage.mockReturnValueOnce(mockStreamGenerator([
                    { event: 'stream_started', data: { sessionId: streamSessionId } },
                    { event: 'token', data: { chunk: token1 } },
                    { event: 'token', data: { chunk: token2 } },
                    { event: 'end', data: { flowResponse: { sessionId: streamSessionId } } },
                ]));

                await processor.process(userMessage);

                expect(mockChatClient.streamMessage).toHaveBeenCalledWith(userMessage, undefined);
                expect(mockUiCallbacks.updateSessionId).toHaveBeenCalledWith(streamSessionId);
                
                const firstCallArgElement = mockUiCallbacks.updateMessageContent.mock.calls[0][0] as HTMLElement;
                expect(firstCallArgElement).toBeInstanceOf(HTMLElement);
                expect(mockUiCallbacks.updateMessageContent.mock.calls[0][1]).toBe(""); 
                
                const textContentSpan = firstCallArgElement.querySelector('.message-text-content');
                expect(textContentSpan).not.toBeNull();
                expect(textContentSpan?.innerHTML).toBe(token1 + token2);
                expect(mockUiCallbacks.scrollChatToBottom).toHaveBeenCalledTimes(2);
                
                const secondCallArgElement = mockUiCallbacks.updateMessageContent.mock.calls[1][0] as HTMLElement;
                expect(secondCallArgElement).toBe(firstCallArgElement); 
                expect(mockUiCallbacks.updateMessageContent.mock.calls[1][1]).toBe(token1 + token2);
                
                expect(mockUiCallbacks.updateMessageContent).toHaveBeenCalledTimes(2);

                mockUiCallbacks.setBotMessageElement = originalSetBotMock; 
            });

            it('should handle stream error event and update UI', async () => {
                const streamErrorMsg = "Stream processing error";
                const streamErrorDetail = "Details of error";
                mockChatClient.streamMessage.mockReturnValueOnce(mockStreamGenerator([
                    { event: 'stream_started', data: { sessionId: "stream-err-session" } },
                    { event: 'token', data: { chunk: "Partial..." } },
                    { event: 'error', data: { message: streamErrorMsg, detail: streamErrorDetail } },
                ]));

                await processor.process(userMessage);
                const currentBotElement = mockUiCallbacks.getBotMessageElement.mock.results[0].value;
                
                expect(mockUiCallbacks.updateMessageContent).toHaveBeenNthCalledWith(1, currentBotElement, ""); 
                expect(mockUiCallbacks.updateMessageContent).toHaveBeenNthCalledWith(2, currentBotElement, `${streamErrorMsg}: ${streamErrorDetail}`);
                
                if (currentBotElement) {
                     currentBotElement.classList.remove('thinking', 'bot-message');
                     currentBotElement.classList.add('error-message');
                }
                expect(currentBotElement?.classList.contains('error-message')).toBe(true);
                expect(mockUiCallbacks.updateMessageContent).toHaveBeenCalledTimes(2);
            });

            it('should handle stream ending with no streamed tokens but with a reply in end event', async () => {
                const endReply = "Response from end event";
                mockChatClient.streamMessage.mockReturnValueOnce(mockStreamGenerator([
                    { event: 'stream_started', data: { sessionId: "s7" } },
                    { event: 'end', data: { flowResponse: { reply: endReply, sessionId: "s7" } } },
                ]));
                
                await processor.process(userMessage);
                const currentBotElement = mockUiCallbacks.getBotMessageElement.mock.results[0].value;
                 // Call 1: clear thinking ("")
                 // Call 2: set endReply
                expect(mockUiCallbacks.updateMessageContent).toHaveBeenCalledTimes(2);
                expect(mockUiCallbacks.updateMessageContent).toHaveBeenNthCalledWith(1, currentBotElement, "");
                expect(mockUiCallbacks.updateMessageContent).toHaveBeenNthCalledWith(2, currentBotElement, endReply);
                if (currentBotElement) currentBotElement.classList.remove('thinking');
                expect(currentBotElement?.classList.contains('thinking')).toBe(false);
            });

            it('should display (empty response) if stream ends with no tokens and no reply in end event', async () => {
                mockChatClient.streamMessage.mockReturnValueOnce(mockStreamGenerator([
                    { event: 'stream_started', data: { sessionId: "s8" } },
                    { event: 'end', data: { flowResponse: { sessionId: "s8" } } }, 
                ]));

                await processor.process(userMessage);
                const currentBotElement = mockUiCallbacks.getBotMessageElement.mock.results[0].value;
                // SUT logic: if accumulatedResponse is empty and end event has no reply, 
                // and if it's still thinking, it updates to "(empty response)".
                // clearThinkingIndicatorIfNeeded for 'end' does NOT clear if no reply and no accumulated response.
                // So handleStreamEndEvent updates it directly.
                expect(mockUiCallbacks.updateMessageContent).toHaveBeenCalledTimes(1); // Only one call to set (empty response)
                expect(mockUiCallbacks.updateMessageContent).toHaveBeenCalledWith(currentBotElement, "(empty response)");
                if (currentBotElement) currentBotElement.classList.remove('thinking');
                expect(currentBotElement?.classList.contains('thinking')).toBe(false);
            });

            it('should display (No content streamed) if thinking bubble remains and stream ends (e.g. only stream_started and then client error)', async () => {
                 mockChatClient.streamMessage.mockImplementation(async function*() {
                    yield { event: 'stream_started', data: { sessionId: "s9" } };
                    throw new Error("Client stream connection failed abruptly"); 
                });

                await processor.process(userMessage);
                const currentBotElement = mockUiCallbacks.getBotMessageElement.mock.results[0].value;

                expect(mockUiCallbacks.updateMessageContent).toHaveBeenCalledWith(currentBotElement, "Stream Error: Client stream connection failed abruptly");
                 if (currentBotElement) {
                    currentBotElement.classList.remove('thinking', 'bot-message');
                    currentBotElement.classList.add('error-message');
                }
                expect(currentBotElement?.classList.contains('error-message')).toBe(true);
            });

            it('should handle add_message event by logging', async () => {
                 mockChatClient.streamMessage.mockReturnValueOnce(mockStreamGenerator([
                    { event: 'stream_started', data: { sessionId: "s10" } },
                    { event: 'add_message', data: { message: "Auxiliary message", is_bot: true } as StreamEventDataMap['add_message'] },
                    { event: 'end', data: { flowResponse: { reply: "Done", sessionId: "s10" } } },
                ]));
                await processor.process(userMessage);
                expect(mockLogger.debug).toHaveBeenCalledWith("Received 'add_message' event during stream. Data:", { message: "Auxiliary message", is_bot: true });
            });

        });
    });

}); 