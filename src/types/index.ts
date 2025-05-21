export interface ChatbotProfile {
    proxyEndpointId: string; 
    flowId: string;
    enableStream?: boolean;
    labels?: Labels;
    template?: Template;
    floatingWidget?: FloatingWidget;
}

export interface Labels {
    widgetTitle?: string;
    userSender?: string;
    botSender?: string;
    errorSender?: string;
    systemSender?: string;
    welcomeMessage?: string;
}

export interface Template {
    messageTemplate?: string;
    mainContainerTemplate?: string;
    inputAreaTemplate?: string;
}

export interface FloatingWidget {
    useFloating?: boolean;
    floatPosition?: "bottom-right" | "bottom-left" | "top-right" | "top-left";
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