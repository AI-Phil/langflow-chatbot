import { LangflowChatClient } from '../clients/LangflowChatClient';
import { ChatWidget, ChatWidgetConfigOptions } from './ChatWidget';

export interface FloatingChatWidgetConfig {
    chatWidgetConfig?: ChatWidgetConfigOptions;
    position?: 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left';
    widgetTitle?: string;
    // More config options for the floater itself can be added here
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
    private config: Required<FloatingChatWidgetConfig>;
    private floatingButton: HTMLElement | null = null;
    private chatContainer: HTMLElement | null = null;
    private chatWidgetInstance: ChatWidget | null = null;
    private isChatVisible: boolean = false;
    private chatClient: LangflowChatClient;
    private inputFlowIdOrName: string;
    private enableStream: boolean;

    constructor(
        chatClient: LangflowChatClient,
        inputFlowIdOrName: string,
        enableStream: boolean = true,
        options: FloatingChatWidgetConfig = {}
    ) {
        this.chatClient = chatClient;
        this.inputFlowIdOrName = inputFlowIdOrName;
        this.enableStream = enableStream;

        this.config = {
            chatWidgetConfig: options.chatWidgetConfig || {},
            position: options.position || 'bottom-right',
            widgetTitle: options.widgetTitle || "Chat with Assistant",
        };

        this._createElements();
        this._setupEventListeners();
    }

    private _createElements(): void {
        // Create floating button
        this.floatingButton = document.createElement('div');
        this.floatingButton.className = `floating-chat-button ${this.config.position}`;
        this.floatingButton.innerHTML = SPEECH_BUBBLE_ICON;
        document.body.appendChild(this.floatingButton);

        // Create chat widget container
        this.chatContainer = document.createElement('div');
        this.chatContainer.className = `chat-widget-container ${this.config.position}`;
        
        // Create header
        const header = document.createElement('div');
        header.className = 'floating-chat-header';
        
        const titleSpan = document.createElement('span');
        titleSpan.className = 'title';
        titleSpan.textContent = this.config.widgetTitle;
        
        const minimizeButton = document.createElement('button');
        minimizeButton.className = 'minimize-button';
        minimizeButton.innerHTML = MINUS_ICON; // Placeholder, can be an SVG or better icon
        minimizeButton.onclick = () => this.toggleChatVisibility(); // Minimize also toggles
        
        header.appendChild(titleSpan);
        header.appendChild(minimizeButton);
        this.chatContainer.appendChild(header);

        // Create a div where the actual ChatWidget will be rendered
        const chatWidgetDiv = document.createElement('div');
        const chatWidgetInnerId = `chat-widget-inner-container-${Date.now()}-${Math.random().toString(36).substring(2)}`;
        chatWidgetDiv.id = chatWidgetInnerId;
        // Set a specific height for the inner chat widget area
        // This is crucial for the ChatWidget's internal scrolling to work correctly.
        // e.g., 400px height for message area + input area
        chatWidgetDiv.style.height = 'calc(100% - 40px)'; // Assuming header is 40px
        chatWidgetDiv.style.display = 'flex';
        chatWidgetDiv.style.flexDirection = 'column';


        this.chatContainer.appendChild(chatWidgetDiv);
        document.body.appendChild(this.chatContainer);

        // Instantiate ChatWidget inside the chatWidgetDiv
        try {
            this.chatWidgetInstance = new ChatWidget(
                chatWidgetInnerId, // The ID of the div we just created
                this.chatClient,
                this.inputFlowIdOrName,
                this.enableStream,
                this.config.chatWidgetConfig
            );
             // Adjust ChatWidget's main element style if needed.
            // The ChatWidget's main element is chatWidgetDiv.firstElementChild
            // We want ChatWidget to fill the chatWidgetDiv.
            const chatWidgetMainElement = document.getElementById(chatWidgetInnerId)?.querySelector('.chat-widget');
            if (chatWidgetMainElement) {
                 // (chatWidgetMainElement as HTMLElement).style.height = '100%';
                 // (chatWidgetMainElement as HTMLElement).style.maxHeight = '100%';
                 // The above might be handled by CSS: .chat-widget-container #chat-widget-inner-container .chat-widget
            }

        } catch (error) {
            console.error("FloatingChatWidget: Failed to instantiate ChatWidget.", error);
            // Optionally display an error message in the chatContainer
            chatWidgetDiv.innerHTML = '<p style="color: red; padding: 10px;">Error: Could not load chat.</p>';
        }

        // Explicitly set initial visibility state
        if (this.isChatVisible) { // Should be false by default
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
                this.chatContainer.style.display = 'flex'; // Use flex as it's a flex container
                this.floatingButton.style.display = 'none'; // Hide button when chat is visible
            } else {
                this.chatContainer.style.display = 'none';
                this.floatingButton.style.display = 'flex'; // Show button when chat is hidden
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
        if (this.floatingButton) {
            this.floatingButton.remove();
            this.floatingButton = null;
        }
        if (this.chatContainer) {
            this.chatContainer.remove();
            this.chatContainer = null;
        }
        // Potentially add a destroy method to ChatWidget and call it here
        this.chatWidgetInstance = null; 
        // Remove styles if no other instances are present (more complex, skip for now)
    }
} 