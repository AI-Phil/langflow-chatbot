import { LangflowChatClient } from '../clients/LangflowChatClient';
import { ChatWidget, ChatWidgetConfigOptions } from './ChatWidget';

export interface FloatingChatWidgetConfig {
    chatWidgetConfig?: ChatWidgetConfigOptions;
    position?: 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left';
    initialSessionId?: string;
    onSessionIdUpdate?: (sessionId: string) => void; // Added for session ID update callback
}

// Speech bubble SVG icon
const SPEECH_BUBBLE_ICON = `
<svg viewBox="0 0 24 24" fill="currentColor">
  <path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H6l-2 2V4h16v12z"/>
</svg>
`;

const MINUS_ICON = `
<svg viewBox="0 0 24 24" stroke="white" stroke-width="2">
  <line x1="5" y1="12" x2="19" y2="12" />
</svg>
`;


export class FloatingChatWidget {
    private config: Required<Omit<FloatingChatWidgetConfig, 'initialSessionId' | 'onSessionIdUpdate'>> & 
                    { initialSessionId?: string; onSessionIdUpdate?: (sessionId: string) => void; };
    private floatingButton: HTMLElement | null = null;
    private chatContainer: HTMLElement | null = null;
    private chatWidgetInstance: ChatWidget | null = null;
    private isChatVisible: boolean = false;
    private chatClient: LangflowChatClient;
    private enableStream: boolean;
    private initialSessionId?: string;
    private onSessionIdUpdateCallback?: (sessionId: string) => void; // Store callback

    constructor(
        chatClient: LangflowChatClient,
        enableStream: boolean = true,
        options: FloatingChatWidgetConfig = {}
    ) {
        this.chatClient = chatClient;
        this.enableStream = enableStream;
        this.initialSessionId = options.initialSessionId;
        this.onSessionIdUpdateCallback = options.onSessionIdUpdate; // Store callback

        this.config = {
            chatWidgetConfig: options.chatWidgetConfig || {},
            position: options.position || 'bottom-right',
        };

        this._createElements();
        this._setupEventListeners();
    }

    private _createElements(): void {
        this.floatingButton = document.createElement('div');
        this.floatingButton.className = `floating-chat-button ${this.config.position}`;
        this.floatingButton.innerHTML = SPEECH_BUBBLE_ICON;
        document.body.appendChild(this.floatingButton);

        this.chatContainer = document.createElement('div');
        this.chatContainer.className = `floating-chat-panel ${this.config.position}`;
        
        const header = document.createElement('div');
        header.className = 'chat-widget-header';
        
        const titleSpan = document.createElement('span');
        titleSpan.className = 'chat-widget-title-text';
        titleSpan.textContent = this.config.chatWidgetConfig?.widgetTitle || "Chat with Assistant";
        
        const minimizeButton = document.createElement('button');
        minimizeButton.className = 'minimize-button';
        minimizeButton.innerHTML = MINUS_ICON;
        minimizeButton.onclick = () => this.toggleChatVisibility();
        
        header.appendChild(titleSpan);
        header.appendChild(minimizeButton);
        this.chatContainer.appendChild(header);

        const chatWidgetDiv = document.createElement('div');
        const chatWidgetInnerId = `chat-widget-inner-container-${Date.now()}-${Math.random().toString(36).substring(2)}`;
        chatWidgetDiv.id = chatWidgetInnerId;
        chatWidgetDiv.className = 'chat-widget-inner-host';

        this.chatContainer.appendChild(chatWidgetDiv);
        document.body.appendChild(this.chatContainer);

        try {
            this.chatWidgetInstance = new ChatWidget(
                chatWidgetInnerId,
                this.chatClient,
                this.enableStream,
                {
                    ...this.config.chatWidgetConfig,
                    widgetTitle: undefined
                },
                this.initialSessionId,
                this.onSessionIdUpdateCallback // Pass callback to ChatWidget
            );

        } catch (error) {
            console.error("FloatingChatWidget: Failed to instantiate ChatWidget.", error);
            chatWidgetDiv.innerHTML = '<p class="chat-load-error">Error: Could not load chat.</p>';
        }

        if (this.isChatVisible) {
            if(this.chatContainer) this.chatContainer.style.display = 'flex';
            if(this.floatingButton) this.floatingButton.style.display = 'none';
        } else {
            if(this.chatContainer) this.chatContainer.style.display = 'none';
            if(this.floatingButton) this.floatingButton.style.display = 'flex';
        }
    }

    private _setupEventListeners(): void {
        if (this.floatingButton) {
            this.floatingButton.addEventListener('click', () => this.toggleChatVisibility());
        }
    }

    public toggleChatVisibility(): void {
        this.isChatVisible = !this.isChatVisible;
        if (this.chatContainer && this.floatingButton) {
            if (this.isChatVisible) {
                this.chatContainer.style.display = 'flex';
                this.floatingButton.style.display = 'none';
            } else {
                this.chatContainer.style.display = 'none';
                this.floatingButton.style.display = 'flex';
            }
        }
    }

    public showChat(): void {
        if (!this.isChatVisible) {
            this.toggleChatVisibility();
        }
    }

    public hideChat(): void {
        if (this.isChatVisible) {
            this.toggleChatVisibility();
        }
    }

    public destroy(): void {
        if (this.chatWidgetInstance && typeof (this.chatWidgetInstance as any).destroy === 'function') {
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
    }
} 