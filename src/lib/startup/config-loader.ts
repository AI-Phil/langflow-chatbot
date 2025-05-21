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
import { ChatbotProfile } from '../../types'; // Updated import path
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
    chatbots: Array<Partial<ChatbotProfile> & { proxyEndpointId: string; flowId: string }>;
}

export function loadBaseConfig(): { // Removed baseConfigPath parameter
    langflowConnection: { endpoint_url: string; api_key?: string };
    chatbotDefaults: Partial<Omit<ChatbotProfile, 'proxyEndpointId' | 'flowId'>>;
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

    const chatbotDefaults = {
        enableStream: DEFAULT_ENABLE_STREAM,
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
        datetimeFormat: DEFAULT_DATETIME_FORMAT,
        template: {
            mainContainerTemplate: DEFAULT_MAIN_CONTAINER_TEMPLATE,
            inputAreaTemplate: DEFAULT_INPUT_AREA_TEMPLATE,
            messageTemplate: DEFAULT_MESSAGE_TEMPLATE,
        },
    };

    return {
        langflowConnection: { endpoint_url: envEndpointUrl, api_key },
        chatbotDefaults: chatbotDefaults,
    };
}

export function loadInstanceConfig(instanceConfigPath: string): Array<Partial<ChatbotProfile> & { proxyEndpointId: string; flowId: string }> {
    const absolutePath = path.resolve(instanceConfigPath);
    console.log(`ConfigLoader: Loading instance-specific chatbot profiles from: ${absolutePath}`);
    if (!fs.existsSync(absolutePath)) {
        throw new Error(`Instance configuration file (YAML) not found at ${absolutePath}.`);
    }
    const fileContents = fs.readFileSync(absolutePath, 'utf-8');
    const parsedConfig = yaml.load(fileContents) as InstanceConfigFile;

    if (!parsedConfig.chatbots || !Array.isArray(parsedConfig.chatbots)) {
        throw new Error(`Instance YAML config missing required 'chatbots' array. Path: ${absolutePath}`);
    }
    return parsedConfig.chatbots;
} 