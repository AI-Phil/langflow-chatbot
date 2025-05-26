import { LangflowChatClient } from '../clients/LangflowChatClient';
import { ChatWidget, ChatWidgetConfigOptions } from './ChatWidget';
import { Logger, LogLevel } from '../utils/logger';
import { SVG_CHAT_ICON, SVG_MINIMIZE_ICON, DEFAULT_FLOATING_WIDGET_HEADER_TEMPLATE } from '../config/uiConstants';

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
    /** Optional custom width for the floating panel (e.g., '500px'). Applied as a CSS variable. */
    floatingPanelWidth?: string;
    /** Optional custom HTML template for the floating widget's header. */
    floatingWidgetHeaderTemplate?: string;
    /** Optional container ID for attaching listeners or custom behavior. The container element will be available via getContainerElement(). */
    containerId?: string;
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

/** 
 * Internal configuration structure for FloatingChatWidget after merging user-provided 
 * config with defaults. Ensures all necessary fields for the floating behavior are present.
 */
interface FloatingWidgetInternalConfig extends Required<Omit<FloatingChatWidgetConfig, 'chatWidgetConfig' | 'initialSessionId' | 'onSessionIdUpdate' | 'logLevel' | 'datetimeFormat' | 'floatingPanelWidth' | 'floatingWidgetHeaderTemplate' | 'containerId' >> {
    /** Configuration to be passed to the internal ChatWidget instance. Templates here are optional. */
    chatWidgetConfig: Partial<ChatWidgetConfigOptions>; 
    initialSessionId?: string;
    onSessionIdUpdate?: (sessionId: string) => void;
    logLevel?: LogLevel;
    datetimeFormat?: string;
    floatingPanelWidth?: string;
    floatingWidgetHeaderTemplate?: string;
    containerId?: string;
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
    private chatResetListener?: (event: Event) => void;

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
        const validatedPosition = FloatingChatWidget.validatePosition(userConfig.position ?? DEFAULT_FLOATING_CONFIG.position);
        this.logger = logger || new Logger(userConfig.logLevel || 'info', 'FloatingChatWidget');

        const resolvedFloatingWidgetTitle = userConfig.widgetTitle ?? DEFAULT_FLOATING_CONFIG.widgetTitle;

        const mergedFloatingConfig: FloatingWidgetInternalConfig = {
            isOpen: userConfig.isOpen ?? DEFAULT_FLOATING_CONFIG.isOpen,
            position: validatedPosition, 
            showCloseButton: userConfig.showCloseButton ?? DEFAULT_FLOATING_CONFIG.showCloseButton,
            showToggleButton: userConfig.showToggleButton ?? DEFAULT_FLOATING_CONFIG.showToggleButton,
            toggleButtonText: userConfig.toggleButtonText ?? DEFAULT_FLOATING_CONFIG.toggleButtonText,
            widgetTitle: resolvedFloatingWidgetTitle, 
            logLevel: userConfig.logLevel,
            initialSessionId: userConfig.initialSessionId,
            onSessionIdUpdate: userConfig.onSessionIdUpdate,
            datetimeFormat: userConfig.datetimeFormat,
            floatingPanelWidth: userConfig.floatingPanelWidth,
            floatingWidgetHeaderTemplate: userConfig.floatingWidgetHeaderTemplate,
            chatWidgetConfig: {
                labels: {
                    widgetTitle: resolvedFloatingWidgetTitle,
                    userSender: userConfig.chatWidgetConfig?.labels?.userSender,
                    botSender: userConfig.chatWidgetConfig?.labels?.botSender,
                    errorSender: userConfig.chatWidgetConfig?.labels?.errorSender,
                    systemSender: userConfig.chatWidgetConfig?.labels?.systemSender,
                    welcomeMessage: userConfig.chatWidgetConfig?.labels?.welcomeMessage,
                },
                template: {
                    mainContainerTemplate: userConfig.chatWidgetConfig?.template?.mainContainerTemplate,
                    inputAreaTemplate: userConfig.chatWidgetConfig?.template?.inputAreaTemplate,
                    messageTemplate: userConfig.chatWidgetConfig?.template?.messageTemplate,
                    widgetHeaderTemplate: userConfig.floatingWidgetHeaderTemplate || userConfig.chatWidgetConfig?.template?.widgetHeaderTemplate || DEFAULT_FLOATING_WIDGET_HEADER_TEMPLATE,
                },
                datetimeFormat: userConfig.chatWidgetConfig?.datetimeFormat,
            },
            containerId: userConfig.containerId,
        };
        this.config = mergedFloatingConfig;

        if (this.logger && typeof this.logger.info === 'function') {
            this.logger.info('FloatingChatWidget initialized with config:', this.config);
        }

        this._createElements();
        this._setupEventListeners();

        this.isChatVisible = this.config.isOpen;
        if (this.config.isOpen) {
            this.showChat(true);
        } else {
            this.hideChat(true);
        }
        document.body.appendChild(this.floatingButton!);
        document.body.appendChild(this.chatContainer!);

        if (this.config.floatingPanelWidth && this.chatContainer) {
            this.chatContainer.style.setProperty('--langflow-floating-panel-width', this.config.floatingPanelWidth);
            this.logger.info(`FloatingChatWidget: Panel width set to ${this.config.floatingPanelWidth} via config.`);
        }
    }

    /**
     * Creates the necessary DOM elements for the floating widget:
     * - The floating toggle button.
     * - The chat panel container, including its header (title, minimize button).
     * - The host div for the inner ChatWidget instance.
     * It then instantiates the inner ChatWidget within the host div.
     */
    private _createElements(): void {
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
                }
                .floating-chat-panel .chat-widget-title-text {
                    font-weight: bold;
                    font-size: 1em;
                    flex: 1 1 auto;
                    text-align: left;
                    margin-right: 1em;
                }
                .floating-chat-panel .chat-widget-minimize-button {
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

        this.floatingButton = document.createElement('div');
        this.floatingButton.className = `floating-chat-button ${this.config.position}`;
        this.floatingButton.innerHTML = SVG_CHAT_ICON;
        if (!this.config.showToggleButton) {
            this.floatingButton.style.display = 'none';
        }

        this.chatContainer = document.createElement('div');
        this.chatContainer.className = `floating-chat-panel ${this.config.position}`;
        
        const chatWidgetDiv = document.createElement('div');
        const chatWidgetInnerId = `chat-widget-inner-container-${Date.now()}-${Math.random().toString(36).substring(2)}`;
        chatWidgetDiv.id = chatWidgetInnerId;
        chatWidgetDiv.className = 'chat-widget-inner-host';
        this.chatContainer.appendChild(chatWidgetDiv);

        try {
            this.chatWidgetInstance = new ChatWidget(
                chatWidgetDiv,
                this.chatClient,
                this.enableStream,
                {
                    labels: this.config.chatWidgetConfig.labels,
                    template: this.config.chatWidgetConfig.template,
                    datetimeFormat: this.config.chatWidgetConfig.datetimeFormat,
                },
                this.logger,
                this.config.initialSessionId,
                this.config.onSessionIdUpdate
            );

            if (this.chatWidgetInstance) {
                const widgetElement = this.chatWidgetInstance.getWidgetElement();
                const minimizeButton = widgetElement.querySelector<HTMLButtonElement>('.chat-widget-minimize-button');
                if (minimizeButton) {
                    if (this.config.showCloseButton) {
                        minimizeButton.onclick = () => this.toggleChatVisibility();
                    } else {
                        minimizeButton.style.display = 'none';
                    }
                }

                // Listen for the chatReset event from the inner ChatWidget
                this.chatResetListener = (event) => {
                    this.logger.info('FloatingChatWidget: Detected chatReset event from inner ChatWidget. Re-dispatching.');
                    if (this.chatContainer) {
                        this.chatContainer.dispatchEvent(new CustomEvent('chatReset', { bubbles: true, composed: true }));
                    }
                };
                widgetElement.addEventListener('chatReset', this.chatResetListener);
            }

        } catch (error) {
            this.logger.error("Failed to instantiate ChatWidget.", error);
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
                this.floatingButton.style.display = 'none';
                this.scrollToBottomWhenVisible();
            } else {
                this.chatContainer.style.display = 'none';
                if (this.config.showToggleButton) {
                    this.floatingButton.style.display = 'flex';
                } else {
                    this.floatingButton.style.display = 'none';
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
            if (!initial) this.toggleChatVisibility();
            else {
                if (this.chatContainer) this.chatContainer.style.display = 'flex';
                if (this.floatingButton) {
                    this.floatingButton.style.display = 'none';
                }
                this.isChatVisible = true;
                this.scrollToBottomWhenVisible();
            }
        }
    }

    /**
     * Scrolls to bottom when the panel becomes visible.
     * Uses requestAnimationFrame to ensure the panel is fully rendered before scrolling.
     */
    private scrollToBottomWhenVisible(): void {
        if (this.chatWidgetInstance) {
            requestAnimationFrame(() => {
                if (this.chatWidgetInstance) {
                    const displayManager = (this.chatWidgetInstance as any).displayManager;
                    if (displayManager && typeof displayManager.scrollChatToBottom === 'function') {
                        displayManager.scrollChatToBottom();
                    }
                }
            });
        }
    }

    /**
     * Hides the chat panel.
     * @param {boolean} [initial=false] - If true, sets display style directly without toggling, for initial setup.
     */
    public hideChat(initial: boolean = false): void {
        if (this.isChatVisible || initial) {
            if (!initial) this.toggleChatVisibility();
            else {
                if (this.chatContainer) this.chatContainer.style.display = 'none';
                if (this.floatingButton) {
                    if (this.config.showToggleButton) {
                        this.floatingButton.style.display = 'flex';
                    } else {
                        this.floatingButton.style.display = 'none';
                    }
                }
                this.isChatVisible = false;
            }
        }
    }

    /**
     * Destroys the FloatingChatWidget instance.
     * This includes destroying the inner ChatWidget instance and removing the floating widget's DOM elements.
     */
    public destroy(): void {
        if (this.chatWidgetInstance && typeof (this.chatWidgetInstance as any).destroy === 'function') {
            // Remove event listener before destroying the inner widget
            const widgetElement = this.chatWidgetInstance.getWidgetElement();
            if (widgetElement && this.chatResetListener) {
                widgetElement.removeEventListener('chatReset', this.chatResetListener);
                this.chatResetListener = undefined;
            }
            (this.chatWidgetInstance as any).destroy();
        }
        this.chatWidgetInstance = null;

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

    /**
     * Returns the main DOM element for the chat panel.
     * @returns {HTMLElement | null} The chat panel element.
     */
    public getPanelElement(): HTMLElement | null {
        return this.chatContainer;
    }

    /**
     * Returns the container element for attaching listeners or custom behavior.
     * @returns {HTMLElement | null} The container element.
     */
    public getContainerElement(): HTMLElement | null {
        return this.config.containerId ? document.getElementById(this.config.containerId) : null;
    }
} 