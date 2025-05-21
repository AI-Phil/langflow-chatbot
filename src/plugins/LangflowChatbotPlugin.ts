// LangflowChatbotPlugin.ts
import { LangflowChatClient } from '../clients/LangflowChatClient';
import { PROXY_BASE_API_PATH, PROXY_CONFIG_ENDPOINT_PREFIX } from '../config/apiPaths';
import { ChatWidget, FloatingChatWidget } from '../components';
import { Logger, LogLevel } from '../components/logger';

// Interface for the initial configuration passed to the plugin's init function
export interface LangflowChatbotInitConfig {
  proxyEndpointId: string;
  containerId?: string; // Required for embedded mode
  sessionId?: string;
  // These are now primarily driven by server config, but can be specified as initial overrides if needed,
  // or simply to define the type structure for the merged config.
  useFloating?: boolean;
  enableStream?: boolean;
  widgetTitle?: string;
  userSender?: string;
  botSender?: string;
  messageTemplate?: string;
  mainContainerTemplate?: string; // from server
  inputAreaTemplate?: string;   // from server
  floatPosition?: 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left';
  // Callback for when the session ID is updated internally by the widget
  onSessionIdChanged?: (sessionId: string) => void; // Added this for plugin to widget communication
  logLevel?: LogLevel; // Add logLevel option
  datetimeFormat?: string; // Added datetimeFormat
}

// Interface for the full configuration after fetching from server (matches ChatbotProfile on server, minus flowId)
interface FullChatbotProfile extends Omit<LangflowChatbotInitConfig, 'proxyEndpointId' | 'containerId' | 'sessionId' | 'onSessionIdChanged'> {
  // All fields from ChatbotProfile on server side (excluding flowId)
  // Example fields (ensure these match what your server provides):
  enableStream?: boolean;
  useFloating?: boolean;
  floatPosition?: "bottom-right" | "bottom-left" | "top-right" | "top-left";
  widgetTitle?: string;
  userSender?: string;
  botSender?: string;
  errorSender?: string; 
  systemSender?: string;
  messageTemplate?: string;
  mainContainerTemplate?: string;
  inputAreaTemplate?: string;
  logLevel?: LogLevel; // Add logLevel option
  datetimeFormat?: string; // Added datetimeFormat
}

// Default templates are now managed by ChatTemplateManager and ChatWidget
// const DEFAULT_PLUGIN_MAIN_CONTAINER_TEMPLATE = `...`; // REMOVED
// const DEFAULT_PLUGIN_INPUT_AREA_TEMPLATE = `...`; // REMOVED
// const DEFAULT_PLUGIN_MESSAGE_TEMPLATE = `...`; // REMOVED

export class LangflowChatbotInstance {
  private initialConfig: LangflowChatbotInitConfig;
  private serverProfile!: FullChatbotProfile; // Will be fetched
  private chatClient!: LangflowChatClient;
  private widgetInstance: any; // Placeholder for ChatWidget or FloatingChatWidget
  private isInitialized: boolean = false;
  private listeners: { [event: string]: Array<(data: any) => void> } = {}; // For emitting events like sessionChanged
  private logger: Logger; // Use Logger type

  constructor(config: LangflowChatbotInitConfig) {
    this.initialConfig = { ...config };
    // Initialize logger
    this.logger = new Logger(config.logLevel || 'info', 'LangflowChatbot');
    // init is now async and called by the factory function
  }

  // Method for clients to subscribe to events
  public on(event: string, handler: (data: any) => void): void {
    if (!this.listeners[event]) {
      this.listeners[event] = [];
    }
    this.listeners[event].push(handler);
  }

  // Method for the instance to emit events
  private _emit(event: string, data: any): void {
    if (this.listeners[event]) {
      this.listeners[event].forEach(handler => {
        try {
          handler(data);
        } catch (error) {
          this.logger.error(`Error in event handler for '${event}':`, error);
        }
      });
    }
  }

  private _handleInternalSessionIdUpdate = (sessionId: string): void => {
    this._emit('sessionChanged', sessionId);
  }

  async init(): Promise<void> {
    if (this.isInitialized) {
      this.logger.warn("LangflowChatbotInstance already initialized. Call destroy() first to re-initialize.");
      this.destroy(); // Clean up before re-initializing
    }

    try {
      // 1. Fetch server configuration
      const configUrl = `${PROXY_BASE_API_PATH}${PROXY_CONFIG_ENDPOINT_PREFIX}/${this.initialConfig.proxyEndpointId}`;
      this.logger.info(`Fetching configuration from ${configUrl}`);
      const response = await fetch(configUrl);

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to fetch chatbot configuration for '${this.initialConfig.proxyEndpointId}'. Status: ${response.status}. Details: ${errorText}`);
      }
      this.serverProfile = await response.json() as FullChatbotProfile;
      this.logger.debug("Received server profile:", this.serverProfile);

      // 2. Create chat client
      this.chatClient = new LangflowChatClient(this.initialConfig.proxyEndpointId, undefined, this.logger);
      
      // 3. Prepare widget configuration
      const mergedConfig = {
        ...this.serverProfile,
        userSender: this.serverProfile.userSender || this.initialConfig.userSender || 'Me',
        botSender: this.serverProfile.botSender || this.initialConfig.botSender || 'Assistant',
        widgetTitle: this.serverProfile.widgetTitle || this.initialConfig.widgetTitle || 'Chat Assistant',
        // Templates: Prioritize server, then initial config. If neither, pass undefined.
        // ChatTemplateManager will apply defaults within ChatWidget.
        messageTemplate: this.serverProfile.messageTemplate || this.initialConfig.messageTemplate,
        mainContainerTemplate: this.serverProfile.mainContainerTemplate || this.initialConfig.mainContainerTemplate,
        inputAreaTemplate: this.serverProfile.inputAreaTemplate || this.initialConfig.inputAreaTemplate,
        enableStream: this.serverProfile.enableStream !== undefined ? this.serverProfile.enableStream : this.initialConfig.enableStream,
        useFloating: this.serverProfile.useFloating !== undefined ? this.serverProfile.useFloating : this.initialConfig.useFloating,
        floatPosition: this.serverProfile.floatPosition || this.initialConfig.floatPosition || 'bottom-right',
        datetimeFormat: this.serverProfile.datetimeFormat || this.initialConfig.datetimeFormat // Added datetimeFormat
      };
      
      // 4. Instantiate the appropriate widget
      const clientWantsFloating = mergedConfig.useFloating;
      const effectiveEnableStream = !!mergedConfig.enableStream;

      const onSessionIdUpdateCallback = this.initialConfig.onSessionIdChanged || this._handleInternalSessionIdUpdate;

      if (clientWantsFloating) {
        if (this.initialConfig.containerId) {
          const chatContainer = document.getElementById(this.initialConfig.containerId);
          if (chatContainer) chatContainer.style.display = 'none';
        }
        this.widgetInstance = new FloatingChatWidget(
          this.chatClient,
          effectiveEnableStream,
          {
            widgetTitle: mergedConfig.widgetTitle,
            chatWidgetConfig: {
              userSender: mergedConfig.userSender,
              botSender: mergedConfig.botSender,
              messageTemplate: mergedConfig.messageTemplate,
              mainContainerTemplate: mergedConfig.mainContainerTemplate,
              inputAreaTemplate: mergedConfig.inputAreaTemplate,
              datetimeFormat: mergedConfig.datetimeFormat
            },
            position: mergedConfig.floatPosition,
            initialSessionId: this.initialConfig.sessionId,
            onSessionIdUpdate: onSessionIdUpdateCallback
          },
          this.logger
        );
      } else { // Embedded widget
        if (!this.initialConfig.containerId) {
          throw new Error('containerId is required for embedded chat widget.');
        }
        const chatContainerElement = document.getElementById(this.initialConfig.containerId);
        if (!chatContainerElement) {
          throw new Error(`Chat container with id '${this.initialConfig.containerId}' not found.`);
        }
        chatContainerElement.style.display = 'block';
        chatContainerElement.innerHTML = ''; // Clear it before use
        this.widgetInstance = new ChatWidget(
          chatContainerElement, // Pass the HTMLElement directly
          this.chatClient,
          effectiveEnableStream,
          {
            userSender: mergedConfig.userSender,
            botSender: mergedConfig.botSender,
            messageTemplate: mergedConfig.messageTemplate,
            mainContainerTemplate: mergedConfig.mainContainerTemplate,
            inputAreaTemplate: mergedConfig.inputAreaTemplate,
            widgetTitle: mergedConfig.widgetTitle,
            datetimeFormat: mergedConfig.datetimeFormat // Pass to ChatWidget config
          },
          this.logger || new Logger('info', 'LangflowChatbot'),
          this.initialConfig.sessionId,
          onSessionIdUpdateCallback
        );
      }
      this.isInitialized = true;
      this.logger.info("Instance initialized successfully.");

    } catch (error) {
      this.isInitialized = false;
      this.logger.error("Error during initialization:", error);
      if (this.initialConfig.containerId && !this.initialConfig.useFloating) {
        try {
          const container = document.getElementById(this.initialConfig.containerId);
          if (container) {
            container.innerHTML = `<div style="color: red; padding: 10px;">Error initializing chatbot: ${(error as Error).message}</div>`;
          }
        } catch (displayError) {
          // silent
        }
      }
      throw error;
    }
  }

  destroy() {
    if (this.widgetInstance && typeof this.widgetInstance.destroy === 'function') {
      this.widgetInstance.destroy();
      this.widgetInstance = null;
    }
    if (this.initialConfig.containerId && !this.initialConfig.useFloating) {
      const chatContainer = document.getElementById(this.initialConfig.containerId);
      if (chatContainer) chatContainer.innerHTML = '';
    }
    this.isInitialized = false;
    this.listeners = {}; // Clear listeners on destroy
    this.logger.info("Instance destroyed.");
  }
}

export async function init(config: LangflowChatbotInitConfig): Promise<LangflowChatbotInstance> {
  const instance = new LangflowChatbotInstance(config);
  await instance.init();
  return instance;
} 