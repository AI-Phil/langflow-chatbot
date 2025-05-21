import { LangflowChatClient } from '../clients/LangflowChatClient';
import { ChatWidget, ChatWidgetConfigOptions } from './ChatWidget';
import { Logger, LogLevel } from '../utils/logger';

/**
 * Configuration options for the FloatingChatWidget.
 */
export interface FloatingChatWidgetConfig {
    /** Configuration options to pass down to the underlying ChatWidget instance. */
    chatWidgetConfig?: Partial<ChatWidgetConfigOptions>;
    /** Position of the floating widget on the screen. */
    position?: 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left';
    /** Optional initial session ID to pass to the ChatWidget. */
    initialSessionId?: string;
    /** Optional callback for when the session ID is updated by the ChatWidget. */
    onSessionIdUpdate?: (sessionId: string) => void;
    /** Optional datetime format string to pass to the ChatWidget. */
    datetimeFormat?: string;
    /** Whether the chat panel should be open 부담initialization. */
    isOpen?: boolean;
    /** Whether to show the close/minimize button on the chat panel header. */
    showCloseButton?: boolean;
    /** Whether to show the floating toggle button. */
    showToggleButton?: boolean;
    /** Text content for the floating toggle button (if shown). */
    toggleButtonText?: string; // This was not used for the icon button, but could be for a text button
    /** Title displayed in the header of the chat panel. */
    widgetTitle?: string;
    /** Desired log level for the widget's logger. */
    logLevel?: LogLevel;
}

/** Helper interface defining the structure for default floating widget-specific config values. */
interface DefaultFloatingConfigValues {
    isOpen: boolean;
    position: 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left';
    showCloseButton: boolean;
    showToggleButton: boolean;
    toggleButtonText: string;
    widgetTitle: string;
}

/** Default configuration values for the FloatingChatWidget's appearance and behavior. */
const DEFAULT_FLOATING_CONFIG: DefaultFloatingConfigValues = {
    isOpen: false,
    position: 'bottom-right',
    showCloseButton: true,
    showToggleButton: true,
    toggleButtonText: 'Chat', // Default text, though current implementation uses an icon
    widgetTitle: 'Chatbot',
};

/** SVG string for the speech bubble icon used on the floating toggle button. */
const SPEECH_BUBBLE_ICON = `
<svg viewBox="0 0 24 24" fill="currentColor">
  <path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H6l-2 2V4h16v12z"/>
</svg>
`;

/** SVG string for the minus icon used on the minimize button in the chat panel header. */
const MINUS_ICON = `
<svg viewBox="0 0 24 24" stroke-width="2">
  <line x1="5" y1="12" x2="19" y2="12" />
</svg>
`;

/** 
 * Internal configuration structure for FloatingChatWidget after merging user-provided 
 * config with defaults. Ensures all necessary fields for the floating behavior are present.
 */
interface FloatingWidgetInternalConfig extends Required<Omit<FloatingChatWidgetConfig, 'chatWidgetConfig' | 'initialSessionId' | 'onSessionIdUpdate' | 'logLevel' | 'datetimeFormat' >> {
    /** Configuration to be passed to the internal ChatWidget instance. Templates here are optional. */
    chatWidgetConfig: Partial<ChatWidgetConfigOptions>; 
    initialSessionId?: string;
    onSessionIdUpdate?: (sessionId: string) => void;
    logLevel?: LogLevel;
    datetimeFormat?: string;
}

/**
 * Provides a floating, toggleable chat interface that wraps the main ChatWidget.
 * Manages the visibility and placement of the chat panel and the toggle button.
 */
export class FloatingChatWidget {
    private config: FloatingWidgetInternalConfig;
    private floatingButton: HTMLElement | null = null;
    private chatContainer: HTMLElement | null = null;
    private chatWidgetInstance: ChatWidget | null = null;
    private isChatVisible: boolean = false;
    private chatClient: LangflowChatClient;
    private enableStream: boolean;
    private logger: Logger;

    private static validatePosition(pos: any): 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left' {
        const allowedPositions = ['bottom-right', 'bottom-left', 'top-right', 'top-left'];
        return allowedPositions.includes(pos) ? pos : 'bottom-right';
    }

    /**
     * Constructs a FloatingChatWidget instance.
     * @param {LangflowChatClient} chatClient - The client for API interactions.
     * @param {boolean} [enableStream=true] - Whether to enable streaming for bot responses (passed to ChatWidget).
     * @param {FloatingChatWidgetConfig} [userConfig={}] - User-provided configuration options.
     * @param {Logger} [logger] - Optional logger instance. If not provided, a new one is created.
     */
    constructor(
        chatClient: LangflowChatClient,
        enableStream: boolean = true,
        userConfig: FloatingChatWidgetConfig = {},
        logger?: Logger
    ) {
        this.chatClient = chatClient;
        this.enableStream = enableStream;
        // Validate position before merging config
        const validatedPosition = FloatingChatWidget.validatePosition(userConfig.position ?? DEFAULT_FLOATING_CONFIG.position);
        // Initialize logger: use provided one or create a new one with log level from userConfig or default to 'info'.
        this.logger = logger || new Logger(userConfig.logLevel || 'info', 'FloatingChatWidget');

        // Merge user-provided configuration with defaults.
        const mergedFloatingConfig: FloatingWidgetInternalConfig = {
            isOpen: userConfig.isOpen ?? DEFAULT_FLOATING_CONFIG.isOpen,
            position: validatedPosition, // Use the validated position
            showCloseButton: userConfig.showCloseButton ?? DEFAULT_FLOATING_CONFIG.showCloseButton,
            showToggleButton: userConfig.showToggleButton ?? DEFAULT_FLOATING_CONFIG.showToggleButton,
            toggleButtonText: userConfig.toggleButtonText ?? DEFAULT_FLOATING_CONFIG.toggleButtonText,
            widgetTitle: userConfig.widgetTitle ?? DEFAULT_FLOATING_CONFIG.widgetTitle,
            logLevel: userConfig.logLevel,
            initialSessionId: userConfig.initialSessionId,
            onSessionIdUpdate: userConfig.onSessionIdUpdate,
            datetimeFormat: userConfig.datetimeFormat,
            chatWidgetConfig: {
                ...(userConfig.chatWidgetConfig || {}),
                mainContainerTemplate: userConfig.chatWidgetConfig?.mainContainerTemplate,
                inputAreaTemplate: userConfig.chatWidgetConfig?.inputAreaTemplate,
                messageTemplate: userConfig.chatWidgetConfig?.messageTemplate,
                widgetTitle: undefined, 
                datetimeFormat: userConfig.datetimeFormat || userConfig.chatWidgetConfig?.datetimeFormat,
            }
        };
        this.config = mergedFloatingConfig;

        // Log the merged config if a logger is available (useful for tests)
        if (this.logger && typeof this.logger.info === 'function') {
            this.logger.info('FloatingChatWidget initialized with config:', this.config);
        }

        this._createElements();
        this._setupEventListeners();

        this.isChatVisible = this.config.isOpen;
        if (this.config.isOpen) {
            this.showChat(true); // Show initially if configured
        } else {
            this.hideChat(true); // Hide initially if configured
        }
        // Append the created elements to the document body.
        document.body.appendChild(this.floatingButton!);
        document.body.appendChild(this.chatContainer!);
    }

    /**
     * Creates the necessary DOM elements for the floating widget:
     * - The floating toggle button.
     * - The chat panel container, including its header (title, minimize button).
     * - The host div for the inner ChatWidget instance.
     * It then instantiates the inner ChatWidget within the host div.
     */
    private _createElements(): void {
        // Inject CSS for header layout if not already present
        if (!document.getElementById('floating-chat-widget-header-style')) {
            const style = document.createElement('style');
            style.id = 'floating-chat-widget-header-style';
            style.textContent = `
                .floating-chat-panel .chat-widget-header {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    padding: 0.5em 1em;
                    border-bottom: 1px solid #eee;
                    /* background: #f0f0f0; */ /* Removed to use CSS var --langflow-chatbot-header-background */
                }
                .floating-chat-panel .chat-widget-title-text {
                    font-weight: bold;
                    font-size: 1em;
                    flex: 1 1 auto;
                    text-align: left;
                    margin-right: 1em;
                    /* color: #333; */ /* Removed to use CSS var --langflow-chatbot-header-text-color */
                }
                .floating-chat-panel .minimize-button {
                    background: none;
                    border: none;
                    cursor: pointer;
                    padding: 0.25em;
                    margin-left: 0.5em;
                    display: flex;
                    align-items: center;
                }
            `;
            document.head.appendChild(style);
        }

        // Create floating toggle button
        this.floatingButton = document.createElement('div');
        this.floatingButton.className = `floating-chat-button ${this.config.position}`;
        this.floatingButton.innerHTML = SPEECH_BUBBLE_ICON; // Uses SVG icon
        // Respect showToggleButton: if false, always hide
        if (!this.config.showToggleButton) {
            this.floatingButton.style.display = 'none';
        }

        // Create chat panel container
        this.chatContainer = document.createElement('div');
        this.chatContainer.className = `floating-chat-panel ${this.config.position}`;
        
        // Create chat panel header
        const header = document.createElement('div');
        header.className = 'chat-widget-header';
        
        const titleSpan = document.createElement('span');
        titleSpan.className = 'chat-widget-title-text';
        titleSpan.textContent = this.config.widgetTitle;
        
        const minimizeButton = document.createElement('button');
        minimizeButton.className = 'minimize-button';
        minimizeButton.innerHTML = MINUS_ICON; // Uses SVG icon
        minimizeButton.onclick = () => this.toggleChatVisibility();
        
        // Append title first, then minimize button (button right)
        header.appendChild(titleSpan);
        if (this.config.showCloseButton) {
            header.appendChild(minimizeButton);
        }
        this.chatContainer.appendChild(header);

        // Create host div for the inner ChatWidget
        const chatWidgetDiv = document.createElement('div');
        // Generate a unique ID for the inner ChatWidget container, though ChatWidget now accepts HTMLElement directly.
        const chatWidgetInnerId = `chat-widget-inner-container-${Date.now()}-${Math.random().toString(36).substring(2)}`;
        chatWidgetDiv.id = chatWidgetInnerId;
        chatWidgetDiv.className = 'chat-widget-inner-host';
        this.chatContainer.appendChild(chatWidgetDiv);

        // Instantiate the inner ChatWidget
        try {
            this.chatWidgetInstance = new ChatWidget(
                chatWidgetDiv, // Pass the created div element directly
                this.chatClient,
                this.enableStream,
                this.config.chatWidgetConfig, // Pass the prepared config for ChatWidget
                this.logger, 
                this.config.initialSessionId,
                this.config.onSessionIdUpdate
            );
        } catch (error) {
            this.logger.error("Failed to instantiate ChatWidget.", error);
            // Display an error message within the chat widget area if instantiation fails.
            chatWidgetDiv.innerHTML = '<p class="chat-load-error">Error: Could not load chat.</p>';
        }
    }

    /**
     * Sets up event listeners for the floating widget, primarily for the toggle button.
     */
    private _setupEventListeners(): void {
        if (this.floatingButton) {
            this.floatingButton.addEventListener('click', () => this.toggleChatVisibility());
        }
    }

    /**
     * Toggles the visibility of the chat panel and the floating button.
     */
    public toggleChatVisibility(): void {
        this.isChatVisible = !this.isChatVisible;
        if (this.chatContainer && this.floatingButton) {
            if (this.isChatVisible) {
                this.chatContainer.style.display = 'flex';
                this.floatingButton.style.display = 'none'; // Always hide button when chat is open
            } else {
                this.chatContainer.style.display = 'none';
                if (this.config.showToggleButton) {
                    this.floatingButton.style.display = 'flex'; // Show button if allowed
                } else {
                    this.floatingButton.style.display = 'none'; // Keep button hidden if not allowed
                }
            }
        }
    }

    /**
     * Shows the chat panel.
     * @param {boolean} [initial=false] - If true, sets display style directly without toggling, for initial setup.
     */
    public showChat(initial: boolean = false): void {
        if (!this.isChatVisible || initial) {
            if (!initial) this.toggleChatVisibility(); // Toggle only if not initial setup and currently hidden
            else { // For initial setup, just set styles if meant to be open
                if (this.chatContainer) this.chatContainer.style.display = 'flex';
                if (this.floatingButton) {
                    this.floatingButton.style.display = 'none'; // Always hide button when chat is open
                }
                this.isChatVisible = true; // Ensure state is correct for initial direct show
            }
        }
    }

    /**
     * Hides the chat panel.
     * @param {boolean} [initial=false] - If true, sets display style directly without toggling, for initial setup.
     */
    public hideChat(initial: boolean = false): void {
        if (this.isChatVisible || initial) {
            if (!initial) this.toggleChatVisibility(); // Toggle only if not initial setup and currently visible
            else { // For initial setup, just set styles if meant to be closed
                if (this.chatContainer) this.chatContainer.style.display = 'none';
                if (this.floatingButton) {
                    if (this.config.showToggleButton) {
                        this.floatingButton.style.display = 'flex'; // Show button if allowed
                    } else {
                        this.floatingButton.style.display = 'none'; // Keep button hidden if not allowed
                    }
                }
                this.isChatVisible = false; // Ensure state is correct for initial direct hide
            }
        }
    }

    /**
     * Destroys the FloatingChatWidget instance.
     * This includes destroying the inner ChatWidget instance and removing the floating widget's DOM elements.
     */
    public destroy(): void {
        // Destroy the inner ChatWidget instance if it exists
        if (this.chatWidgetInstance && typeof (this.chatWidgetInstance as any).destroy === 'function') {
            (this.chatWidgetInstance as any).destroy();
        }
        this.chatWidgetInstance = null;

        // Remove DOM elements from the document body
        if (this.floatingButton) {
            this.floatingButton.remove();
            this.floatingButton = null;
        }
        if (this.chatContainer) {
            this.chatContainer.remove();
            this.chatContainer = null;
        }
        this.logger.info("FloatingChatWidget instance destroyed.");
    }
} 