import http from 'http';
import { URL } from 'url';
import { LangflowClient } from '@datastax/langflow-client';
import { Profile } from '../types';
import {
    PROFILE_CONFIG_ENDPOINT_PREFIX,
    PROFILE_CHAT_ENDPOINT_PREFIX,
    PROXY_FLOWS_SUFFIX,
    PROXY_PROFILES_SUFFIX,
    LANGFLOW_API_BASE_PATH_V1
} from '../config/apiPaths';
import { sendJsonError, proxyLangflowApiRequest, parseJsonBody } from './request-utils';
// Import moved handlers
import { handleGetChatbotConfigRequest, handleListChatbotProfilesRequest } from './configHandlers';
import { handleGetFlowsRequest } from './langflow/flowsHandlers';
import { handleGetChatHistoryRequest } from './langflow/historyHandlers';
import { handleChatMessageRequest } from './langflow/chatHandlers';

// This function will be called by LangflowProxyService, passing necessary dependencies
export async function handleRequest(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    chatbotConfigurations: Map<string, Profile>,
    langflowClient: LangflowClient | undefined, // Can be undefined if not initialized
    langflowEndpointUrl: string | undefined,
    langflowApiKey: string | undefined,
    // Function to make direct API requests, passed from the main service
    makeDirectLangflowApiRequest: (
        res: http.ServerResponse,
        path: string,
        method: 'GET',
        queryParams?: URLSearchParams
    ) => Promise<Response | null>
): Promise<void> {
    const { method, url: rawUrl } = req;
    if (!rawUrl) {
        sendJsonError(res, 400, "URL is required.");
        return;
    }

    const base = `http://${req.headers.host || 'localhost'}`;
    const parsedUrl = new URL(rawUrl, base);
    const pathname = parsedUrl.pathname;

    // Path prefixes are now direct matches as base path is stripped by caller
    const configRequestPathPrefix = PROFILE_CONFIG_ENDPOINT_PREFIX + '/';
    const chatRequestPathPrefix = PROFILE_CHAT_ENDPOINT_PREFIX + '/';

    if (method === 'GET' && pathname.startsWith(configRequestPathPrefix)) {
        const profileId = pathname.substring(configRequestPathPrefix.length);
        await handleGetChatbotConfigRequest(profileId, res, chatbotConfigurations);
    } else if (pathname.startsWith(chatRequestPathPrefix)) {
        const remainingPath = pathname.substring(chatRequestPathPrefix.length);
        const parts = remainingPath.split('/').filter(p => p.length > 0);
        const profileId = parts[0];

        if (!profileId) {
            sendJsonError(res, 400, "profileId missing in chat URL.");
            return;
        }

        const profile = chatbotConfigurations.get(profileId);
        if (!profile) {
            sendJsonError(res, 404, `Chatbot profile with profileId '${profileId}' not found.`);
            return;
        }
        const flowIdToUse = profile.server.flowId;

        if (method === 'POST' && parts.length === 1) {
            const serverAllowsStream = profile.server.enableStream !== false; // Access enableStream from profile.server, default to true
            await handleChatMessageRequest(req, res, flowIdToUse, serverAllowsStream, langflowClient);
        } else if (method === 'GET' && parts.length === 2 && parts[1] === 'history') {
            const sessionId = parsedUrl.searchParams.get('session_id');
            await handleGetChatHistoryRequest(res, flowIdToUse, sessionId, makeDirectLangflowApiRequest);
        } else {
            sendJsonError(res, 404, "Chat endpoint not found or method not supported for the path.");
        }
    } else if (method === 'GET' && pathname === PROXY_FLOWS_SUFFIX) {
        await handleGetFlowsRequest(req, res, makeDirectLangflowApiRequest);
    } else if (method === 'GET' && pathname === PROXY_PROFILES_SUFFIX) {
        await handleListChatbotProfilesRequest(req, res, chatbotConfigurations);
    } else {
        sendJsonError(res, 404, "Endpoint not found or method not supported.");
    }
} 