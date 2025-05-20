import http from 'http';
import { LangflowClient } from '@datastax/langflow-client';
import { loadBaseConfig, loadInstanceConfig } from './lib/config-loader';
import { initializeFlowMappings } from './lib/flow-mapper';
import { handleRequest as handleRequestFromModule } from './lib/request-handler';
import { ChatbotProfile, LangflowProxyConfig } from './types';

export class LangflowProxyService {
    private langflowClient!: LangflowClient;
    private langflowEndpointUrl!: string;
    private langflowApiKey?: string;
    private chatbotConfigurations: Map<string, ChatbotProfile> = new Map();

    constructor(config: LangflowProxyConfig) {
        try {
            const { langflowConnection, chatbotDefaults } = loadBaseConfig(config.baseConfigPath);
            
            this.langflowEndpointUrl = langflowConnection.endpoint_url;
            this.langflowApiKey = langflowConnection.api_key || undefined;

            const clientConfig: { baseUrl: string; apiKey?: string } = {
                baseUrl: this.langflowEndpointUrl,
            };
            if (this.langflowApiKey && this.langflowApiKey.trim() !== '') {
                clientConfig.apiKey = this.langflowApiKey;
            }
            
            this.langflowClient = new LangflowClient(clientConfig);
            console.log(`LangflowProxyService: LangflowClient initialized. Configured Endpoint: ${this.langflowEndpointUrl}`);

            const chatbotInstanceProfiles = loadInstanceConfig(config.instanceConfigPath);

            this._processChatbotProfiles(chatbotDefaults, chatbotInstanceProfiles);

        } catch (error: any) {
            console.error(`LangflowProxyService: CRITICAL - Failed to initialize due to configuration error: ${error.message}`);
            throw error; 
        }
    }

    private _processChatbotProfiles(
        defaults: Partial<Omit<ChatbotProfile, 'proxyEndpointId' | 'flowId'>>,
        profiles: Array<Partial<ChatbotProfile> & { proxyEndpointId: string; flowId: string }>
    ): void {
        console.log(`LangflowProxyService: Using chatbot default configurations: ${Object.keys(defaults).join(', ') || 'none'}`);
        let loadedCount = 0;
        for (const partialProfile of profiles) {
            if (partialProfile.proxyEndpointId && partialProfile.flowId) {
                const completeProfile: ChatbotProfile = {
                    ...defaults,
                    ...partialProfile,
                    proxyEndpointId: partialProfile.proxyEndpointId,
                    flowId: partialProfile.flowId // This might be a name or UUID initially
                };
                this.chatbotConfigurations.set(completeProfile.proxyEndpointId, completeProfile);
                loadedCount++;
                // Initial log will show the configured ID (name or UUID)
                console.log(`LangflowProxyService: Loaded chatbot profile: '${completeProfile.proxyEndpointId}' configured with flow identifier \'${completeProfile.flowId}\'.`);
            } else {
                console.warn(`LangflowProxyService: Skipping chatbot profile due to missing 'proxyEndpointId' or 'flowId' in instance config. Profile: ${JSON.stringify(partialProfile)}`);
            }
        }
        console.log(`LangflowProxyService: Successfully processed ${loadedCount} chatbot profile(s) from instance configuration.`);
    }

    public async initializeFlows(): Promise<void> {
        await initializeFlowMappings(this.langflowEndpointUrl, this.langflowApiKey, this.chatbotConfigurations);
    }

    private async _makeDirectLangflowApiRequest(
        res: http.ServerResponse,
        path: string,
        method: 'GET', 
        queryParams?: URLSearchParams
    ): Promise<Response | null> { 
        if (!this.langflowEndpointUrl) {
            console.warn(`LangflowProxyService: Attempted API call to "${path}" when Langflow endpoint URL is not configured.`);
            res.statusCode = 503;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: "Langflow endpoint URL not configured in proxy." }));
            return null;
        }

        const targetUrl = new URL(path, this.langflowEndpointUrl);
        if (queryParams) {
            queryParams.forEach((value, key) => {
                targetUrl.searchParams.append(key, value);
            });
        }

        console.log(`LangflowProxyService: Forwarding ${method} request to Langflow: ${targetUrl.toString()}`);

        const headers: HeadersInit = {
            'Accept': 'application/json',
        };
        if (this.langflowApiKey) {
            headers['Authorization'] = `Bearer ${this.langflowApiKey}`;
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
            this.chatbotConfigurations,
            this.langflowClient,
            this.langflowEndpointUrl,
            this.langflowApiKey,
            this._makeDirectLangflowApiRequest.bind(this)
        );
    }
} 