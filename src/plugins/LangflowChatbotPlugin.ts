// LangflowChatbotPlugin.ts
import { LangflowChatClient } from '../clients/LangflowChatClient';

export interface LangflowChatbotConfig {
  containerId?: string; // Required for embedded
  flowId: string;
  sessionId?: string;
  useFloating?: boolean;
  enableStream?: boolean;
  widgetTitle?: string;
  userSender?: string;
  botSender?: string;
  messageTemplate?: string;
  floatPosition?: 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left';
  // Future: onError, onMessage, etc.
}

export class LangflowChatbotInstance {
  private config: LangflowChatbotConfig;
  private chatClient: any;
  private widgetInstance: any;
  // Placeholder for future event system
  // private listeners: { [event: string]: Function[] } = {};

  constructor(config: LangflowChatbotConfig) {
    this.config = { ...config };
    this.init();
  }

  private init() {
    // Create chat client
    if (this.config.sessionId) {
      this.chatClient = new (window as any).LangflowChatbot.LangflowChatClient('/api/langflow', this.config.sessionId);
    } else {
      this.chatClient = new (window as any).LangflowChatbot.LangflowChatClient('/api/langflow');
    }

    // Core widget config
    const coreChatConfig = {
      userSender: this.config.userSender || 'Me',
      botSender: this.config.botSender || 'Assistant',
      messageTemplate: this.config.messageTemplate || `\n<div class="{{messageClasses}} message-block">\n  <div class="sender-name-display">{{sender}}</div>\n  <div class="message-bubble">\n    <span class="message-text-content">{{message}}</span>\n  </div>\n</div>\n`,
      widgetTitle: this.config.widgetTitle || 'Chat Assistant',
    };

    // Destroy any previous instance (if re-init)
    this.destroy();

    if (this.config.useFloating) {
      // Hide embedded container if present
      if (this.config.containerId) {
        const chatContainer = document.getElementById(this.config.containerId);
        if (chatContainer) chatContainer.style.display = 'none';
      }
      if ((window as any).LangflowChatbot.FloatingChatWidget) {
        this.widgetInstance = new (window as any).LangflowChatbot.FloatingChatWidget(
          this.chatClient,
          this.config.flowId,
          !!this.config.enableStream,
          {
            chatWidgetConfig: coreChatConfig,
            position: this.config.floatPosition || 'bottom-right',
          }
        );
      } else {
        throw new Error('FloatingChatWidget component not found.');
      }
    } else {
      // Show embedded container
      if (this.config.containerId) {
        const chatContainer = document.getElementById(this.config.containerId);
        if (chatContainer) {
          chatContainer.style.display = 'block';
          chatContainer.innerHTML = '';
        }
      }
      if (this.config.containerId && (window as any).LangflowChatbot.ChatWidget) {
        this.widgetInstance = new (window as any).LangflowChatbot.ChatWidget(
          this.config.containerId,
          this.chatClient,
          this.config.flowId,
          !!this.config.enableStream,
          coreChatConfig
        );
      } else {
        throw new Error('ChatWidget component not found or container missing.');
      }
    }
  }

  destroy() {
    if (this.widgetInstance && typeof this.widgetInstance.destroy === 'function') {
      this.widgetInstance.destroy();
      this.widgetInstance = null;
    }
    // Optionally clear embedded container
    if (!this.config.useFloating && this.config.containerId) {
      const chatContainer = document.getElementById(this.config.containerId);
      if (chatContainer) chatContainer.innerHTML = '';
    }
  }

  // Future-proof: stub for event system
  on(event: string, handler: Function) {
    // Placeholder for future event system
    // if (!this.listeners[event]) this.listeners[event] = [];
    // this.listeners[event].push(handler);
    // For now, do nothing
  }

  // Optionally, add resetSession, etc.
}

export function init(config: LangflowChatbotConfig): LangflowChatbotInstance {
  return new LangflowChatbotInstance(config);
} 