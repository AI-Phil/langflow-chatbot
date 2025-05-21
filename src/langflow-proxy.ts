import http from 'http';
import { LangflowClient } from '@datastax/langflow-client';
import { loadBaseConfig, loadInstanceConfig } from './lib/startup/config-loader';
import { initializeFlowMappings } from './lib/startup/flow-mapper';
import { handleRequest as handleRequestFromModule } from './lib/request-handler';
import { Profile, ServerProfile, ChatbotProfile, LangflowProxyConfig } from './types';

export class LangflowProxyService {
    private langflowClient!: LangflowClient;
    private flowConfigs: Map<string, Profile> = new Map();
    private langflowConnectionDetails: { endpoint_url: string; api_key?: string };

    constructor(config: LangflowProxyConfig) {
        try {
            const { langflowConnection, serverDefaults, chatbotDefaults } = loadBaseConfig();
            
            this.langflowConnectionDetails = langflowConnection;

            const clientConfig: { baseUrl: string; apiKey?: string } = {
                baseUrl: langflowConnection.endpoint_url,
            };
            if (langflowConnection.api_key && langflowConnection.api_key.trim() !== '') {
                clientConfig.apiKey = langflowConnection.api_key;
            }
            
            this.langflowClient = new LangflowClient(clientConfig);
            console.log(`LangflowProxyService: LangflowClient initialized. Configured Endpoint: ${langflowConnection.endpoint_url}`);

            const instanceProfiles = loadInstanceConfig(config.instanceConfigPath);
            instanceProfiles.forEach(profile => {
                // Merge with defaults
                const completeProfile: Profile = {
                    profileId: profile.profileId, // Already validated by loadInstanceConfig
                    server: {
                        flowId: profile.server.flowId, // Already validated
                        enableStream: profile.server.enableStream ?? serverDefaults.enableStream,
                        datetimeFormat: profile.server.datetimeFormat ?? serverDefaults.datetimeFormat,
                    },
                    chatbot: {
                        labels: { ...chatbotDefaults.labels, ...profile.chatbot?.labels }, 
                        template: { ...chatbotDefaults.template, ...profile.chatbot?.template },
                        floatingWidget: { ...chatbotDefaults.floatingWidget, ...profile.chatbot?.floatingWidget }
                    }
                };
                this.flowConfigs.set(completeProfile.profileId, completeProfile);

                console.log(`LangflowProxyService: Loaded profile: '${completeProfile.profileId}' configured with flow identifier '${completeProfile.server.flowId}'.`);
            });

            if (this.flowConfigs.size === 0) {
                console.warn("LangflowProxyService: No chatbot profiles were loaded. The service may not function as expected.");
            }

        } catch (error: any) {
            console.error(`LangflowProxyService: CRITICAL - Failed to initialize due to configuration error: ${error.message}`);
            throw error; 
        }
    }

    public async initializeFlows(): Promise<void> {
        await initializeFlowMappings(
            this.langflowConnectionDetails.endpoint_url, 
            this.langflowConnectionDetails.api_key, 
            this.flowConfigs
        );
    }

    private async _makeDirectLangflowApiRequest(
        res: http.ServerResponse,
        path: string,
        method: 'GET', 
        queryParams?: URLSearchParams
    ): Promise<Response | null> { 
        if (!this.langflowConnectionDetails.endpoint_url) {
            console.warn(`LangflowProxyService: Attempted API call to "${path}" when Langflow endpoint URL is not configured.`);
            res.statusCode = 503;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: "Langflow endpoint URL not configured in proxy." }));
            return null;
        }

        const targetUrl = new URL(path, this.langflowConnectionDetails.endpoint_url);
        if (queryParams) {
            queryParams.forEach((value, key) => {
                targetUrl.searchParams.append(key, value);
            });
        }

        console.log(`LangflowProxyService: Forwarding ${method} request to Langflow: ${targetUrl.toString()}`);

        const headers: HeadersInit = {
            'Accept': 'application/json',
        };
        if (this.langflowConnectionDetails.api_key) {
            headers['Authorization'] = `Bearer ${this.langflowConnectionDetails.api_key}`;
        }
        return fetch(targetUrl.toString(), {
            method: method,
            headers: headers,
        });
    }

    public async handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
        await handleRequestFromModule(
            req,
            res,
            this.flowConfigs,
            this.langflowClient,
            this.langflowConnectionDetails.endpoint_url,
            this.langflowConnectionDetails.api_key,
            this._makeDirectLangflowApiRequest.bind(this)
        );
    }

    public getChatbotProfile(profileId: string): Profile | undefined {
        return this.flowConfigs.get(profileId);
    }

    public getLangflowConnectionDetails(): { endpoint_url: string; api_key?: string } {
        return this.langflowConnectionDetails;
    }

    public getAllFlowConfigs(): Map<string, Profile> {
        return this.flowConfigs;
    }

    public getAllChatbotProfiles(): Map<string, Profile> {
        return this.flowConfigs;
    }
} 