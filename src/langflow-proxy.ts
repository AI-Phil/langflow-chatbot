import http from 'http';
import { LangflowClient } from '@datastax/langflow-client';
import { loadBaseConfig, loadInstanceConfig } from './lib/startup/config-loader';
import { FlowMapper } from './utils/flow-mapper';
import { handleRequest as handleRequestFromModule } from './lib/request-handler';
import { Profile, LangflowProxyConfig } from './types';
import { sendJsonError } from './lib/request-utils';

export class LangflowProxyService {
    private langflowClient!: LangflowClient;
    private flowConfigs: Map<string, Profile> = new Map();
    private langflowConnectionDetails: { endpoint_url: string; api_key?: string };
    private proxyApiBasePath: string;
    private flowMapper: FlowMapper;
    private initializationPromise: Promise<void>;
    private isInitialized: boolean = false;

    constructor(config: LangflowProxyConfig) {
        if (!config.proxyApiBasePath || typeof config.proxyApiBasePath !== 'string' || config.proxyApiBasePath.trim() === '') {
            throw new TypeError('LangflowProxyService: proxyApiBasePath is required in config and must be a non-empty string.');
        }

        const { langflowConnection, serverDefaults, chatbotDefaults } = loadBaseConfig();
        this.langflowConnectionDetails = langflowConnection;
        this.proxyApiBasePath = config.proxyApiBasePath;
        console.log(`LangflowProxyService: API Base Path configured to: ${this.proxyApiBasePath}`);

        const clientConfig: { baseUrl: string; apiKey?: string } = {
            baseUrl: langflowConnection.endpoint_url,
        };
        if (langflowConnection.api_key && langflowConnection.api_key.trim() !== '') {
            clientConfig.apiKey = langflowConnection.api_key;
        }
        this.langflowClient = new LangflowClient(clientConfig);
        console.log(`LangflowProxyService: LangflowClient initialized. Configured Endpoint: ${langflowConnection.endpoint_url}`);

        const rawInstanceProfiles: Profile[] = loadInstanceConfig(config.instanceConfigPath);
        this.flowMapper = new FlowMapper(langflowConnection.endpoint_url, langflowConnection.api_key);

        this.initializationPromise = this._internalAsyncInit(rawInstanceProfiles, serverDefaults, chatbotDefaults);
    }

    private async _internalAsyncInit(
        rawInstanceProfiles: Profile[],
        serverDefaultValues: Partial<Profile['server']>, 
        chatbotDefaultValues: Partial<Profile['chatbot']>
    ): Promise<void> {
        try {
            console.log("LangflowProxyService: Starting internal asynchronous initialization...");
            await this.flowMapper.initialize();
            console.log("LangflowProxyService: FlowMapper initialized successfully internally.");

            rawInstanceProfiles.forEach(profile => {
                const completeProfile: Profile = {
                    profileId: profile.profileId,
                    server: {
                        flowId: profile.server.flowId,
                        enableStream: profile.server.enableStream ?? serverDefaultValues.enableStream,
                        datetimeFormat: profile.server.datetimeFormat ?? serverDefaultValues.datetimeFormat,
                    },
                    chatbot: {
                        labels: { ...(chatbotDefaultValues.labels || {}), ...(profile.chatbot?.labels || {}) }, 
                        template: { ...(chatbotDefaultValues.template || {}), ...(profile.chatbot?.template || {}) },
                        floatingWidget: { ...(chatbotDefaultValues.floatingWidget || {}), ...(profile.chatbot?.floatingWidget || {}) }
                    }
                };

                const configuredFlowIdentifier = completeProfile.server.flowId;
                const resolvedFlowId = this.flowMapper.getTrueFlowId(configuredFlowIdentifier);

                if (resolvedFlowId) {
                    if (resolvedFlowId !== configuredFlowIdentifier) {
                         console.log(`LangflowProxyService: Resolved flow identifier '${configuredFlowIdentifier}' to UUID '${resolvedFlowId}' for profile '${completeProfile.profileId}'.`);
                    }
                    completeProfile.server.flowId = resolvedFlowId;
                } else {
                    console.error(`LangflowProxyService: CRITICAL - Could not resolve flow identifier '${configuredFlowIdentifier}' for profile '${completeProfile.profileId}'. This profile will not function correctly as the identifier is not a valid UUID and was not found in the flow map.`);
                }
                this.flowConfigs.set(completeProfile.profileId, completeProfile);
                console.log(`LangflowProxyService: Loaded profile: '${completeProfile.profileId}' configured with resolved flowId '${completeProfile.server.flowId}'.`);
            });

            if (this.flowConfigs.size === 0) {
                console.warn("LangflowProxyService: No chatbot profiles were loaded after async init. The service may not function as expected.");
            } else {
                const unresolvedCount = Array.from(this.flowConfigs.values()).filter(p => !(/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(p.server.flowId))).length;
                if (unresolvedCount > 0) {
                    console.warn(`LangflowProxyService: Finished async profile loading. ${this.flowConfigs.size - unresolvedCount} profiles have a valid resolved flowId. ${unresolvedCount} profiles have unresolved flow identifiers and may not function.`);
                } else {
                    console.log(`LangflowProxyService: Finished async profile loading. All ${this.flowConfigs.size} profiles have a valid resolved flowId.`);
                }
            }
            this.isInitialized = true;
            console.log("LangflowProxyService: Internal asynchronous initialization complete.");
        } catch (error: any) {
            console.error(`LangflowProxyService: CRITICAL - Error during internal asynchronous initialization: ${error.message}`);
            this.isInitialized = false;
            throw error; 
        }
    }

    public async getChatbotProfile(profileId: string): Promise<Profile | undefined> {
        await this.initializationPromise;
        return this.flowConfigs.get(profileId);
    }

    public getLangflowConnectionDetails(): { endpoint_url: string; api_key?: string } {
        return this.langflowConnectionDetails;
    }

    public async getAllFlowConfigs(): Promise<Map<string, Profile>> {
        await this.initializationPromise;
        return this.flowConfigs;
    }

    public async getAllChatbotProfiles(): Promise<Map<string, Profile>> {
        await this.initializationPromise;
        return this.flowConfigs;
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

        try {
            const response = await fetch(targetUrl.toString(), {
                method: method,
                headers: headers,
            });
            if (!response.ok) { 
                console.error(`LangflowProxyService: Langflow API request failed: ${response.status} ${response.statusText} for path ${path}`);
            }
            return response; 
        } catch (error: any) {
            console.error(`LangflowProxyService: Error during Langflow API request to ${path}:`, error);
            return null; 
        }
    }

    public async handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
        await this.initializationPromise;

        const entryReqUrl = req.url || '';
        let effectiveFullPath: string;

        if ((req as any).originalUrl) {
            effectiveFullPath = (req as any).originalUrl;
        } else {
            effectiveFullPath = entryReqUrl;
        }

        let internalRoutePath: string;

        if (effectiveFullPath.startsWith(this.proxyApiBasePath)) {
            internalRoutePath = effectiveFullPath.substring(this.proxyApiBasePath.length);
            if (!internalRoutePath.startsWith('/')) {
                internalRoutePath = '/' + internalRoutePath;
            }
        } else {
            sendJsonError(res, 404, "Endpoint not found. Path mismatch with proxy base.");
            return;
        }

        req.url = internalRoutePath;

        const preParsedBody: any | undefined = (req as any).body;
        const isBodyPreParsed: boolean = preParsedBody !== undefined;

        if (isBodyPreParsed) {
        } else {
        }

        try {
            await handleRequestFromModule(
                req,
                res,
                this.flowConfigs,
                this.langflowClient,
                this.langflowConnectionDetails.endpoint_url,
                this.langflowConnectionDetails.api_key,
                this._makeDirectLangflowApiRequest.bind(this),
                this.proxyApiBasePath,
                preParsedBody,
                isBodyPreParsed
            );
        } finally {
            req.url = entryReqUrl;
        }
    }
} 