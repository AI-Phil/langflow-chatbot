import http from 'http';
import { Profile, ChatbotProfile } from '../types';
import { sendJsonError } from './request-utils';

export async function handleGetChatbotConfigRequest(profileId: string, res: http.ServerResponse, chatbotConfigurations: Map<string, Profile>): Promise<void> {
    console.log(`RequestHandler: Received GET request for chatbot configuration: '${profileId}'`);
    const profile = chatbotConfigurations.get(profileId);

    if (profile) {
        const clientSafeProfile: ChatbotProfile = profile.chatbot;
        res.statusCode = 200;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify(clientSafeProfile));
    } else {
        sendJsonError(res, 404, `Chatbot configuration with profileId '${profileId}' not found.`);
    }
}

export async function handleListChatbotProfilesRequest(req: http.IncomingMessage, res: http.ServerResponse, chatbotConfigurations: Map<string, Profile>): Promise<void> {
    console.log('RequestHandler: Received GET request to list chatbot profiles.');
    try {
        const profilesList = Array.from(chatbotConfigurations.values()).map(profile => {
            const id = profile.profileId;
            const widgetTitle = profile.chatbot?.labels?.widgetTitle || id;
            return {
                profileId: id,
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