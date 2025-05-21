/**
 * @file config-loader.ts
 * @description This file is responsible for loading base and instance-specific configurations
 * from YAML files during the application startup. It parses these files to provide
 * essential parameters like Langflow connection details and chatbot profiles.
 * This module is intended to be used early in the application lifecycle, and the
 * configurations it loads are generally static thereafter.
 */
import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';
import { ChatbotProfile, ServerProfile, Profile } from '../../types'; // Updated import path
import {
    DEFAULT_ENABLE_STREAM,
    DEFAULT_USE_FLOATING,
    DEFAULT_FLOAT_POSITION,
    DEFAULT_WIDGET_TITLE,
    DEFAULT_USER_SENDER,
    DEFAULT_BOT_SENDER,
    DEFAULT_ERROR_SENDER,
    DEFAULT_SYSTEM_SENDER,
    DEFAULT_DATETIME_FORMAT,
    DEFAULT_MAIN_CONTAINER_TEMPLATE,
    DEFAULT_INPUT_AREA_TEMPLATE,
    DEFAULT_MESSAGE_TEMPLATE,
} from '../../config/uiConstants';

// New private helper function to retrieve environment variables
function getEnvVariable(variableName: string): string | undefined {
    return process.env[variableName];
}

interface BaseConfigFile { // This interface might become redundant or be simplified
    langflow_connection?: { // Now optional in a hypothetical file context, but mandatory from env
        endpoint_url: string;
        api_key?: string;
    };
    // chatbot_defaults is no longer read from a base YAML file.
}

interface InstanceConfigFile {
    profiles: Array<Partial<Profile>>;
}

export function loadBaseConfig(): { 
    langflowConnection: { endpoint_url: string; api_key?: string };
    serverDefaults: Partial<ServerProfile>;
    chatbotDefaults: Partial<ChatbotProfile>;
} {
    console.log("ConfigLoader: Loading base configuration from environment variables and UI constants.");

    const envEndpointUrl = getEnvVariable('LANGFLOW_ENDPOINT_URL');
    const envApiKey = getEnvVariable('LANGFLOW_API_KEY');

    if (!envEndpointUrl) {
        throw new Error("Langflow endpoint URL is not defined in environment variable LANGFLOW_ENDPOINT_URL.");
    }
    console.log(`ConfigLoader: Using LANGFLOW_ENDPOINT_URL from environment: ${envEndpointUrl}`);

    let api_key: string | undefined;
    if (envApiKey) {
        console.log("ConfigLoader: Using LANGFLOW_API_KEY from environment.");
        api_key = envApiKey;
    } // api_key remains undefined if not in env, which is acceptable.

    const serverDefaults: Partial<ServerProfile> = {
        enableStream: DEFAULT_ENABLE_STREAM,
        datetimeFormat: DEFAULT_DATETIME_FORMAT,
        // flowId is mandatory and instance-specific, so no default here.
    };

    const chatbotDefaults: Partial<ChatbotProfile> = {
        floatingWidget: {
            useFloating: DEFAULT_USE_FLOATING,
            floatPosition: DEFAULT_FLOAT_POSITION,
        },
        labels: {
            widgetTitle: DEFAULT_WIDGET_TITLE,
            userSender: DEFAULT_USER_SENDER,
            botSender: DEFAULT_BOT_SENDER,
            errorSender: DEFAULT_ERROR_SENDER,
            systemSender: DEFAULT_SYSTEM_SENDER,
        },
        template: {
            mainContainerTemplate: DEFAULT_MAIN_CONTAINER_TEMPLATE,
            inputAreaTemplate: DEFAULT_INPUT_AREA_TEMPLATE,
            messageTemplate: DEFAULT_MESSAGE_TEMPLATE,
        },
    };

    return {
        langflowConnection: { endpoint_url: envEndpointUrl, api_key },
        serverDefaults: serverDefaults,
        chatbotDefaults: chatbotDefaults,
    };
}

export function loadInstanceConfig(instanceConfigPath: string): Array<Profile> {
    const absolutePath = path.resolve(instanceConfigPath);
    console.log(`ConfigLoader: Loading instance-specific chatbot profiles from: ${absolutePath}`);
    if (!fs.existsSync(absolutePath)) {
        throw new Error(`Instance configuration file (YAML) not found at ${absolutePath}.`);
    }
    const fileContents = fs.readFileSync(absolutePath, 'utf-8');
    const parsedConfig = yaml.load(fileContents) as InstanceConfigFile;

    if (!parsedConfig.profiles || !Array.isArray(parsedConfig.profiles)) {
        throw new Error(`Instance YAML config missing required 'profiles' array. Path: ${absolutePath}`);
    }

    // Validate and structure each profile
    return parsedConfig.profiles.map((p, index) => {
        if (!p.profileId || !p.server?.flowId) {
            throw new Error(`ConfigLoader: Profile at index ${index} is missing required 'profileId' or 'server.flowId'. Path: ${absolutePath}`);
        }
        const completeProfile: Profile = {
            profileId: p.profileId,
            server: {
                flowId: p.server.flowId,
                enableStream: p.server.enableStream, // Will be undefined if not present, handled by defaults later
                datetimeFormat: p.server.datetimeFormat, // Will be undefined if not present
            },
            chatbot: p.chatbot || {}, // Ensure chatbot object exists, even if empty
        } as Profile; // Type assertion
        return completeProfile;
    });
} 