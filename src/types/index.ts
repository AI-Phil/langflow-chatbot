export interface Profile {
    profileId: string;
    server: ServerProfile;
    chatbot: ChatbotProfile;
}

export interface ServerProfile {
    flowId: string;
    enableStream?: boolean;
    datetimeFormat?: string;
}

export interface ChatbotProfile {
    labels?: Labels;
    template?: Template;
    floatingWidget?: FloatingWidget;
    proxyBasePath?: string;
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
    widgetHeaderTemplate?: string;
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
    instanceConfigPath: string;
    proxyApiBasePath: string;
} 