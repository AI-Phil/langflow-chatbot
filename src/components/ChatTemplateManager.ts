import { Logger } from '../utils/logger';
import {
    DEFAULT_MAIN_CONTAINER_TEMPLATE,
    DEFAULT_INPUT_AREA_TEMPLATE,
    DEFAULT_MESSAGE_TEMPLATE
} from '../config/uiConstants';

export interface TemplateManagerConfig {
    mainContainerTemplate?: string;
    inputAreaTemplate?: string;
    messageTemplate?: string;
}

/**
 * Manages the HTML templates for the chat widget.
 * It uses provided templates or falls back to default templates if none are supplied.
 * It also validates the templates to ensure they contain essential elements for the widget to function correctly.
 */
export class ChatTemplateManager {
    private _mainContainerTemplate: string;
    private _inputAreaTemplate: string;
    private _messageTemplate: string;

    /**
     * Constructs a ChatTemplateManager instance.
     * @param {TemplateManagerConfig} config - The configuration object containing optional template strings.
     * @param {Logger} logger - An instance of the Logger for logging messages.
     */
    constructor(
        private config: TemplateManagerConfig,
        private logger: Logger
    ) {
        this._mainContainerTemplate = config.mainContainerTemplate || DEFAULT_MAIN_CONTAINER_TEMPLATE;
        this._inputAreaTemplate = config.inputAreaTemplate || DEFAULT_INPUT_AREA_TEMPLATE;
        this._messageTemplate = config.messageTemplate || DEFAULT_MESSAGE_TEMPLATE;

        this.validateTemplates();
    }

    private validateTemplates(): void {
        // Validation for Main Container Template
        const tempMainDiv = document.createElement('div');
        tempMainDiv.innerHTML = this._mainContainerTemplate;

        if (!tempMainDiv.querySelector('#chat-input-area-container')) {
            this.logger.error('Provided mainContainerTemplate is missing element with id="chat-input-area-container". This is critical for input area placement.');
            throw new Error('Invalid mainContainerTemplate: Missing element with id="chat-input-area-container".');
        }
        if (!tempMainDiv.querySelector('.chat-messages')) {
            this.logger.error('Provided mainContainerTemplate is missing an element with class="chat-messages". This is critical for message display.');
            throw new Error('Invalid mainContainerTemplate: Missing an element with class="chat-messages".');
        }


        // Validation for Input Area Template
        const tempInputDiv = document.createElement('div');
        tempInputDiv.innerHTML = this._inputAreaTemplate;
        if (!tempInputDiv.querySelector('.chat-input')) {
            this.logger.error('Provided inputAreaTemplate is missing an element with class "chat-input". This is critical for user input.');
            throw new Error('Invalid inputAreaTemplate: Missing element with class "chat-input".');
        }
        if (!tempInputDiv.querySelector('.send-button')) {
            this.logger.error('Provided inputAreaTemplate is missing an element with class "send-button". This is critical for sending messages.');
            throw new Error('Invalid inputAreaTemplate: Missing element with class "send-button".');
        }


        // Validation for Message Template
        if (!this._messageTemplate.includes('{{message}}')) {
            this.logger.error('Provided messageTemplate is missing the {{message}} placeholder. This is critical.');
            throw new Error('Invalid messageTemplate: Missing {{message}} placeholder.');
        }
        if (!this._messageTemplate.includes('{{messageClasses}}')) {
            this.logger.error('Provided messageTemplate is missing the {{messageClasses}} placeholder. This is critical for message styling and identification.');
            throw new Error('Invalid messageTemplate: Missing {{messageClasses}} placeholder.');
        }
        if (!this._messageTemplate.includes('{{sender}}')) {
            this.logger.error('Provided messageTemplate is missing the {{sender}} placeholder. This is critical for displaying the message sender.');
            throw new Error('Invalid messageTemplate: Missing {{sender}} placeholder.');
        }
        
        const tempMessageDiv = document.createElement('div');
        // Basic render test for message template to check for message-text-content
        const testRenderedMessage = this._messageTemplate
            .replace("{{messageClasses}}", "message")
            .replace("{{sender}}", "test") // Assuming sender might be used, though not explicitly checked for existence
            .replace("{{message}}", "test_message_content");
        tempMessageDiv.innerHTML = testRenderedMessage;

        if (!tempMessageDiv.querySelector('.message-text-content')) {
            this.logger.error('Provided messageTemplate is missing an element with class "message-text-content". Streaming updates will not work correctly.');
            throw new Error('Invalid messageTemplate: Missing element with class "message-text-content" for streaming updates.');
        }
    }

    /**
     * Gets the resolved main container HTML template string.
     * @returns {string} The main container template.
     */
    public getMainContainerTemplate(): string {
        return this._mainContainerTemplate;
    }

    /**
     * Gets the resolved input area HTML template string.
     * @returns {string} The input area template.
     */
    public getInputAreaTemplate(): string {
        return this._inputAreaTemplate;
    }

    /**
     * Gets the resolved message HTML template string.
     * @returns {string} The message template.
     */
    public getMessageTemplate(): string {
        return this._messageTemplate;
    }
} 