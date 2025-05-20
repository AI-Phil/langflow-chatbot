export interface ChatbotProfile {
    proxyEndpointId: string; 
    flowId: string;
    enableStream?: boolean;
    useFloating?: boolean;
    floatPosition?: "bottom-right" | "bottom-left" | "top-right" | "top-left";
    widgetTitle?: string;
    userSender?: string;
    botSender?: string;
    errorSender?: string; 
    systemSender?: string;
    messageTemplate?: string;
    mainContainerTemplate?: string;
    inputAreaTemplate?: string;
}

export interface SenderConfig {
    userSender: string;
    botSender: string;
    errorSender: string;
    systemSender: string;
}

export interface LangflowProxyConfig {
    baseConfigPath: string;
    instanceConfigPath: string;
} 