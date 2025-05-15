export interface BotResponse {
    reply?: string;
    sessionId?: string;
    error?: string;
    detail?: string;
}

export class LangflowChatClient {
    private apiUrl: string;

    constructor(apiUrl: string = '/api/langflow') {
        this.apiUrl = apiUrl;
    }

    async sendMessage(message: string, sessionId?: string | null): Promise<BotResponse> {
        try {
            const requestBody: { message: string; sessionId?: string } = { message };
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
} 