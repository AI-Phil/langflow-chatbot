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

export interface EndEventData {
    // The 'end' event contains a full FlowResponse, which might be our BotResponse
    flowResponse: BotResponse;
    sessionId?: string; // Ensure sessionId is part of the end event if applicable
}

export interface StreamEventDataMap {
    add_message: AddMessageEventData;
    token: TokenEventData;
    end: EndEventData;
    error: { message: string; detail?: string; code?: number }; // For stream-specific errors
}

export type StreamEventType = keyof StreamEventDataMap;

export interface StreamEvent<K extends StreamEventType = StreamEventType> {
    event: K;
    data: StreamEventDataMap[K];
}

export class LangflowChatClient {
    private apiUrl: string;

    constructor(apiUrl: string = '/api/langflow') {
        this.apiUrl = apiUrl;
    }

    async sendMessage(message: string, sessionId?: string | null): Promise<BotResponse> {
        try {
            const requestBody: { message: string; sessionId?: string; stream?: boolean } = { message, stream: false };
            if (sessionId) {
                requestBody.sessionId = sessionId;
            }

            const response = await fetch(this.apiUrl, {
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
                    sessionId: errorData.sessionId
                };
            }
            return await response.json() as BotResponse;
        } catch (error: any) {
            console.error("Failed to send message or parse response:", error);
            return {
                error: "Network error or invalid response from server.",
                detail: error.message || 'Unknown fetch error'
            };
        }
    }

    async *streamMessage(message: string, sessionId?: string | null): AsyncGenerator<StreamEvent, void, undefined> {
        const requestBody: { message: string; sessionId?: string; stream: boolean } = { message, stream: true };
        if (sessionId) {
            requestBody.sessionId = sessionId;
        }

        try {
            const response = await fetch(this.apiUrl, {
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
                    const errJson = await response.json();
                    errorData = {
                        error: errJson.error || `API request failed: ${response.statusText}`,
                        detail: errJson.detail,
                        sessionId: errJson.sessionId
                    };
                } catch (e) {
                    errorData.detail = response.statusText;
                }
                console.error("API Stream Error:", response.status, errorData);
                yield { event: 'error', data: { message: errorData.error!, detail: errorData.detail, code: response.status } };
                return;
            }

            if (!response.body) {
                console.error("Response body is null");
                yield { event: 'error', data: { message: "Response body is null" } };
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
                            yield JSON.parse(trimmedLine) as StreamEvent;
                        } catch (e: any) {
                            console.error(`[Stream] Error parsing line:`, JSON.stringify(trimmedLine), e);
                            yield { event: 'error', data: { message: `Failed to parse JSON line`, detail: e.message } };
                        }
                    }
                }

                if (done) {
                    const lastChunk = decoder.decode();
                    if (lastChunk && lastChunk.length > 0) {
                        buffer += lastChunk;
                    }
                    break; 
                }
            }
        } catch (error: any) {
            console.error("[Stream] Network or other error during streaming:", error);
            yield { event: 'error', data: { message: "Network error or other issue during streaming.", detail: error.message || 'Unknown fetch error' } };
        }
    }
} 