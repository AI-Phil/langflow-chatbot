export const SVG_CHAT_ICON = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H6l-2 2V4h16v12z"></path></svg>';
export const SVG_MINIMIZE_ICON = '<svg viewBox="0 0 24 24" stroke-width="2"><path stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" d="M18 12H6"></path></svg>';

export const DEFAULT_MAIN_CONTAINER_TEMPLATE = `
<div class="chat-widget" style="display: flex; flex-direction: column; height: 100%;">
    <div class="chat-messages" style="flex-grow: 1; overflow-y: auto;">
        <!-- Messages will appear here -->
    </div>
    <div id="chat-input-area-container" style="flex-shrink: 0;"></div>
</div>
`;

export const DEFAULT_INPUT_AREA_TEMPLATE = `
<div class="chat-input-area">
    <input type="text" class="chat-input" placeholder="Type your message..." />
    <button class="send-button">Send</button>
</div>
`;

export const DEFAULT_MESSAGE_TEMPLATE = `
<div class="{{messageClasses}} message-block">
  <div class="sender-name-display" style="font-size: 0.8em; color: #888; margin-bottom: 2px;">{{sender}}</div>
  <div class="message-bubble">
    <span class="message-text-content" style="white-space: pre-wrap;">{{message}}</span>
  </div>
</div>`;

export const THINKING_BUBBLE_HTML = '<div class="thinking-bubble"><span class="dot"></span><span class="dot"></span><span class="dot"></span></div>';

export const ERROR_MESSAGE_TEMPLATE = (errorMessage: string) => '<div style="color: red; padding: 10px;">Error initializing chatbot: ${errorMessage}</div>'; 