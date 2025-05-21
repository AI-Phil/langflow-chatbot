import http from 'http';
import { ChatbotProfile } from '../types';
import { sendJsonError } from './request-utils';

export async function handleGetChatbotConfigRequest(proxyEndpointId: string, res: http.ServerResponse, chatbotConfigurations: Map<string, ChatbotProfile>): Promise<void> {
    console.log(`RequestHandler: Received GET request for chatbot configuration: '${proxyEndpointId}'`);
    const fullProfile = chatbotConfigurations.get(proxyEndpointId);

    if (fullProfile) {
        const { flowId, ...clientSafeProfile } = fullProfile; // remove the Langflow flowId from the response
        res.statusCode = 200;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify(clientSafeProfile));
    } else {
        sendJsonError(res, 404, `Chatbot configuration with proxyEndpointId '${proxyEndpointId}' not found.`);
    }
}

export async function handleListChatbotProfilesRequest(req: http.IncomingMessage, res: http.ServerResponse, chatbotConfigurations: Map<string, ChatbotProfile>): Promise<void> {
    console.log('RequestHandler: Received GET request to list chatbot profiles.');
    try {
        const profilesList = Array.from(chatbotConfigurations.values()).map(profile => {
            // Extract only proxyEndpointId and widgetTitle for the list response
            // Default widgetTitle to proxyEndpointId if not present in profile.labels
            const proxyId = profile.proxyEndpointId;
            const widgetTitle = (profile.labels && profile.labels.widgetTitle) ? profile.labels.widgetTitle : proxyId;
            return {
                proxyEndpointId: proxyId,
                widgetTitle: widgetTitle,
            };
        });

        res.statusCode = 200;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify(profilesList));
    } catch (error) {
        sendJsonError(res, 500, `Error listing chatbot profiles: ${(error as Error).message}`);
    }
} 