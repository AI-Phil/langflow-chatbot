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

// New private helper function to retrieve environment variables
function getEnvVariable(variableName: string): string | undefined {
    // Removed temporary debug log
    return process.env[variableName];
}

interface BaseConfigFile {
    langflow_connection: {
        endpoint_url: string;
        api_key?: string;
    };
    chatbot_defaults?: Partial<Omit<ChatbotProfile, 'proxyEndpointId' | 'flowId'>>;
}

interface InstanceConfigFile {
    chatbots: Array<Partial<ChatbotProfile> & { proxyEndpointId: string; flowId: string }>;
}

export function loadBaseConfig(baseConfigPath: string): {
    langflowConnection: { endpoint_url: string; api_key?: string };
    chatbotDefaults: Partial<Omit<ChatbotProfile, 'proxyEndpointId' | 'flowId'>>;
} {
    const absolutePath = path.resolve(baseConfigPath);
    console.log(`ConfigLoader: Loading base configuration from: ${absolutePath}`);
    if (!fs.existsSync(absolutePath)) {
        throw new Error(`Base configuration file (YAML) not found at ${absolutePath}.`);
    }
    const fileContents = fs.readFileSync(absolutePath, 'utf-8');
    const parsedConfig = yaml.load(fileContents) as BaseConfigFile;

    const envEndpointUrl = getEnvVariable('LANGFLOW_ENDPOINT_URL');
    const envApiKey = getEnvVariable('LANGFLOW_API_KEY');

    let endpoint_url: string;
    if (envEndpointUrl) {
        console.log(`ConfigLoader: Using LANGFLOW_ENDPOINT_URL from environment: ${envEndpointUrl}`);
        endpoint_url = envEndpointUrl;
    } else if (parsedConfig.langflow_connection && parsedConfig.langflow_connection.endpoint_url) {
        endpoint_url = parsedConfig.langflow_connection.endpoint_url;
    } else {
        throw new Error(`Langflow endpoint URL is not defined in environment variables (LANGFLOW_ENDPOINT_URL) or in the base YAML config. Path: ${absolutePath}`);
    }

    let api_key: string | undefined;
    if (envApiKey) {
        console.log("ConfigLoader: Using LANGFLOW_API_KEY from environment.");
        api_key = envApiKey;
    } else if (parsedConfig.langflow_connection && parsedConfig.langflow_connection.api_key) {
        api_key = parsedConfig.langflow_connection.api_key;
    }
    // If api_key is still undefined here, it means it wasn't in env or config, which is acceptable as it's optional.

    return {
        langflowConnection: { endpoint_url, api_key },
        chatbotDefaults: parsedConfig.chatbot_defaults || {},
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