import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';
import { ChatbotProfile } from '../types';

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

    if (!parsedConfig.langflow_connection || !parsedConfig.langflow_connection.endpoint_url) {
        throw new Error(`Base YAML config missing required 'langflow_connection.endpoint_url'. Path: ${absolutePath}`);
    }
    return {
        langflowConnection: parsedConfig.langflow_connection,
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