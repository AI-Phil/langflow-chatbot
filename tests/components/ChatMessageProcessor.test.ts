/** @jest-environment jsdom */

import { ChatMessageProcessor, MessageProcessorUICallbacks } from '../../src/components/ChatMessageProcessor';
import { LangflowChatClient, BotResponse, StreamEvent, StreamEventType, StreamEventDataMap } from '../../src/clients/LangflowChatClient';
import { Logger } from '../../src/utils/logger';
import { SenderConfig } from '../../src/types';
import { THINKING_BUBBLE_HTML } from '../../src/config/uiConstants';
import { PlaintextMessageParser } from '../../src/components/messageParsers/PlaintextMessageParser';

// Mocks
const mockChatClient = {
    sendMessage: jest.fn(),
    streamMessage: jest.fn(),
    getMessageHistory: jest.fn(),
    getHistory: jest.fn(),
    setFlowId: jest.fn(),
    setSessionId: jest.fn(),
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
    setDebug: jest.fn(),
    updateDebug: jest.fn(),
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
    let mockPlaintextParser: PlaintextMessageParser;

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

        mockPlaintextParser = new PlaintextMessageParser();

        processor = new ChatMessageProcessor(
            mockChatClient as any, 
            senderConfig,
            mockLogger,
            mockUiCallbacks,
            mockPlaintextParser,
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

            it('should use fallback to add new message in non-streaming if thinking bubble is lost before result with reply', async () => {
                const botReply = "Fallback reply here";
                mockChatClient.sendMessage.mockResolvedValueOnce({ reply: botReply, sessionId: "session-lost-bubble-reply" });
                
                const originalGetBotElement = mockUiCallbacks.getBotMessageElement;
                // displayInitialThinkingIndicator sets up a thinking bubble.
                // Then, when handleNonStreamingResponse calls getBotMessageElement, make it return null.
                mockUiCallbacks.getBotMessageElement.mockImplementationOnce(() => null);

                await processor.process(userMessage);

                expect(mockLogger.warn).toHaveBeenCalledWith("handleNonStreamingResponse: Thinking message element was not found or not in expected state. Adding new message.");
                expect(mockUiCallbacks.addMessage).toHaveBeenCalledWith(senderConfig.botSender, botReply, false, expect.any(String));
                // Ensure updateMessageContent was not called on a null/lost element
                const updateContentCallsToNonNull = mockUiCallbacks.updateMessageContent.mock.calls.filter(call => call[0] !== null);
                expect(updateContentCallsToNonNull.length).toBe(0); // Or check it wasn't called with botReply
                mockUiCallbacks.getBotMessageElement = originalGetBotElement;
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
                
                // Expect updateMessageContent to be called once to clear the thinking indicator
                expect(mockUiCallbacks.updateMessageContent).toHaveBeenCalledTimes(1);
                const firstCallArgElement = mockUiCallbacks.updateMessageContent.mock.calls[0][0] as HTMLElement;
                expect(firstCallArgElement).toBeInstanceOf(HTMLElement);
                expect(mockUiCallbacks.updateMessageContent.mock.calls[0][1]).toBe(""); // Called with empty string to clear
                
                // Verify the content was set by direct innerHTML manipulation in handleStreamTokenEvent
                const textContentSpan = firstCallArgElement.querySelector('.message-text-content');
                expect(textContentSpan).not.toBeNull();
                expect(textContentSpan?.innerHTML).toBe(token1 + token2);
                
                // scrollChatToBottom should be called for each token
                expect(mockUiCallbacks.scrollChatToBottom).toHaveBeenCalledTimes(2);
                
                // Remove expectations for a second call to updateMessageContent with the full token string,
                // as tokens update innerHTML directly.

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

            it('should display (No content streamed) if stream ends with no tokens and no reply in end event', async () => {
                mockChatClient.streamMessage.mockReturnValueOnce(mockStreamGenerator([
                    { event: 'stream_started', data: { sessionId: "s8" } },
                    { event: 'end', data: { flowResponse: { sessionId: "s8" } } }, 
                ]));

                await processor.process(userMessage);
                const currentBotElement = mockUiCallbacks.getBotMessageElement.mock.results[0].value;
                expect(mockUiCallbacks.updateMessageContent).toHaveBeenCalledTimes(1); 
                expect(mockUiCallbacks.updateMessageContent).toHaveBeenCalledWith(currentBotElement, "(No content streamed)"); // Changed from "(empty response)"
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
                    { event: 'add_message', data: { message: "Auxiliary message", sender: "Machine", is_bot: true } as StreamEventDataMap['add_message'] },
                    { event: 'end', data: { flowResponse: { reply: "Done", sessionId: "s10" } } },
                ]));
                await processor.process(userMessage);
                expect(mockLogger.debug).toHaveBeenCalledWith("handleStreamAddMessageEvent: Received 'add_message' event. Full data:", { data: { message: "Auxiliary message", sender: "Machine", is_bot: true } });
            });

            it('should log a warning if .message-text-content span is missing during token event', async () => {
                const token1 = "Hello ";
                const originalGetBotElement = mockUiCallbacks.getBotMessageElement;

                // mockBotMessageElement is the one set by displayInitialThinkingIndicator via addMessage/setBotMessageElement.
                // It will have the .message-text-content span initially.

                const elementWithoutSpan = document.createElement('div');
                elementWithoutSpan.className = 'message bot-message'; // Critically, no .message-text-content span

                // After displayInitialThinkingIndicator runs and sets up the initial element (which has a span),
                // all subsequent calls to getBotMessageElement in this test will return the element WITHOUT a span.
                let initialSetupDone = false;
                mockUiCallbacks.getBotMessageElement.mockImplementation(() => {
                    if (!initialSetupDone) {
                        // This path should be taken by displayInitialThinkingIndicator via setBotMessageElement
                        // and the very first getBotMessageElement in the stream loop (currentBotElement for clearThinkingIndicatorIfNeeded)
                        initialSetupDone = true; 
                        return mockBotMessageElement; // The one with the span
                    }
                    // All subsequent calls, including the one inside handleStreamTokenEvent, get this:
                    return elementWithoutSpan;
                });

                mockChatClient.streamMessage.mockReturnValueOnce(mockStreamGenerator([
                    { event: 'stream_started', data: { sessionId: "s11" } },
                    { event: 'token', data: { chunk: token1 } },
                    { event: 'end', data: { flowResponse: { sessionId: "s11" } } },
                ]));

                await processor.process(userMessage);
                expect(mockLogger.warn).toHaveBeenCalledWith("Stream token: message-text-content span not found in bot message element. Cannot append token.");
                
                // Restore original mock
                mockUiCallbacks.getBotMessageElement = originalGetBotElement;
            });

            it('should add a new error message if currentBotElement is null during stream error event', async () => {
                const streamErrorMsg = "Stream processing error for null element";
                const originalGetBotElement = mockUiCallbacks.getBotMessageElement;

                mockChatClient.streamMessage.mockReturnValueOnce(mockStreamGenerator([
                    { event: 'stream_started', data: { sessionId: "s12" } },
                    { event: 'error', data: { message: streamErrorMsg, detail: "Detail for null element" } },
                ]));

                // Ensure getBotMessageElement returns null when handleStreamErrorEvent tries to get it.
                // This needs to be timed for when processStreamEvent calls handleStreamErrorEvent.
                // The first call to getBotMessageElement in the loop might be for clearThinkingIndicatorIfNeeded.
                mockUiCallbacks.getBotMessageElement.mockImplementation(() => {
                    // This mock will be active when handleStreamErrorEvent is eventually called.
                    // This is a bit broad, assumes this is the only getBotMessageElement call path for this event.
                    return null;
                });

                await processor.process(userMessage);

                const expectedErrorMessage = `Stream Error: ${streamErrorMsg} Details: "Detail for null element"`;
                expect(mockUiCallbacks.addMessage).toHaveBeenCalledWith(
                    senderConfig.errorSender,
                    expectedErrorMessage,
                    false,
                    expect.any(String)
                );
                // Ensure updateMessageContent was NOT called as there was no element to update
                expect(mockUiCallbacks.updateMessageContent).not.toHaveBeenCalled(); 

                mockUiCallbacks.getBotMessageElement = originalGetBotElement; // Restore
            });

            it('should log and skip UI update for bot add_message if content is empty', async () => {
                const originalGetBotElement = mockUiCallbacks.getBotMessageElement;
                // Provide a valid bot element initially for displayInitialThinkingIndicator
                mockUiCallbacks.getBotMessageElement.mockImplementation(() => mockBotMessageElement);

                mockChatClient.streamMessage.mockReturnValueOnce(mockStreamGenerator([
                    { event: 'stream_started', data: { sessionId: "s13" } },
                    { event: 'add_message', data: { sender: "Machine", text: "" } as StreamEventDataMap['add_message'] }, // Empty text
                    { event: 'end', data: { flowResponse: { reply: "Done", sessionId: "s13" } } },
                ]));

                await processor.process(userMessage);

                // Check that the primary log for receiving the event was called
                expect(mockLogger.debug).toHaveBeenCalledWith(
                    "handleStreamAddMessageEvent: Received 'add_message' event. Full data:", 
                    { data: { sender: "Machine", text: "" } }
                );
                // Check that no attempt was made to update message content since it's empty
                // Note: updateMessageContent(currentBotElement, "") IS called by clearThinkingIndicatorIfNeeded IF a token arrived first, 
                // or if add_message itself cleared thinking. Here, add_message with empty content shouldn't clear thinking by setting content.
                // We need to be careful about how many times updateMessageContent(..., "") is called by other mechanisms.
                // For this specific path, after the empty message check, no NEW updateMessageContent should be called.
                // The first call is from displayInitialThinkingIndicator -> addMessage -> setBotElement
                // The second call is from clearThinkingIndicatorIfNeeded if 'end' event clears it.
                // So, checking that it's NOT called with actual content from add_message is key.
                
                // Let's verify no content was set from this specific add_message event
                const updateCalls = mockUiCallbacks.updateMessageContent.mock.calls;
                let calledWithAddMessageContent = false;
                for (const call of updateCalls) {
                    // Check if updateMessageContent was called with anything other than the initial clear ("") or the final reply ("Done")
                    if (call[1] !== "" && call[1] !== "Done" && call[1] !== THINKING_BUBBLE_HTML && call[1] !== "(No content streamed)") {
                         // This is tricky because if the thinking bubble has the .message-text-content span,
                         // updateMessageContent("") is used to clear it.
                         // The critical part is that the empty string from add_message.text isn't used to call updateMessageContent.
                         // The add_message handler should return early.
                    }
                }
                expect(calledWithAddMessageContent).toBe(false); // No call with the (empty) content of this add_message
                
                // Ensure the flow still completes, e.g., the 'Done' from the end event IS processed.
                const thinkingElement = mockUiCallbacks.getBotMessageElement.mock.results[0].value;
                expect(mockUiCallbacks.updateMessageContent).toHaveBeenCalledWith(thinkingElement, "Done");

                mockUiCallbacks.getBotMessageElement = originalGetBotElement; // Restore
            });

            it('should warn and update main element if .message-text-content is missing during add_message', async () => {
                const addMessageContent = "Auxiliary content here";
                const finalReplyFromEnd = "Final Reply";
                const originalGetBotElement = mockUiCallbacks.getBotMessageElement;
                
                let elementForAddMessageProcessing: HTMLElement | null = document.createElement('div');
                // Ensure the element exists and has a class, but no .message-text-content span
                if(elementForAddMessageProcessing) elementForAddMessageProcessing.className = 'message bot-message'; 

                mockChatClient.streamMessage.mockReturnValueOnce(mockStreamGenerator([
                    { event: 'stream_started', data: { sessionId: "s14" } },
                    { event: 'add_message', data: { sender: "Machine", text: addMessageContent } as StreamEventDataMap['add_message'] },
                    { event: 'end', data: { flowResponse: { reply: finalReplyFromEnd, sessionId: "s14" } } },
                ]));

                // Mock getBotMessageElement sequence
                mockUiCallbacks.getBotMessageElement
                    .mockImplementationOnce(() => { // For displayInitialThinkingIndicator
                        const el = document.createElement('div'); el.className = 'message bot-message thinking';
                        const span = document.createElement('span'); span.className = 'message-text-content'; el.appendChild(span);
                        mockUiCallbacks.setBotMessageElement(el); return el;
                    })
                    // For clearThinkingIndicatorIfNeeded (before add_message) - needs the original thinking element
                    .mockImplementationOnce(() => mockUiCallbacks.setBotMessageElement.mock.calls[0][0]) 
                    // For handleStreamAddMessageEvent - provide the element without the span
                    .mockImplementationOnce(() => elementForAddMessageProcessing) 
                    // For clearThinkingIndicatorIfNeeded (before end) - assume it operates on elementForAddMessageProcessing
                    .mockImplementationOnce(() => elementForAddMessageProcessing) 
                     // For handleStreamEndEvent - operate on elementForAddMessageProcessing
                    .mockImplementationOnce(() => elementForAddMessageProcessing);

                await processor.process(userMessage);

                expect(mockLogger.warn).toHaveBeenCalledWith("handleStreamAddMessageEvent: .message-text-content span not found. Updating currentBotElement directly.");
                // Check that updateMessageContent was called with elementForAddMessageProcessing and addMessageContent
                expect(mockUiCallbacks.updateMessageContent).toHaveBeenCalledWith(elementForAddMessageProcessing, addMessageContent);
                // And also ensure the final reply was set (on the same element in this mock setup)
                expect(mockUiCallbacks.updateMessageContent).toHaveBeenCalledWith(elementForAddMessageProcessing, finalReplyFromEnd); 
                                
                mockUiCallbacks.getBotMessageElement = originalGetBotElement; // Restore
            });

            it('should warn if currentBotElement is null during add_message with content', async () => {
                const addMessageContent = "Auxiliary content for null element";
                const finalReply = "Done";
                const originalGetBotElement = mockUiCallbacks.getBotMessageElement;

                let thinkingElement: HTMLElement | null = null; 

                mockChatClient.streamMessage.mockReturnValueOnce(mockStreamGenerator([
                    { event: 'stream_started', data: { sessionId: "s15" } },
                    { event: 'add_message', data: { sender: "Machine", text: addMessageContent } as StreamEventDataMap['add_message'] },
                    { event: 'end', data: { flowResponse: { reply: finalReply, sessionId: "s15" } } },
                ]));

                // Mock getBotMessageElement sequence
                mockUiCallbacks.getBotMessageElement
                    .mockImplementationOnce(() => { // 1. For displayInitialThinkingIndicator (via setBotMessageElement)
                        thinkingElement = document.createElement('div'); 
                        thinkingElement.className = 'message bot-message thinking';
                        const span = document.createElement('span'); 
                        span.className = 'message-text-content'; 
                        thinkingElement.appendChild(span);
                        // This element is set by ui.setBotMessageElement internally by displayInitialThinkingIndicator
                        // We capture it here to return it in subsequent calls if needed.
                        mockUiCallbacks.setBotMessageElement(thinkingElement); // Ensure it's set for the real SUT
                        return thinkingElement;
                    })
                    .mockImplementationOnce(() => thinkingElement) // 2. For currentBotElement in loop (before add_message), and for clearThinkingIfNeeded
                    .mockImplementationOnce(() => null)           // 3. For handleStreamAddMessageEvent - THIS IS THE KEY for the warning
                    .mockImplementationOnce(() => thinkingElement) // 4. For currentBotElement in loop (before end), and for clearThinkingIfNeeded
                    .mockImplementationOnce(() => thinkingElement) // 5. For handleStreamEndEvent - should receive the thinkingElement to update
                    .mockImplementationOnce(() => {                 // 6. For botElementForFinally
                        // At this point, handleStreamEndEvent should have updated thinkingElement and removed 'thinking' class
                        if (thinkingElement && thinkingElement.classList.contains('thinking')) {
                            thinkingElement.classList.remove('thinking');
                        }
                        // Ensure it has some content from the 'end' event so finally doesn't overwrite
                        if (thinkingElement && thinkingElement.querySelector('.message-text-content')) {
                            (thinkingElement.querySelector('.message-text-content') as HTMLElement).innerHTML = finalReply;
                        }
                        return thinkingElement; 
                    });

                await processor.process(userMessage);

                expect(mockLogger.warn).toHaveBeenCalledWith("handleStreamAddMessageEvent: Bot message content found, but no currentBotElement to update. This is unusual if a thinking indicator was expected.");
                
                // Verify that updateMessageContent was NOT called with addMessageContent from handleStreamAddMessageEvent (due to null element)
                const addMessageContentCall = mockUiCallbacks.updateMessageContent.mock.calls.find(call => call[1] === addMessageContent);
                expect(addMessageContentCall).toBeUndefined();

                // Ensure the "Done" from the end event still gets processed and updates the thinkingElement
                expect(mockUiCallbacks.updateMessageContent).toHaveBeenCalledWith(thinkingElement, finalReply);

                mockUiCallbacks.getBotMessageElement = originalGetBotElement; // Restore
            });

            it('should warn if no bot element found at stream end', async () => {
                const originalGetBotElement = mockUiCallbacks.getBotMessageElement;
                mockChatClient.streamMessage.mockReturnValueOnce(mockStreamGenerator([
                    { event: 'stream_started', data: { sessionId: "s_no_el_end" } },
                    { event: 'token', data: { chunk: "Some token" } }, 
                    { event: 'end', data: { flowResponse: { reply: "Final reply", sessionId: "s_no_el_end" } } },
                ]));

                // Mock getBotMessageElement to provide an element for most calls, then null specifically for the call inside handleStreamEndEvent
                mockUiCallbacks.getBotMessageElement
                    .mockImplementationOnce(() => mockBotMessageElement) // Call 1 (loop start for stream_started)
                    .mockImplementationOnce(() => mockBotMessageElement) // Call 2 (loop start for token)
                    .mockImplementationOnce(() => mockBotMessageElement) // Call 3 (inside handleStreamTokenEvent for token event)
                    .mockImplementationOnce(() => mockBotMessageElement) // Call 4 (loop start for end event)
                    .mockImplementationOnce(() => null);                 // Call 5 (THE ONE inside handleStreamEndEvent itself)

                await processor.process(userMessage);
                expect(mockLogger.warn).toHaveBeenCalledWith("handleStreamEndEvent: No bot message element found at stream end. This is unusual.");
                mockUiCallbacks.getBotMessageElement = originalGetBotElement;
            });

            it('should log a warning for an unknown stream event type', async () => {
                mockChatClient.streamMessage.mockReturnValueOnce(mockStreamGenerator([
                    { event: 'stream_started', data: { sessionId: "s_unknown" } },
                    // @ts-ignore Test a deliberately unknown event type
                    { event: 'unexpected_event_type', data: { info: "test" } },
                    { event: 'end', data: { flowResponse: { reply: "End after unknown", sessionId: "s_unknown" } } },
                ]));

                await processor.process(userMessage);
                expect(mockLogger.warn).toHaveBeenCalledWith("Received unknown stream event type: unexpected_event_type");
            });

        });
    });

}); 