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
    PROXY_CHAT_ENDPOINT_SUFFIX,
    PROXY_MESSAGES_ENDPOINT_SUFFIX
} from '../config/apiPaths'; // Adjusted import path

export class LangflowChatClient {
    private baseApiUrl: string;

    constructor(baseApiUrl: string = PROXY_BASE_API_PATH) {
        this.baseApiUrl = baseApiUrl.replace(/\/$/, ''); // Remove trailing slash if present
    }

    private generateSessionId(): string {
        return crypto.randomUUID();
    }

    async sendMessage(message: string, flowId: string, sessionId?: string | null): Promise<BotResponse> {
        const effectiveSessionId = sessionId || this.generateSessionId();

        try {
            const requestBody: { message: string; flowId: string; sessionId?: string; stream?: boolean; } = {
                message,
                flowId,
                sessionId: effectiveSessionId,
                stream: false,
            };
            
            const chatUrl = `${this.baseApiUrl}${PROXY_CHAT_ENDPOINT_SUFFIX}`; // Construct specific chat endpoint
            const response = await fetch(chatUrl, {
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
                console.error("API Error:", response.status, errorData);
                return { 
                    error: errorData.error || `API request failed: ${response.statusText}`,
                    detail: errorData.detail,
                    sessionId: errorData.sessionId || effectiveSessionId // Ensure SID is returned
                };
            }
            // Ensure the response always includes the session ID we used or that the server confirmed.
            const responseData = await response.json() as BotResponse;
            responseData.sessionId = responseData.sessionId || effectiveSessionId;
            return responseData;

        } catch (error: any) {
            console.error("Failed to send message or parse response:", error);
            return {
                error: "Network error or invalid response from server.",
                detail: error.message || 'Unknown fetch error',
                sessionId: effectiveSessionId // Return the sessionId used, even on error
            };
        }
    }

    async *streamMessage(message: string, flowId: string, sessionId?: string | null): AsyncGenerator<StreamEvent, void, undefined> {
        const effectiveSessionId = sessionId || this.generateSessionId();

        // Yield the session ID immediately
        yield { event: 'stream_started', data: { sessionId: effectiveSessionId } };

        const requestBody: { message: string; flowId: string; sessionId?: string; stream: boolean; } = {
            message,
            flowId,
            sessionId: effectiveSessionId,
            stream: true,
        };

        try {
            const chatUrl = `${this.baseApiUrl}${PROXY_CHAT_ENDPOINT_SUFFIX}`; // Construct specific chat endpoint
            const response = await fetch(chatUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/x-ndjson', // Assuming newline-delimited JSON for streaming
                },
                body: JSON.stringify(requestBody),
            });

            if (!response.ok) {
                let errorData: BotResponse = { error: `API request failed with status ${response.status}` };
                try {
                    const errJson = await response.json(); // Error might be JSON
                    errorData = {
                        error: errJson.error || `API request failed: ${response.statusText}`,
                        detail: errJson.detail,
                        sessionId: errJson.sessionId || effectiveSessionId // Ensure SID in error data
                    };
                } catch (e) {
                    errorData.detail = response.statusText;
                    errorData.sessionId = effectiveSessionId; // Ensure SID if error parsing failed
                }
                console.error("API Stream Error:", response.status, errorData);
                // Yield a custom error event that includes the session ID
                yield {
                    event: 'error',
                    data: { 
                        message: errorData.error!,
                        detail: errorData.detail,
                        code: response.status,
                        // Custom addition for LangflowChatClient: include sessionId in error event data
                        // @ts-ignore (extending the error data type on the fly for this client)
                        sessionId: effectiveSessionId
                    }
                } as StreamEvent<'error'>;
                return;
            }

            if (!response.body) {
                console.error("Response body is null");
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
                                // Ensure the session ID in the end event is the one we used/generated
                                if (parsedEvent.data && (parsedEvent.data as EndEventData).flowResponse) {
                                    (parsedEvent.data as EndEventData).flowResponse.sessionId = effectiveSessionId;
                                } else if (parsedEvent.data) {
                                     // If flowResponse is not there, add sessionId directly to data
                                    (parsedEvent.data as any).sessionId = effectiveSessionId;
                                }
                            }
                            yield parsedEvent;
                        } catch (e: any) {
                            console.error(`[Stream] Error parsing line:`, JSON.stringify(trimmedLine), e);
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
                    // Process any remaining data in the buffer when the stream is done
                    const finalChunk = decoder.decode(); // No arguments to decode the final part
                    if (finalChunk && finalChunk.length > 0) {
                        buffer += finalChunk;
                    }

                    // Process all complete lines in the buffer
                    let lastNewlineIndex;
                    while ((lastNewlineIndex = buffer.indexOf('\n')) >= 0) {
                        const finalLineSegment = buffer.substring(0, lastNewlineIndex);
                        buffer = buffer.substring(lastNewlineIndex + 1);
                        if (finalLineSegment.trim().length > 0) {
                            try {
                                let parsedEvent = JSON.parse(finalLineSegment.trim()) as StreamEvent;
                                // Ensure session ID consistency for 'end' events
                                if (parsedEvent.event === 'end') {
                                    if (parsedEvent.data && (parsedEvent.data as EndEventData).flowResponse) {
                                        (parsedEvent.data as EndEventData).flowResponse.sessionId = effectiveSessionId;
                                    } else if (parsedEvent.data) {
                                        (parsedEvent.data as any).sessionId = effectiveSessionId;
                                    }
                                }
                                yield parsedEvent;
                            } catch (e: any) {
                                console.error(`[Stream] Error parsing final line segment:`, JSON.stringify(finalLineSegment.trim()), e);
                                yield { event: 'error', data: { message: `Failed to parse final JSON line`, detail: e.message, /*@ts-ignore*/ sessionId: effectiveSessionId } } as StreamEvent<'error'>;
                            }
                        }
                    }
                    // Process any remaining part of the buffer that doesn't end with a newline
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
                            console.error(`[Stream] Error parsing very final buffer content:`, JSON.stringify(buffer.trim()), e);
                            yield { event: 'error', data: { message: `Failed to parse final buffer content`, detail: e.message, /*@ts-ignore*/ sessionId: effectiveSessionId } } as StreamEvent<'error'>;
                        }
                    }
                    break; 
                }
            }
        } catch (error: any) {
            console.error("Failed to stream message:", error);
            yield { 
                event: 'error', 
                data: { 
                    message: "Network error or failed to initiate stream.", 
                    detail: error.message,
                    // @ts-ignore
                    sessionId: effectiveSessionId 
                }
            } as StreamEvent<'error'>;
        }
    }

    async getMessageHistory(flowId: string, sessionId: string): Promise<ChatMessageData[] | null> {
        // Construct the query parameters
        const params = new URLSearchParams();
        params.append('flow_id', flowId);
        params.append('session_id', sessionId);

        const historyUrl = `${this.baseApiUrl}${PROXY_MESSAGES_ENDPOINT_SUFFIX}?${params.toString()}`;
        
        try {
            const response = await fetch(historyUrl, {
                method: 'GET',
                headers: {
                    'Accept': 'application/json',
                },
            });

            if (!response.ok) {
                console.error(`API Error fetching history (${response.status}):`, await response.text());
                return null; // Or throw an error, or return an object indicating error
            }

            const data = await response.json();
            if (Array.isArray(data)) {
                return data as ChatMessageData[];
            } else if (data && Array.isArray(data.messages)) { // If the API wraps history in a 'messages' field
                return data.messages as ChatMessageData[];
            }
            console.warn("Unexpected response structure for message history:", data);
            return []; // Return empty if structure is not as expected but request was ok
        } catch (error) {
            console.error("Failed to fetch message history:", error);
            return null; // Or throw
        }
    }
} 