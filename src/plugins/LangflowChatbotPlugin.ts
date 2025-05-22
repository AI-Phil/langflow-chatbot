// LangflowChatbotPlugin.ts
import { LangflowChatClient } from '../clients/LangflowChatClient';
import { PROFILE_CONFIG_ENDPOINT_PREFIX } from '../config/apiPaths';
import { ChatWidget, FloatingChatWidget } from '../components';
import { Logger, LogLevel } from '../utils/logger';
import { ERROR_MESSAGE_TEMPLATE } from '../config/uiConstants';
import { ChatbotProfile as ServerChatbotUIData, ServerProfile as ServerBehaviorData } from '../types';

// Interface for the initial configuration passed to the plugin's init function
export interface LangflowChatbotInitConfig {
  containerId?: string; // Required if useFloating is false or undefined
  profileId: string; // The ID of the chatbot profile to load
  proxyApiBasePath: string; // base API path for the proxy server
  sessionId?: string; // Optional: Resume a specific session
  useFloating?: boolean;
  enableStream?: boolean; // User can still suggest this for the client
  widgetTitle?: string;
  userSender?: string;
  botSender?: string;
  messageTemplate?: string;
  mainContainerTemplate?: string;
  inputAreaTemplate?: string;
  floatPosition?: 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left';
  onSessionIdChanged?: (sessionId: string) => void;
  logLevel?: LogLevel;
  datetimeFormat?: string; // User can still suggest this for the client
  floatingPanelWidth?: string; 
}

// This now directly uses the imported ChatbotProfile type from server/types
// It represents the data structure fetched from the server's config endpoint.
// type FullChatbotProfile = ServerChatbotProfileData;
// No, FullChatbotProfile is the type of this.serverProfile which is the result of the fetch
// which is defined in configHandlers.ts to be ChatbotProfile from '../types' (which is src/types/index.ts)
// So FullChatbotProfile should be ServerChatbotProfileData which refers to the ChatbotProfile in src/types/index.ts
// interface FullChatbotProfile extends ServerChatbotProfileData {}

// Represents the full data structure fetched from the server's config endpoint.
interface FullServerProfile extends ServerChatbotUIData, ServerBehaviorData {}

export class LangflowChatbotInstance {
  private initialConfig: LangflowChatbotInitConfig;
  private serverProfile!: FullServerProfile; // Corrected type
  private chatClient: LangflowChatClient | null = null;
  private widgetInstance: any; // Placeholder for ChatWidget or FloatingChatWidget
  private isInitialized: boolean = false;
  private listeners: { [event: string]: Array<(data: any) => void> } = {}; // For emitting events like sessionChanged
  private logger: Logger; // Use Logger type

  constructor(config: LangflowChatbotInitConfig) {
    this.initialConfig = { ...config };
    this.logger = new Logger(config.logLevel || 'info', 'LangflowChatbot');
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
      this.destroy();
    }

    if (!this.initialConfig.proxyApiBasePath) {
      const errorMsg = "proxyApiBasePath is required in LangflowChatbotInitConfig.";
      this.logger.error(errorMsg);
      throw new Error(errorMsg);
    }

    try {
      // Ensure PROFILE_CONFIG_ENDPOINT_PREFIX is joined correctly, avoiding double slashes
      const safeProfileConfigPrefix = PROFILE_CONFIG_ENDPOINT_PREFIX.startsWith('/')
        ? PROFILE_CONFIG_ENDPOINT_PREFIX.substring(1)
        : PROFILE_CONFIG_ENDPOINT_PREFIX;
      
      const baseProxyPath = this.initialConfig.proxyApiBasePath.endsWith('/')
        ? this.initialConfig.proxyApiBasePath.slice(0, -1)
        : this.initialConfig.proxyApiBasePath;

      const configUrl = `${baseProxyPath}/${safeProfileConfigPrefix}/${this.initialConfig.profileId}`;
      this.logger.info(`Fetching chatbot UI configuration from: ${configUrl}`);
      const response = await fetch(configUrl);
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to fetch chatbot configuration for '${this.initialConfig.profileId}'. Status: ${response.status}. Details: ${errorText}`);
      }
      this.serverProfile = await response.json() as FullServerProfile; // Corrected type assertion
      this.logger.debug("Received server profile:", this.serverProfile);

      const effectiveProxyBasePathForClient = this.serverProfile.proxyBasePath || this.initialConfig.proxyApiBasePath;
      this.chatClient = new LangflowChatClient(
        this.initialConfig.profileId, 
        effectiveProxyBasePathForClient,
        this.logger
      );
      
      // Ensure serverProfile parts are at least empty objects before merging
      // serverProfile is ChatbotProfile, so it directly has labels, template, floatingWidget
      const safeServerLabels = this.serverProfile.labels || {};
      const safeServerTemplate = this.serverProfile.template || {};
      const safeServerFloatingWidget = this.serverProfile.floatingWidget || {};

      // Merged config for UI components
      const mergedUiConfig = {
        labels: {
          widgetTitle: safeServerLabels.widgetTitle || this.initialConfig.widgetTitle || 'Chat Assistant',
          userSender: safeServerLabels.userSender || this.initialConfig.userSender || 'Me',
          botSender: safeServerLabels.botSender || this.initialConfig.botSender || 'Assistant',
          errorSender: safeServerLabels.errorSender, 
          systemSender: safeServerLabels.systemSender, 
          welcomeMessage: safeServerLabels.welcomeMessage, 
        },
        template: {
          messageTemplate: safeServerTemplate.messageTemplate || this.initialConfig.messageTemplate,
          mainContainerTemplate: safeServerTemplate.mainContainerTemplate || this.initialConfig.mainContainerTemplate,
          inputAreaTemplate: safeServerTemplate.inputAreaTemplate || this.initialConfig.inputAreaTemplate,
        },
        floatingWidget: {
          // If initialConfig.useFloating is explicitly set, it takes precedence.
          // Otherwise, use serverProfile setting. If neither, default to false (embedded).
          useFloating: typeof this.initialConfig.useFloating === 'boolean' 
              ? this.initialConfig.useFloating 
              : (safeServerFloatingWidget.useFloating !== undefined 
                  ? safeServerFloatingWidget.useFloating 
                  : false),
          floatPosition: safeServerFloatingWidget.floatPosition || this.initialConfig.floatPosition || 'bottom-right',
        },
      };

      // Separate handling for non-UI, client-specific settings from initialConfig
      const clientWantsFloating = mergedUiConfig.floatingWidget.useFloating;
      const effectiveEnableStream = this.initialConfig.enableStream !== undefined 
          ? this.initialConfig.enableStream 
          : (this.serverProfile.enableStream !== undefined 
              ? this.serverProfile.enableStream 
              : true); // Default to true
      // Prioritize initialConfig for datetimeFormat, then server, then undefined
      const effectiveDatetimeFormat = this.initialConfig.datetimeFormat !== undefined 
          ? this.initialConfig.datetimeFormat 
          : this.serverProfile.datetimeFormat;

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
            widgetTitle: mergedUiConfig.labels.widgetTitle,
            chatWidgetConfig: {
              labels: {
                ...mergedUiConfig.labels,
                widgetTitle: undefined, // widgetTitle is part of FloatingChatWidgetConfig now
              },
              template: mergedUiConfig.template,
              datetimeFormat: effectiveDatetimeFormat, // Pass effective datetimeFormat
            },
            position: mergedUiConfig.floatingWidget.floatPosition,
            initialSessionId: this.initialConfig.sessionId,
            onSessionIdUpdate: onSessionIdUpdateCallback,
            floatingPanelWidth: this.initialConfig.floatingPanelWidth,
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
        chatContainerElement.innerHTML = '';
        this.widgetInstance = new ChatWidget(
          chatContainerElement,
          this.chatClient,
          effectiveEnableStream,
          {
            labels: mergedUiConfig.labels,
            template: mergedUiConfig.template,
            datetimeFormat: effectiveDatetimeFormat, // Pass effective datetimeFormat
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
            container.innerHTML = ERROR_MESSAGE_TEMPLATE((error as Error).message);
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
    }
    this.widgetInstance = null;

    if (this.initialConfig.containerId && !this.initialConfig.useFloating) {
      const chatContainer = document.getElementById(this.initialConfig.containerId);
      if (chatContainer) chatContainer.innerHTML = '';
    }
    
    this.chatClient = null;
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