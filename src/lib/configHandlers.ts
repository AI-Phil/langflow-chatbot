import http from 'http';
import { ChatbotProfile } from '../types';
import { sendJsonError } from './request-utils';

export async function handleGetChatbotConfigRequest(proxyEndpointId: string, res: http.ServerResponse, chatbotConfigurations: Map<string, ChatbotProfile>): Promise<void> {
    console.log(`RequestHandler: Received GET request for chatbot configuration: '${proxyEndpointId}'`);
    const fullProfile = chatbotConfigurations.get(proxyEndpointId);

    if (fullProfile) {
        const { flowId, ...clientSafeProfile } = fullProfile;
        res.statusCode = 200;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify(clientSafeProfile));
    } else {
        sendJsonError(res, 404, `Chatbot configuration with proxyEndpointId '${proxyEndpointId}' not found.`);
    }
}

export async function handleListChatbotProfilesRequest(req: http.IncomingMessage, res: http.ServerResponse, chatbotConfigurations: Map<string, ChatbotProfile>): Promise<void> {
    console.log(`RequestHandler: Received GET request to list chatbot profiles.`);
    const profilesList: Array<{ proxyEndpointId: string; widgetTitle?: string }> = [];
    for (const [proxyId, profile] of chatbotConfigurations.entries()) {
        profilesList.push({
            proxyEndpointId: proxyId,
            widgetTitle: profile.widgetTitle || proxyId
        });
    }
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(profilesList));
} 