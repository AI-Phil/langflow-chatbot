import { LangflowChatClient, BotResponse } from '../clients/LangflowChatClient'; // Adjusted import path

export class ChatWidget {
    private element: HTMLElement;
    private chatClient: LangflowChatClient;
    private currentSessionId: string | null = null; // Added to store sessionId

    constructor(containerId: string, chatClient: LangflowChatClient) {
        const container = document.getElementById(containerId);
        if (!container) {
            throw new Error(`Container with id #${containerId} not found.`);
        }
        if (!chatClient) {
            throw new Error('LangflowChatClient instance is required.');
        }
        this.element = container;
        this.chatClient = chatClient;
        this.render();
        // Optionally, you could try to load a sessionId from localStorage here if you want persistence across page loads
    }

    private render(): void {
        this.element.innerHTML = `
            <div class="chat-widget">
                <div class="chat-messages">
                    <!-- Messages will appear here -->
                </div>
                <div class="chat-input-area">
                    <input type="text" class="chat-input" placeholder="Type your message..." />
                    <button class="send-button">Send</button>
                </div>
            </div>
        `;
        this.setupEventListeners();
    }

    private setupEventListeners(): void {
        const sendButton = this.element.querySelector('.send-button');
        const chatInput = this.element.querySelector<HTMLInputElement>('.chat-input');

        if (sendButton && chatInput) {
            sendButton.addEventListener('click', () => this.sendMessage(chatInput.value));
            chatInput.addEventListener('keypress', (event) => {
                if (event.key === 'Enter') {
                    this.sendMessage(chatInput.value);
                }
            });
        }
    }

    private async sendMessage(message: string): Promise<void> {
        if (!message.trim()) {
            return;
        }

        const chatInput = this.element.querySelector<HTMLInputElement>('.chat-input');
        
        if (chatInput) {
            this.addMessageToDisplay("You", message);
            const currentMessage = message;
            chatInput.value = '';

            this.addMessageToDisplay("Bot", "Thinking...", true); // Add a temporary thinking message

            try {
                // Pass currentSessionId to the chat client
                const botResponse: BotResponse = await this.chatClient.sendMessage(currentMessage, this.currentSessionId);
                this.removeThinkingMessage();

                // Update currentSessionId if the server provides one
                if (botResponse.sessionId) {
                    this.currentSessionId = botResponse.sessionId;
                    // Optionally, save this.currentSessionId to localStorage here for persistence
                }

                if (botResponse.error) {
                    console.error("Error from LangflowChatClient:", botResponse.error, botResponse.detail);
                    this.addMessageToDisplay("Error", `${botResponse.error}${botResponse.detail ? ": " + botResponse.detail : ""}`);
                } else if (botResponse.reply) {
                    this.addMessageToDisplay("Bot", botResponse.reply);
                } else {
                    this.addMessageToDisplay("Bot", "Sorry, I couldn't get a valid response.");
                }
            } catch (error: any) {
                this.removeThinkingMessage();
                console.error("Failed to send message via ChatClient:", error);
                this.addMessageToDisplay("Error", `Communication error: ${error.message || 'Unknown error'}`);
            }
        }
    }
    
    private removeThinkingMessage(): void {
        const thinkingMessage = this.element.querySelector('.message.thinking');
        if (thinkingMessage) {
            thinkingMessage.remove();
        }
    }

    private addMessageToDisplay(sender: string, message: string, isThinking: boolean = false): void {
        const chatMessages = this.element.querySelector('.chat-messages');
        if (chatMessages) {
            const messageElement = document.createElement('div');
            messageElement.classList.add('message');
            if (sender === "You") {
                messageElement.classList.add('user-message');
            } else if (sender === "Bot") {
                messageElement.classList.add('bot-message');
            } else if (sender === "Error") {
                 messageElement.classList.add('error-message');
            }
            if (isThinking) {
                messageElement.classList.add('thinking');
            }
            // Basic text display, consider escaping HTML if message can contain it
            const senderStrong = document.createElement('strong');
            senderStrong.textContent = `${sender}: `;
            messageElement.appendChild(senderStrong);
            messageElement.appendChild(document.createTextNode(message));
            
            chatMessages.appendChild(messageElement);
            chatMessages.scrollTop = chatMessages.scrollHeight;
        }
    }
} 