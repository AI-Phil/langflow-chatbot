import { LangflowChatClient, ChatMessageData } from '../clients/LangflowChatClient';
import { Logger } from '../utils/logger';
import { normalizeLangflowTimestamp } from '../utils/datetimeUtils';
import { SenderConfig } from '../types';

/** Callbacks for UI display operations required by the ChatSessionManager. */
export interface SessionManagerDisplayCallbacks {
    /** Clears all messages from the display. */
    clearMessages: () => void;
    /** Adds a message to the display. */
    addMessage: (sender: string, message: string, isThinking?: boolean, datetime?: string) => HTMLElement | null;
    /** Scrolls the chat display to the bottom. */
    scrollChatToBottom: () => void;
}

/**
 * Manages chat sessions, including session ID state and chat history loading/display.
 */
export class ChatSessionManager {
    private client: LangflowChatClient;
    private config: SenderConfig;
    private displayCallbacks: SessionManagerDisplayCallbacks;
    private logger: Logger;
    private _currentSessionId: string | null = null;
    private _isHistoryLoaded: boolean = false;
    private welcomeMessage?: string;

    /**
     * Constructs a ChatSessionManager instance.
     * @param client The LangflowChatClient for API interactions.
     * @param config Configuration for sender names.
     * @param displayCallbacks Callbacks for UI display operations.
     * @param logger Logger instance.
     * @param initialSessionId Optional initial session ID to load history for.
     * @param welcomeMessage Optional message to display if chat history is empty.
     */
    constructor(
        client: LangflowChatClient,
        config: SenderConfig,
        displayCallbacks: SessionManagerDisplayCallbacks,
        logger: Logger,
        initialSessionId?: string,
        welcomeMessage?: string
    ) {
        this.client = client;
        this.config = config;
        this.displayCallbacks = displayCallbacks;
        this.logger = logger;
        this.welcomeMessage = welcomeMessage;

        if (initialSessionId) {
            this.logger.info(`ChatSessionManager: Initializing with session ID: ${initialSessionId}`);
            this.updateCurrentSessionId(initialSessionId); // Sets _currentSessionId and resets _isHistoryLoaded
            // Auto-load history if an initial session ID is provided.
            // The check for _isHistoryLoaded is implicitly false here due to updateCurrentSessionId.
            this.setSessionIdAndLoadHistory(initialSessionId);
        } else {
            this.logger.info("ChatSessionManager: Initialized without a session ID.");
            // If no initial session ID, and there's a welcome message, display it.
            // Ensure messages are cleared first, as there's no history to load that would do it.
            this.displayCallbacks.clearMessages();
            if (this.welcomeMessage) {
                this.displayCallbacks.addMessage(this.config.botSender, this.welcomeMessage, false);
                this.displayCallbacks.scrollChatToBottom();
            }
            this._isHistoryLoaded = true; // Mark as "loaded" as we've handled the initial state.
        }
    }

    /** Gets the current session ID. */
    public get currentSessionId(): string | null {
        return this._currentSessionId;
    }

    /** Indicates if the history for the current session has been loaded. */
    public get isHistoryLoaded(): boolean {
        return this._isHistoryLoaded;
    }

    /**
     * Updates the current session ID and resets the history loaded flag.
     * @param newSessionId The new session ID, or null to clear the session.
     */
    public updateCurrentSessionId(newSessionId: string | null): void {
        const oldSessionId = this._currentSessionId;
        if (newSessionId && oldSessionId !== newSessionId) {
            this._currentSessionId = newSessionId;
            this._isHistoryLoaded = false; // Reset flag when session ID changes
            this.logger.info(`Session ID updated to: ${this._currentSessionId}`);
        } else if (newSessionId === null && oldSessionId !== null) {
            this._currentSessionId = null;
            this._isHistoryLoaded = false; // Reset flag when session is cleared
            this.logger.info("Session ID cleared.");
        }
    }

    /**
     * Processes a session ID update that originated from a flow response.
     * This typically updates the internal session ID but does not automatically trigger history loading,
     * as the flow itself might manage message display or further interactions.
     * @param newSessionId The new session ID from the flow.
     */
    public processSessionIdUpdateFromFlow(newSessionId: string): void {
        this.logger.info(`ChatSessionManager: Session ID update from flow: ${newSessionId}`);
        if (this._currentSessionId !== newSessionId) {
            this.updateCurrentSessionId(newSessionId);
        }
    }

    /**
     * Loads and displays chat history messages.
     * This method clears existing messages before displaying the new history.
     * It determines sender types based on configuration and message data.
     * @param history An array of ChatMessageData objects representing the history.
     */
    public async loadAndDisplayHistory(history: ChatMessageData[]): Promise<void> {
        if (this._isHistoryLoaded && history.length === 0 && !this.currentSessionId) {
            // This case is less common if setSessionIdAndLoadHistory is the main entry point.
            // Allows re-check if history was empty & no session, then session appears.
        } else if (this._isHistoryLoaded) {
            this.logger.info("History already loaded or loading process was completed for the current session.");
            return;
        }

        this.logger.info("Loading and displaying history...");
        this.displayCallbacks.clearMessages();

        for (const rawMessage of history) {
            const messageText = rawMessage.text || "";
            let senderType: string;
            const rawSenderLower = rawMessage.sender?.toLowerCase();

            // Determine sender type, prioritizing configured names, then common keywords, then fallbacks.
            if (rawMessage.sender_name === this.config.userSender) {
                senderType = this.config.userSender;
            } else if (rawMessage.sender_name === this.config.botSender) {
                senderType = this.config.botSender;
            } else if (rawSenderLower === 'user') {
                senderType = this.config.userSender;
            } else if (rawSenderLower === 'bot' || rawSenderLower === 'machine') { // 'machine' is another common term for bot
                senderType = this.config.botSender;
            } else if (rawMessage.sender_name) { 
                senderType = rawMessage.sender_name; // Use sender_name if available but didn't match known config
            } else {
                senderType = this.config.systemSender; // Ultimate fallback
                this.logger.warn(`Unidentified sender in history: rawMessage.sender='${rawMessage.sender}', rawMessage.sender_name='${rawMessage.sender_name}'. Defaulting to systemSender.`);
            }
            
            const normalizedTimestamp = normalizeLangflowTimestamp(rawMessage.timestamp);

            this.displayCallbacks.addMessage(
                senderType,
                messageText,
                false, // History messages are not "thinking" indicators
                normalizedTimestamp
            );
        }
        this._isHistoryLoaded = true;
        this.displayCallbacks.scrollChatToBottom();
        this.logger.info("History loaded and displayed.");
    }

    /**
     * Sets the session ID and loads/displays its history.
     * If no session ID is provided (or it's empty), the current session is cleared.
     * @param sessionId The session ID to set. If undefined or empty, clears the session.
     */
    public async setSessionIdAndLoadHistory(sessionId?: string): Promise<void> {
        if (sessionId && sessionId.trim() !== "") {
            if (this._currentSessionId !== sessionId || !this._isHistoryLoaded) {
                this.logger.info(`Setting session ID to: ${sessionId} and loading history.`);
                this.updateCurrentSessionId(sessionId); // Updates ID and resets history loaded flag

                try {
                    const historyData = await this.client.getMessageHistory(sessionId);
                    if (historyData && historyData.length > 0) {
                        await this.loadAndDisplayHistory(historyData);
                    } else {
                        this.logger.info("No history data found for the session, or history is empty.");
                        this.displayCallbacks.clearMessages(); // Clear display if history is empty
                        if (this.welcomeMessage) {
                            this.displayCallbacks.addMessage(this.config.botSender, this.welcomeMessage, false);
                            this.displayCallbacks.scrollChatToBottom();
                        }
                        this._isHistoryLoaded = true; // Mark as loaded even if history was empty
                    }
                } catch (error) {
                    this.logger.error("Error loading chat history:", error);
                    this.displayCallbacks.addMessage(this.config.errorSender, "Error loading chat history.");
                    this._isHistoryLoaded = true; // Mark as loaded to prevent retry loops on error
                }
            } else {
                this.logger.info(`Session ID is already ${sessionId} and history is loaded.`);
            }
        } else {
            this.logger.info("No session ID provided, or session ID is empty. Clearing session and messages.");
            this.updateCurrentSessionId(null);
            this.displayCallbacks.clearMessages();
            if (this.welcomeMessage) {
                this.displayCallbacks.addMessage(this.config.botSender, this.welcomeMessage, false);
                this.displayCallbacks.scrollChatToBottom();
            }
            this._isHistoryLoaded = true; // Mark as "loaded" (i.e., processed empty/cleared state)
        }
    }
} 