import { Logger } from '../utils/logger';

export interface BotResponse {
    reply?: string;
    sessionId?: string;
    error?: string;
    detail?: string;
    // outputs?: any[]; // As per Langflow client, might be useful for 'end' event
}

export interface TokenEventData {
    chunk: string;
    id?: string; // from @datastax/langflow-client example
    timestamp?: string; // from @datastax/langflow-client example
}

export interface AddMessageEventData {
    // Define structure based on expected 'add_message' event data
    // For example, it might be similar to BotResponse or a specific message object
    message?: any; // Placeholder
    is_bot?: boolean;
    // ... other fields
}

export interface StreamStartedEventData {
    sessionId: string;
}

export interface EndEventData {
    // The 'end' event contains a full FlowResponse, which might be our BotResponse
    flowResponse: BotResponse;
    sessionId?: string; // Ensure sessionId is part of the end event if applicable
}

export interface StreamEventDataMap {
    add_message: AddMessageEventData;
    token: TokenEventData;
    stream_started: StreamStartedEventData;
    end: EndEventData;
    error: { message: string; detail?: string; code?: number; sessionId?: string }; // Added sessionId for client errors
}

export type StreamEventType = keyof StreamEventDataMap;

export interface StreamEvent<K extends StreamEventType = StreamEventType> {
    event: K;
    data: StreamEventDataMap[K];
}

// Added interface for historical messages
export interface ChatMessageData {
    id?: string;
    flow_id?: string;
    timestamp?: string; // date-time
    sender?: string;    // "user" or "bot"
    sender_name?: string;
    session_id?: string;
    text?: string;
    files?: string[];
    // other optional fields from docs: edit, duration, properties, category, content_blocks
}

import { 
    PROXY_BASE_API_PATH,
    PROFILE_CHAT_ENDPOINT_PREFIX // Updated import
} from '../config/apiPaths'; 

export class LangflowChatClient {
    private readonly baseApiUrl: string;
    private readonly chatEndpoint: string;
    private readonly historyEndpoint: string;
    private readonly logger: Logger;
    private profileId: string;

    /**
     * Creates an instance of LangflowChatClient.
     * @param {string} profileId - The unique identifier for the chatbot profile.
     * @param {string} [baseApiUrl] - Optional base API URL.
     * @param {Logger} [logger] - Optional logger instance.
     */
    constructor(profileId: string, baseApiUrl: string = PROXY_BASE_API_PATH, logger?: Logger) {
        if (!profileId || profileId.trim() === '') {
            throw new Error("profileId is required and cannot be empty.");
        }
        this.profileId = profileId;
        this.baseApiUrl = baseApiUrl.endsWith('/') ? baseApiUrl.slice(0, -1) : baseApiUrl;
        this.logger = logger || new Logger('info', 'LangflowChatClient');
        // Construct endpoints using profileId
        this.chatEndpoint = `${this.baseApiUrl}${PROFILE_CHAT_ENDPOINT_PREFIX}/${this.profileId}`;
        this.historyEndpoint = `${this.baseApiUrl}${PROFILE_CHAT_ENDPOINT_PREFIX}/${this.profileId}/history`;
    }

    private generateSessionId(): string {
        return crypto.randomUUID();
    }

    async sendMessage(message: string, sessionId?: string | null): Promise<BotResponse> {
        const effectiveSessionId = sessionId || this.generateSessionId();

        try {
            const requestBody: { message: string; sessionId?: string; stream?: boolean; } = {
                message,
                sessionId: effectiveSessionId,
                stream: false,
            };
            
            const response = await fetch(this.chatEndpoint, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(requestBody),
            });

            if (!response.ok) {
                let errorData: BotResponse = { error: `API request failed with status ${response.status}` };
                try {
                    errorData = await response.json();
                } catch (e) {
                    // Ignore if response is not JSON
                }
                this.logger.error("API Error:", response.status, errorData);
                return { 
                    error: errorData.error || `API request failed: ${response.statusText}`,
                    detail: errorData.detail,
                    sessionId: errorData.sessionId || effectiveSessionId
                };
            }
            const responseData = await response.json() as BotResponse;
            responseData.sessionId = responseData.sessionId || effectiveSessionId;
            return responseData;

        } catch (error: any) {
            this.logger.error("Failed to send message or parse response:", error);
            return {
                error: "Network error or invalid response from server.",
                detail: error.message || 'Unknown fetch error',
                sessionId: effectiveSessionId
            };
        }
    }

    async *streamMessage(message: string, sessionId?: string | null): AsyncGenerator<StreamEvent, void, undefined> {
        const effectiveSessionId = sessionId || this.generateSessionId();

        yield { event: 'stream_started', data: { sessionId: effectiveSessionId } };

        const requestBody: { message: string; sessionId?: string; stream: boolean; } = {
            message,
            sessionId: effectiveSessionId,
            stream: true,
        };

        try {
            const response = await fetch(this.chatEndpoint, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/x-ndjson',
                },
                body: JSON.stringify(requestBody),
            });

            if (!response.ok) {
                let errorData: BotResponse = { error: `API request failed with status ${response.status}` };
                try {
                    const errJson = await response.json(); 
                    errorData = {
                        error: errJson.error || `API request failed: ${response.statusText}`,
                        detail: errJson.detail,
                        sessionId: errJson.sessionId || effectiveSessionId 
                    };
                } catch (e) {
                    errorData.detail = response.statusText;
                    errorData.sessionId = effectiveSessionId; 
                }
                this.logger.error("API Stream Error:", response.status, errorData);
                yield {
                    event: 'error',
                    data: { 
                        message: errorData.error!,
                        detail: errorData.detail,
                        code: response.status,
                        // @ts-ignore 
                        sessionId: effectiveSessionId
                    }
                } as StreamEvent<'error'>;
                return;
            }

            if (!response.body) {
                this.logger.error("Response body is null");
                yield { 
                    event: 'error', 
                    data: { 
                        message: "Response body is null", 
                        // @ts-ignore
                        sessionId: effectiveSessionId 
                    }
                } as StreamEvent<'error'>;
                return;
            }

            const reader = response.body.getReader();
            const decoder = new TextDecoder("utf-8");
            let buffer = "";

            while (true) {
                const { done, value } = await reader.read();
                
                if (value) {
                    const decodedChunk = decoder.decode(value, { stream: true });
                    buffer += decodedChunk;
                }
                
                let newlineIndex;
                while ((newlineIndex = buffer.indexOf('\n')) >= 0) {
                    const line = buffer.substring(0, newlineIndex);
                    buffer = buffer.substring(newlineIndex + 1);

                    const trimmedLine = line.trim();
                    if (trimmedLine.length > 0) {
                        try {
                            let parsedEvent = JSON.parse(trimmedLine) as StreamEvent;
                            if (parsedEvent.event === 'end') {
                                if (parsedEvent.data && (parsedEvent.data as EndEventData).flowResponse) {
                                    (parsedEvent.data as EndEventData).flowResponse.sessionId = effectiveSessionId;
                                } else if (parsedEvent.data) {
                                    (parsedEvent.data as any).sessionId = effectiveSessionId;
                                }
                            }
                            yield parsedEvent;
                        } catch (e: any) {
                            this.logger.error(`[Stream] Error parsing line:`, JSON.stringify(trimmedLine), e);
                            yield { 
                                event: 'error', 
                                data: { 
                                    message: `Failed to parse JSON line`, 
                                    detail: e.message,
                                    // @ts-ignore
                                    sessionId: effectiveSessionId 
                                }
                            } as StreamEvent<'error'>;
                        }
                    }
                }

                if (done) {
                    const finalChunk = decoder.decode(); 
                    if (finalChunk && finalChunk.length > 0) {
                        buffer += finalChunk;
                    }

                    let lastNewlineIndex;
                    while ((lastNewlineIndex = buffer.indexOf('\n')) >= 0) {
                        const finalLineSegment = buffer.substring(0, lastNewlineIndex);
                        buffer = buffer.substring(lastNewlineIndex + 1);
                        const trimmedFinalLine = finalLineSegment.trim();
                        if(trimmedFinalLine.length > 0) {
                            try {
                                let parsedEvent = JSON.parse(trimmedFinalLine) as StreamEvent;
                                if (parsedEvent.event === 'end') {
                                    if (parsedEvent.data && (parsedEvent.data as EndEventData).flowResponse) {
                                        (parsedEvent.data as EndEventData).flowResponse.sessionId = effectiveSessionId;
                                    } else if (parsedEvent.data) {
                                        (parsedEvent.data as any).sessionId = effectiveSessionId;
                                    }
                                }
                                yield parsedEvent;
                            } catch (e: any) {
                                this.logger.error(`[Stream] Error parsing final line segment:`, JSON.stringify(trimmedFinalLine), e);
                                yield { 
                                    event: 'error', 
                                    data: { 
                                        message: `Failed to parse final JSON line segment`, 
                                        detail: e.message,
                                        // @ts-ignore
                                        sessionId: effectiveSessionId 
                                    }
                                } as StreamEvent<'error'>;
                            }
                        }
                    }
                    // Process any very last piece of data if buffer is not empty and has no newline
                    if (buffer.trim().length > 0) {
                        try {
                            let parsedEvent = JSON.parse(buffer.trim()) as StreamEvent;
                             if (parsedEvent.event === 'end') {
                                if (parsedEvent.data && (parsedEvent.data as EndEventData).flowResponse) {
                                    (parsedEvent.data as EndEventData).flowResponse.sessionId = effectiveSessionId;
                                } else if (parsedEvent.data) {
                                    (parsedEvent.data as any).sessionId = effectiveSessionId;
                                }
                            }
                            yield parsedEvent;
                        } catch (e: any) {
                             this.logger.error(`[Stream] Error parsing remaining buffer:`, JSON.stringify(buffer.trim()), e);
                             yield { 
                                event: 'error', 
                                data: { 
                                    message: `Failed to parse final buffer content`, 
                                    detail: e.message,
                                    // @ts-ignore
                                    sessionId: effectiveSessionId 
                                }
                            } as StreamEvent<'error'>;
                        }
                    }
                    break; 
                }
            }
        } catch (error: any) {
            this.logger.error("General stream error:", error);
            yield { 
                event: 'error', 
                data: { 
                    message: "General stream error", 
                    detail: error.message,
                    // @ts-ignore
                    sessionId: effectiveSessionId 
                }
            } as StreamEvent<'error'>;
        }
    }

    async getMessageHistory(sessionId: string): Promise<ChatMessageData[] | null> {
        if (!sessionId) {
            this.logger.error("Session ID is required to fetch message history.");
            return null;
        }

        try {
            const historyUrl = new URL(this.historyEndpoint, window.location.origin);
            historyUrl.searchParams.append('session_id', sessionId);
            
            const response = await fetch(historyUrl.toString(), {
                method: 'GET',
                headers: {
                    'Accept': 'application/json',
                },
            });

            if (!response.ok) {
                this.logger.error(`API request for history failed with status ${response.status}`);
                let errorDetail = `Status: ${response.status}`;
                try {
                    const errorJson = await response.json();
                    errorDetail = errorJson.detail || errorJson.error || JSON.stringify(errorJson);
                } catch(e) { /* ignore */ }
                // Optionally, rethrow or return a more specific error object
                // For now, just logging and returning null as per original design
                this.logger.error(`Full error detail for history fetch: ${errorDetail}`);
                return null;
            }
            return await response.json() as ChatMessageData[];
        } catch (error: any) {
            this.logger.error("Failed to fetch message history:", error);
            return null;
        }
    }
} 