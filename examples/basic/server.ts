import http from 'http';
import path from 'path';
import { readFile } from 'fs';
import { readFile as readFileAsync } from 'fs/promises';
import ejs from 'ejs';
import { LangflowClient } from '@datastax/langflow-client';
import dotenv from 'dotenv';

// Load environment variables from .env file in the current directory (examples/basic/)
// The path should be relative to where server.ts is executed, or use an absolute path if needed.
dotenv.config({ path: path.join(__dirname, '.env') });

const hostname = '127.0.0.1';
const port = 3000;

const langflowEndpointUrl = process.env.LANGFLOW_ENDPOINT_URL || 'http://127.0.0.1:7860';
const langflowApiKeyFromEnv = process.env.LANGFLOW_API_KEY; // This can be undefined or an empty string
const langflowDefaultFlowId = process.env.LANGFLOW_DEFAULT_FLOW_ID || 'YOUR_DEFAULT_FLOW_ID_PLACEHOLDER';
const langflowIdFromEnv = process.env.LANGFLOW_ID; // A general Langflow ID, if provided for some contexts

let langflowClient: LangflowClient;

const DATASTAX_LANGFLOW_URL = 'https://api.langflow.astra.datastax.com';

try {
    const clientConfig: { baseUrl: string; apiKey?: string } = {
        baseUrl: langflowEndpointUrl
    };

    if (langflowApiKeyFromEnv && langflowApiKeyFromEnv.trim() !== '') {
        // console.log('Using API key for Langflow authentication.'); // Commented out
        clientConfig.apiKey = langflowApiKeyFromEnv;
    } else {
        // console.log('No API key provided or API key is empty. Langflow client will be initialized without it.'); // Commented out
    }

    // console.log("Attempting to initialize LangflowClient with options:", JSON.stringify(clientConfig)); // Commented out
    langflowClient = new LangflowClient(clientConfig);
    console.log(`LangflowClient initialized. Configured Endpoint: ${langflowEndpointUrl}, Flow ID for use: ${langflowDefaultFlowId}`);

} catch (error) {
    console.error("Failed to initialize LangflowClient:", error);
}

// Helper to parse JSON body
async function parseJsonBody(req: http.IncomingMessage): Promise<any> {
    return new Promise((resolve, reject) => {
        let body = '';
        req.on('data', chunk => {
            body += chunk.toString();
        });
        req.on('end', () => {
            try {
                resolve(JSON.parse(body));
            } catch (e) {
                reject(new Error('Invalid JSON body'));
            }
        });
        req.on('error', reject);
    });
}

const server = http.createServer(async (req, res) => {
    if (req.url === '/' || req.url === '/index') {
        const filePath = path.join(__dirname, 'views', 'index.ejs');
        ejs.renderFile(filePath, {}, {}, (err: Error | null, str?: string) => {
            if (err) {
                res.statusCode = 500;
                res.setHeader('Content-Type', 'text/plain');
                res.end('Error rendering page');
                return;
            }
            res.statusCode = 200;
            res.setHeader('Content-Type', 'text/html');
            res.end(str);
        });
    } else if (req.url === '/static/langflow-chatbot.js') {
        const jsPath = path.join(__dirname, '..', '..', 'dist', 'langflow-chatbot.umd.js');
        try {
            const data = await readFileAsync(jsPath);
            res.statusCode = 200;
            res.setHeader('Content-Type', 'application/javascript');
            res.end(data);
        } catch (err) {
            res.statusCode = 404;
            res.setHeader('Content-Type', 'text/plain');
            res.end('JavaScript bundle not found');
            console.error(`Error reading ${jsPath}:`, err);
        }
    } else if (req.url === '/api/langflow' && req.method === 'POST') {
        if (!langflowClient) {
            res.statusCode = 503; // Service Unavailable
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: "LangflowClient not initialized. Check server logs." }));
            return;
        }
        try {
            const body = await parseJsonBody(req);
            const userMessage = body.message;
            const clientSessionId = body.sessionId;

            if (!userMessage || typeof userMessage !== 'string') {
                res.statusCode = 400; res.setHeader('Content-Type', 'application/json');
                res.end(JSON.stringify({ error: "Message is required and must be a string." }));
                return;
            }

            const runOptions: any = {
                input_type: 'chat',
                output_type: 'chat',
                session_id: clientSessionId || undefined
            };
            
            if (runOptions.session_id === undefined) {
                delete runOptions.session_id;
            }

            if (clientSessionId) {
                console.log(`Received message for Langflow (${langflowDefaultFlowId}) from session: ${runOptions.session_id}, input_type: ${runOptions.input_type}, message: ${userMessage}`);
            } else {
                console.log(`Received message for Langflow (${langflowDefaultFlowId}) (new session), input_type: ${runOptions.input_type}, message: ${userMessage}`);
            }
            
            const flow = langflowClient.flow(langflowDefaultFlowId);
            const langflowResponse = await flow.run(userMessage, runOptions);
            
            const responseSessionId = langflowResponse.sessionId;
            let reply = "Sorry, I could not process that.";

            if (langflowResponse && 
                Array.isArray(langflowResponse.outputs) && 
                langflowResponse.outputs.length > 0) {
                
                const firstOutputComponent = langflowResponse.outputs[0];
                if (firstOutputComponent && 
                    Array.isArray(firstOutputComponent.outputs) && 
                    firstOutputComponent.outputs.length > 0) {
                    
                    const innerOutput = firstOutputComponent.outputs[0];
                    if (innerOutput && 
                        innerOutput.results && 
                        typeof innerOutput.results === 'object' && 
                        innerOutput.results.message && 
                        typeof innerOutput.results.message === 'object' && 
                        typeof innerOutput.results.message.text === 'string') {
                        
                        reply = innerOutput.results.message.text.trim();
                        if (reply === '') {
                            reply = "Received an empty message from Bot.";
                        }
                    } else if (innerOutput && innerOutput.outputs && typeof innerOutput.outputs === 'object') {
                        const innerComponentOutputs = innerOutput.outputs as Record<string, any>;
                        if (innerComponentOutputs.message && typeof innerComponentOutputs.message === 'object' && typeof innerComponentOutputs.message.message === 'string') {
                            reply = innerComponentOutputs.message.message.trim();
                        } else if (typeof innerComponentOutputs.text === 'string') {
                            reply = innerComponentOutputs.text.trim();
                        }
                    }
                }
            }
            
            if (reply === "Sorry, I could not process that." && langflowResponse) {
                 console.log("Primary extraction failed, attempting broader fallback...");
                 if (Array.isArray(langflowResponse.outputs)) {
                    for (const outputComponent of langflowResponse.outputs) {
                        if (outputComponent && typeof outputComponent === 'object' && Array.isArray(outputComponent.outputs)) {
                            for (const innerDocOutput of outputComponent.outputs) {
                                if (innerDocOutput && typeof innerDocOutput === 'object') {
                                    const componentOutputs = innerDocOutput.outputs as Record<string, any>;
                                    if (componentOutputs && typeof componentOutputs.chat === 'string' && componentOutputs.chat.trim() !== '') {
                                        reply = componentOutputs.chat.trim(); break;
                                    }
                                    if (componentOutputs && typeof componentOutputs.text === 'string' && componentOutputs.text.trim() !== '') {
                                        reply = componentOutputs.text.trim(); break;
                                    }
                                    if (innerDocOutput.results && innerDocOutput.results.message && typeof innerDocOutput.results.message.text === 'string') {
                                        reply = innerDocOutput.results.message.text.trim(); break;
                                    }
                                    if (innerDocOutput.artifacts && typeof innerDocOutput.artifacts.message === 'string') {
                                        reply = innerDocOutput.artifacts.message.trim(); break;
                                    }
                                }
                            }
                        }
                        if (reply !== "Sorry, I could not process that.") break;
                    }
                }
            }

            // Comment out extensive logging
            // console.log("---- Full Langflow Response Start ----");
            // console.log(JSON.stringify(langflowResponse, null, 2));
            // console.log("---- Full Langflow Response End ----");
            // console.log("Extracted reply before sending to client:", reply);
            // console.log("Session ID from Langflow response:", responseSessionId);

            res.statusCode = 200; res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ reply: reply, sessionId: responseSessionId }));

        } catch (error: any) {
            console.error("Error in /api/langflow:", error);
            res.statusCode = 500;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: "Failed to process chat message.", detail: error.message || 'Unknown error' }));
        }
    } else {
        res.statusCode = 404;
        res.setHeader('Content-Type', 'text/plain');
        res.end('Not Found');
    }
});

server.listen(port, hostname, () => {
    console.log(`Server running at http://${hostname}:${port}/`);
    if (!langflowDefaultFlowId || langflowDefaultFlowId === 'YOUR_DEFAULT_FLOW_ID_PLACEHOLDER') {
        console.warn("Reminder: LANGFLOW_DEFAULT_FLOW_ID is not set or is using the default placeholder. Update it with your actual Flow ID (environment variable LANGFLOW_DEFAULT_FLOW_ID).");
    }
    if (!langflowClient) {
        console.error("CRITICAL: LangflowClient failed to initialize. The /api/langflow endpoint will not work.");
    }
}); 