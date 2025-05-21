/** @jest-environment jsdom */

import { ChatSessionManager, SessionManagerDisplayCallbacks } from '../src/components/ChatSessionManager';
import { LangflowChatClient, ChatMessageData } from '../src/clients/LangflowChatClient';
import { Logger } from '../src/components/logger';
import { SenderConfig } from '../src/types';
import * as datetimeUtils from '../src/utils/datetimeUtils';

// Mock LangflowChatClient
const mockChatClient: jest.Mocked<Pick<LangflowChatClient, 'getMessageHistory'>> = {
    getMessageHistory: jest.fn(),
};

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

// Mock SessionManagerDisplayCallbacks
const mockDisplayCallbacks: jest.Mocked<SessionManagerDisplayCallbacks> = {
    clearMessages: jest.fn(),
    addMessage: jest.fn(),
    scrollChatToBottom: jest.fn(),
};

// Mock datetimeUtils
jest.mock('../src/utils/datetimeUtils', () => ({
    ...jest.requireActual('../src/utils/datetimeUtils'), // Import and retain default behavior
    normalizeLangflowTimestamp: jest.fn((timestamp?: string | number | Date) => {
        if (!timestamp) return new Date().toISOString();
        return new Date(timestamp).toISOString(); // Simplified mock implementation
    }),
}));
const mockNormalizeTimestamp = datetimeUtils.normalizeLangflowTimestamp as jest.Mock;


const senderConfig: SenderConfig = {
    userSender: 'User',
    botSender: 'Bot',
    errorSender: 'Error',
    systemSender: 'System',
};

describe('ChatSessionManager', () => {
    let sessionManager: ChatSessionManager;

    beforeEach(() => {
        jest.clearAllMocks();
        // Default setup for a new sessionManager before each test
        sessionManager = new ChatSessionManager(
            mockChatClient as any, // Cast because we only mocked a pick
            senderConfig,
            mockDisplayCallbacks,
            mockLogger
            // No initialSessionId by default
        );
    });

    it('should be defined', () => {
        expect(sessionManager).toBeDefined();
    });

    // Constructor tests
    describe('constructor', () => {
        it('should initialize without a session ID by default', () => {
            expect(sessionManager.currentSessionId).toBeNull();
            expect(sessionManager.isHistoryLoaded).toBe(false);
            expect(mockLogger.info).toHaveBeenCalledWith("ChatSessionManager: Initialized without a session ID.");
        });

        it('should initialize with a session ID and attempt to load history if initialSessionId is provided', async () => {
            const initialSession = "session-init";
            const historyData: ChatMessageData[] = [{ text: "hello", sender: "user", timestamp: "2023-01-01T12:00:00Z" }];
            mockChatClient.getMessageHistory.mockResolvedValueOnce(historyData);
            mockNormalizeTimestamp.mockReturnValue("2023-01-01T12:00:00.000Z");

            const smWithId = new ChatSessionManager(
                mockChatClient as any,
                senderConfig,
                mockDisplayCallbacks,
                mockLogger,
                initialSession
            );

            expect(mockLogger.info).toHaveBeenCalledWith(`ChatSessionManager: Initializing with session ID: ${initialSession}`);
            expect(smWithId.currentSessionId).toBe(initialSession);
            expect(smWithId.isHistoryLoaded).toBe(false); // Initially false before async load completes
            
            // Wait for async operations in constructor/setSessionIdAndLoadHistory to complete
            await Promise.resolve(); // For promises to settle from setSessionIdAndLoadHistory
            await Promise.resolve(); // additional tick just in case

            expect(mockChatClient.getMessageHistory).toHaveBeenCalledWith(initialSession);
            expect(mockDisplayCallbacks.clearMessages).toHaveBeenCalled();
            expect(mockDisplayCallbacks.addMessage).toHaveBeenCalledWith(senderConfig.userSender, "hello", false, "2023-01-01T12:00:00.000Z");
            expect(mockDisplayCallbacks.scrollChatToBottom).toHaveBeenCalled();
            expect(smWithId.isHistoryLoaded).toBe(true); // Should be true after history load
        });
    });

    // Getter tests
    describe('getters', () => {
        it('currentSessionId should return the current session ID', () => {
            expect(sessionManager.currentSessionId).toBeNull();
            sessionManager.updateCurrentSessionId("test-session");
            expect(sessionManager.currentSessionId).toBe("test-session");
        });

        it('isHistoryLoaded should return the history loaded status', () => {
            expect(sessionManager.isHistoryLoaded).toBe(false);
            // Simulate history loading
            (sessionManager as any)._isHistoryLoaded = true;
            expect(sessionManager.isHistoryLoaded).toBe(true);
        });
    });

    describe('updateCurrentSessionId', () => {
        it('should update session ID and reset historyLoaded if new ID is different', () => {
            sessionManager.updateCurrentSessionId("session1");
            expect(sessionManager.currentSessionId).toBe("session1");
            expect(sessionManager.isHistoryLoaded).toBe(false);
            expect(mockLogger.info).toHaveBeenCalledWith("Session ID updated to: session1");

            // Manually set history loaded to true to check reset
            (sessionManager as any)._isHistoryLoaded = true;
            sessionManager.updateCurrentSessionId("session2");
            expect(sessionManager.currentSessionId).toBe("session2");
            expect(sessionManager.isHistoryLoaded).toBe(false);
            expect(mockLogger.info).toHaveBeenCalledWith("Session ID updated to: session2");
        });

        it('should not change session ID or historyLoaded if new ID is the same', () => {
            sessionManager.updateCurrentSessionId("session1");
            (sessionManager as any)._isHistoryLoaded = true;
            jest.clearAllMocks(); // Clear logger mocks to check it wasn't called

            sessionManager.updateCurrentSessionId("session1");
            expect(sessionManager.currentSessionId).toBe("session1");
            expect(sessionManager.isHistoryLoaded).toBe(true);
            expect(mockLogger.info).not.toHaveBeenCalled();
        });

        it('should clear session ID and reset historyLoaded if new ID is null', () => {
            sessionManager.updateCurrentSessionId("session1");
            (sessionManager as any)._isHistoryLoaded = true;

            sessionManager.updateCurrentSessionId(null);
            expect(sessionManager.currentSessionId).toBeNull();
            expect(sessionManager.isHistoryLoaded).toBe(false);
            expect(mockLogger.info).toHaveBeenCalledWith("Session ID cleared.");
        });

        it('should do nothing if new ID is null and current is already null', () => {
            expect(sessionManager.currentSessionId).toBeNull();
            expect(sessionManager.isHistoryLoaded).toBe(false);
            jest.clearAllMocks();

            sessionManager.updateCurrentSessionId(null);
            expect(sessionManager.currentSessionId).toBeNull();
            expect(sessionManager.isHistoryLoaded).toBe(false);
            expect(mockLogger.info).not.toHaveBeenCalled();
        });
    });

    describe('processSessionIdUpdateFromFlow', () => {
        it('should call updateCurrentSessionId if the new session ID is different', () => {
            const newSessionId = "flow-session-1";
            // Spy on updateCurrentSessionId directly on the instance
            const updateSpy = jest.spyOn(sessionManager, 'updateCurrentSessionId');
            
            sessionManager.processSessionIdUpdateFromFlow(newSessionId);
            
            expect(mockLogger.info).toHaveBeenCalledWith(`ChatSessionManager: Session ID update from flow: ${newSessionId}`);
            expect(updateSpy).toHaveBeenCalledWith(newSessionId);
            expect(sessionManager.currentSessionId).toBe(newSessionId);
            updateSpy.mockRestore();
        });

        it('should not call updateCurrentSessionId if the new session ID is the same', () => {
            const currentSessionId = "flow-session-1";
            sessionManager.updateCurrentSessionId(currentSessionId); // Set initial
            jest.clearAllMocks(); // Clear previous log calls
            const updateSpy = jest.spyOn(sessionManager, 'updateCurrentSessionId');

            sessionManager.processSessionIdUpdateFromFlow(currentSessionId);

            expect(mockLogger.info).toHaveBeenCalledWith(`ChatSessionManager: Session ID update from flow: ${currentSessionId}`);
            expect(updateSpy).not.toHaveBeenCalled();
            updateSpy.mockRestore();
        });
    });

    describe('loadAndDisplayHistory', () => {
        const historyBase: ChatMessageData[] = [
            { text: "User message 1", sender: "user", sender_name: "User", timestamp: "2023-01-01T10:00:00Z" },
            { text: "Bot message 1", sender: "bot", sender_name: "Bot", timestamp: "2023-01-01T10:01:00Z" },
        ];

        beforeEach(() => {
            // Reset _isHistoryLoaded for sessionManager instance for these specific tests
            (sessionManager as any)._isHistoryLoaded = false;
            mockNormalizeTimestamp.mockImplementation(ts => new Date(ts as string).toISOString()); // Reset to basic behavior
        });

        it('should clear messages, add messages from history, and scroll to bottom', async () => {
            mockNormalizeTimestamp.mockReturnValueOnce("ts1").mockReturnValueOnce("ts2");
            await sessionManager.loadAndDisplayHistory(historyBase);

            expect(mockDisplayCallbacks.clearMessages).toHaveBeenCalledTimes(1);
            expect(mockDisplayCallbacks.addMessage).toHaveBeenCalledTimes(2);
            expect(mockDisplayCallbacks.addMessage).toHaveBeenNthCalledWith(1, senderConfig.userSender, "User message 1", false, "ts1");
            expect(mockDisplayCallbacks.addMessage).toHaveBeenNthCalledWith(2, senderConfig.botSender, "Bot message 1", false, "ts2");
            expect(mockDisplayCallbacks.scrollChatToBottom).toHaveBeenCalledTimes(1);
            expect(sessionManager.isHistoryLoaded).toBe(true);
            expect(mockLogger.info).toHaveBeenCalledWith("Loading and displaying history...");
            expect(mockLogger.info).toHaveBeenCalledWith("History loaded and displayed.");
        });

        it('should not load history if already loaded', async () => {
            (sessionManager as any)._isHistoryLoaded = true; // Mark as loaded
            await sessionManager.loadAndDisplayHistory(historyBase);

            expect(mockDisplayCallbacks.clearMessages).not.toHaveBeenCalled();
            expect(mockDisplayCallbacks.addMessage).not.toHaveBeenCalled();
            expect(mockLogger.info).toHaveBeenCalledWith("History already loaded or loading process was completed for the current session.");
        });

        it('should correctly identify sender types based on config and keywords', async () => {
            const historyWithVariedSenders: ChatMessageData[] = [
                { text: "Config User", sender: "some_raw_user", sender_name: senderConfig.userSender, timestamp: "ts1" }, // Matches config.userSender via sender_name
                { text: "Config Bot", sender: "some_raw_bot", sender_name: senderConfig.botSender, timestamp: "ts2" },   // Matches config.botSender via sender_name
                { text: "Keyword user", sender: "USER", sender_name: "Generic User", timestamp: "ts3" },         // Matches 'user' keyword via sender
                { text: "Keyword bot", sender: "MACHINE", sender_name: "Generic Bot", timestamp: "ts4" },      // Matches 'machine' keyword via sender
                { text: "Named sender", sender: "raw_other", sender_name: "Alice", timestamp: "ts5" },             // Uses sender_name as is
                { text: "System fallback", sender: "unknown", sender_name: undefined, timestamp: "ts6" },         // Falls back to systemSender
                { text: "extra message", timestamp: "ts7"} // also systemSender, sender and sender_name are undefined
            ];
            mockNormalizeTimestamp.mockImplementation(ts => `${ts}_norm`);

            await sessionManager.loadAndDisplayHistory(historyWithVariedSenders);

            expect(mockDisplayCallbacks.addMessage).toHaveBeenCalledTimes(historyWithVariedSenders.length);
            expect(mockDisplayCallbacks.addMessage).toHaveBeenCalledWith(senderConfig.userSender, "Config User", false, "ts1_norm");
            expect(mockDisplayCallbacks.addMessage).toHaveBeenCalledWith(senderConfig.botSender, "Config Bot", false, "ts2_norm");
            expect(mockDisplayCallbacks.addMessage).toHaveBeenCalledWith(senderConfig.userSender, "Keyword user", false, "ts3_norm");
            expect(mockDisplayCallbacks.addMessage).toHaveBeenCalledWith(senderConfig.botSender, "Keyword bot", false, "ts4_norm");
            expect(mockDisplayCallbacks.addMessage).toHaveBeenCalledWith("Alice", "Named sender", false, "ts5_norm");
            expect(mockDisplayCallbacks.addMessage).toHaveBeenCalledWith(senderConfig.systemSender, "System fallback", false, "ts6_norm");
            expect(mockDisplayCallbacks.addMessage).toHaveBeenCalledWith(senderConfig.systemSender, "extra message", false, "ts7_norm");
            expect(mockLogger.warn).toHaveBeenCalledWith("Unidentified sender in history: rawMessage.sender='unknown', rawMessage.sender_name='undefined'. Defaulting to systemSender.");
            expect(mockLogger.warn).toHaveBeenCalledWith("Unidentified sender in history: rawMessage.sender='undefined', rawMessage.sender_name='undefined'. Defaulting to systemSender.");
        });

        it('should handle empty history array', async () => {
            await sessionManager.loadAndDisplayHistory([]);
            expect(mockDisplayCallbacks.clearMessages).toHaveBeenCalledTimes(1);
            expect(mockDisplayCallbacks.addMessage).not.toHaveBeenCalled();
            expect(sessionManager.isHistoryLoaded).toBe(true);
            expect(mockDisplayCallbacks.scrollChatToBottom).toHaveBeenCalledTimes(1);
        });

        it('should handle the specific re-check case: _isHistoryLoaded true, empty history, no session ID', async () => {
            // Setup the specific conditions
            (sessionManager as any)._isHistoryLoaded = true;
            sessionManager.updateCurrentSessionId(null); // Ensure no session ID, this also resets _isHistoryLoaded to false
            (sessionManager as any)._isHistoryLoaded = true; // Force it back to true for the test condition
            
            // Clear relevant mocks before the call
            mockLogger.info.mockClear();
            mockDisplayCallbacks.clearMessages.mockClear();
            mockDisplayCallbacks.addMessage.mockClear();
            mockDisplayCallbacks.scrollChatToBottom.mockClear();

            await sessionManager.loadAndDisplayHistory([]); // history is empty

            // When the first `if` condition is met, it proceeds to the main logic of loading history.
            expect(mockLogger.info).toHaveBeenCalledWith("Loading and displaying history...");
            expect(mockLogger.info).toHaveBeenCalledWith("History loaded and displayed.");
            expect(mockLogger.info).not.toHaveBeenCalledWith("History already loaded or loading process was completed for the current session.");
            
            expect(mockDisplayCallbacks.clearMessages).toHaveBeenCalledTimes(1);
            expect(mockDisplayCallbacks.addMessage).not.toHaveBeenCalled(); // History is empty
            expect(mockDisplayCallbacks.scrollChatToBottom).toHaveBeenCalledTimes(1);
            expect(sessionManager.isHistoryLoaded).toBe(true); // Should be set to true by loadAndDisplayHistory
        });
    });

    describe('setSessionIdAndLoadHistory', () => {
        const sessionId = "session-load-hist";
        const historyData: ChatMessageData[] = [
            { text: "History message", sender: "user", timestamp: "ts-hist-1" }
        ];

        beforeEach(() => {
            // Ensure sessionManager is fresh and no history loaded
            // Re-construct sessionManager to ensure a clean state for these specific tests
            sessionManager = new ChatSessionManager(
                mockChatClient as any, 
                senderConfig,
                mockDisplayCallbacks,
                mockLogger
            );
            // (sessionManager as any)._currentSessionId = null; // Handled by new instance
            // (sessionManager as any)._isHistoryLoaded = false; // Handled by new instance
            mockChatClient.getMessageHistory.mockReset();
            mockDisplayCallbacks.clearMessages.mockReset();
            mockDisplayCallbacks.addMessage.mockReset();
            mockLogger.info.mockClear(); // Specifically clear info logs for this describe block
            mockLogger.error.mockClear();
            mockLogger.warn.mockClear();
        });

        it('should update session ID, load history, and display it if new session ID is provided', async () => {
            mockChatClient.getMessageHistory.mockResolvedValueOnce(historyData);
            mockNormalizeTimestamp.mockReturnValueOnce("norm_ts-hist-1");

            await sessionManager.setSessionIdAndLoadHistory(sessionId);

            expect(sessionManager.currentSessionId).toBe(sessionId);
            // Removed: expect(sessionManager.isHistoryLoaded).toBe(false); 
            expect(mockChatClient.getMessageHistory).toHaveBeenCalledWith(sessionId);
            
            await Promise.resolve(); 
            await Promise.resolve(); 

            expect(mockDisplayCallbacks.clearMessages).toHaveBeenCalledTimes(1);
            expect(mockDisplayCallbacks.addMessage).toHaveBeenCalledWith(senderConfig.userSender, "History message", false, "norm_ts-hist-1");
            expect(sessionManager.isHistoryLoaded).toBe(true); 
            expect(mockLogger.info).toHaveBeenCalledWith(`Setting session ID to: ${sessionId} and loading history.`);
            // Further check that loadAndDisplayHistory sets isHistoryLoaded correctly AFTER operations
        });

        it('should handle empty history data from client', async () => {
            mockChatClient.getMessageHistory.mockResolvedValueOnce([]); 

            await sessionManager.setSessionIdAndLoadHistory(sessionId);
            
            await Promise.resolve(); 

            expect(sessionManager.currentSessionId).toBe(sessionId);
            expect(mockChatClient.getMessageHistory).toHaveBeenCalledWith(sessionId);
            expect(mockDisplayCallbacks.clearMessages).toHaveBeenCalledTimes(1); 
            expect(mockDisplayCallbacks.addMessage).not.toHaveBeenCalled();
            expect(sessionManager.isHistoryLoaded).toBe(true); 
            // Check for logs from loadAndDisplayHistory when history is empty
            expect(mockLogger.info).toHaveBeenCalledWith("Loading and displaying history...");
            expect(mockLogger.info).toHaveBeenCalledWith("History loaded and displayed.");
            // Ensure the specific log for null/undefined history is NOT called here
            expect(mockLogger.info).not.toHaveBeenCalledWith("No history data found for the session, or history is empty.");
        });

         it('should handle null history data from client', async () => {
            mockChatClient.getMessageHistory.mockResolvedValueOnce(null as any); 

            await sessionManager.setSessionIdAndLoadHistory(sessionId);
            await Promise.resolve(); 

            expect(mockDisplayCallbacks.clearMessages).toHaveBeenCalledTimes(1);
            expect(mockDisplayCallbacks.addMessage).not.toHaveBeenCalled();
            expect(sessionManager.isHistoryLoaded).toBe(true); 
            // This is the correct test for this specific log message
            expect(mockLogger.info).toHaveBeenCalledWith("No history data found for the session, or history is empty.");
        });

        it('should handle error when loading history', async () => {
            const error = new Error("Failed to fetch history");
            mockChatClient.getMessageHistory.mockRejectedValueOnce(error);

            await sessionManager.setSessionIdAndLoadHistory(sessionId);
            await Promise.resolve(); 

            expect(sessionManager.currentSessionId).toBe(sessionId);
            expect(mockChatClient.getMessageHistory).toHaveBeenCalledWith(sessionId);
            // clearMessages might not be called if error happens before loadAndDisplayHistory calls it
            // The SUT calls updateCurrentSessionId first, then tries to load.
            // loadAndDisplayHistory, if called, would clear. If getMessageHistory fails, it won't call loadAndDisplayHistory.
            // The current SUT does NOT call clearMessages before calling getMessageHistory.
            // However, the constructor test implies loadAndDisplayHistory IS called after an error to show error msg.
            // Let's trace SUT for error: getMessageHistory fails -> catch block -> addMessage(error), _isHistoryLoaded = true.
            // So, clearMessages isn't called in this specific error path before addMessage.
            
            expect(mockDisplayCallbacks.clearMessages).not.toHaveBeenCalled(); // Not called if getMessageHistory fails before loadAndDisplayHistory
            expect(mockDisplayCallbacks.addMessage).toHaveBeenCalledWith(senderConfig.errorSender, "Error loading chat history.");
            expect(sessionManager.isHistoryLoaded).toBe(true); // Marked as loaded to prevent retries
            expect(mockLogger.error).toHaveBeenCalledWith("Error loading chat history:", error);
        });

        it('should not load history if session ID is the same and history is already loaded', async () => {
            // Initial load
            sessionManager.updateCurrentSessionId(sessionId);
            (sessionManager as any)._isHistoryLoaded = true;
            jest.clearAllMocks(); // Clear mocks after initial setup

            await sessionManager.setSessionIdAndLoadHistory(sessionId);

            expect(mockChatClient.getMessageHistory).not.toHaveBeenCalled();
            expect(mockDisplayCallbacks.clearMessages).not.toHaveBeenCalled();
            expect(mockDisplayCallbacks.addMessage).not.toHaveBeenCalled();
            expect(mockLogger.info).toHaveBeenCalledWith(`Session ID is already ${sessionId} and history is loaded.`);
        });

        it('should clear session and messages if sessionId is undefined', async () => {
            sessionManager.updateCurrentSessionId("some-old-session"); // Have an existing session
            (sessionManager as any)._isHistoryLoaded = true;
            jest.clearAllMocks();

            await sessionManager.setSessionIdAndLoadHistory(undefined);

            expect(sessionManager.currentSessionId).toBeNull();
            expect(mockDisplayCallbacks.clearMessages).toHaveBeenCalledTimes(1);
            expect(sessionManager.isHistoryLoaded).toBe(true); // Marked as loaded (empty state)
            expect(mockLogger.info).toHaveBeenCalledWith("No session ID provided, or session ID is empty. Clearing session and messages.");
            expect(mockChatClient.getMessageHistory).not.toHaveBeenCalled();
        });

        it('should clear session and messages if sessionId is an empty string', async () => {
            sessionManager.updateCurrentSessionId("some-old-session");
            (sessionManager as any)._isHistoryLoaded = true;
            jest.clearAllMocks();

            await sessionManager.setSessionIdAndLoadHistory("   "); // Empty or whitespace

            expect(sessionManager.currentSessionId).toBeNull();
            expect(mockDisplayCallbacks.clearMessages).toHaveBeenCalledTimes(1);
            expect(sessionManager.isHistoryLoaded).toBe(true);
            expect(mockChatClient.getMessageHistory).not.toHaveBeenCalled();
        });
    });
}); 