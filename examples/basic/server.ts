import express from 'express';
import http from 'http';
import path from 'path';
import { readFile as readFileAsync } from 'fs/promises';
import ejs from 'ejs';
import dotenv from 'dotenv';
import { LangflowProxyService } from '../../src/langflow-proxy';
import { LangflowProxyConfig } from '../../src/types';

dotenv.config({ path: path.join(__dirname, '.env') });

const hostname = '127.0.0.1';
const port = 3001;
const langflowApiPath = "/api/langflow";

// Base data object for all EJS templates
const baseEJSTemplateData = {
    langflowProxyBaseApiPath: langflowApiPath,
};

// Configuration for Langflow Proxy Service now comes primarily from chatbot-config.yaml
let langflowProxy: LangflowProxyService;

// The proxyConfig now only needs the path to the instance-specific chatbot configuration file.
// Base configuration (Langflow connection) is sourced from environment variables.
// Default chatbot behaviors are sourced from uiConstants.ts.
const proxyConfig: LangflowProxyConfig = {
    instanceConfigPath: path.join(__dirname, 'app-chatbots.yaml'),
    proxyApiBasePath: langflowApiPath
};

try {
    langflowProxy = new LangflowProxyService(proxyConfig);
    console.log(`Basic Server (Express): LangflowProxyService initialized using instance config: ${proxyConfig.instanceConfigPath}. Base Langflow connection details are read from environment variables (LANGFLOW_ENDPOINT_URL, LANGFLOW_API_KEY).`);
} catch (error) {
    console.error("Basic Server (Express): CRITICAL - Failed to initialize LangflowProxyService:", error);
    process.exit(1); // Exit if proxy can't be set up
}

const app = express(); // Create an Express app

// Middleware to parse JSON bodies, should be placed before the proxy handler
app.use(express.json());

// Serve static files and render EJS for the root path
app.get('/', (req, res) => {
    const filePath = path.join(__dirname, 'views', 'index.ejs');
    ejs.renderFile(filePath, 
        { 
            ...baseEJSTemplateData, 
        }, 
        {}, 
        (err: Error | null, str?: string) => {
        if (err) {
            res.status(500).type('text/plain').send('Error rendering page');
            return;
        }
        res.status(200).type('text/html').send(str);
    });
});

app.get('/static/LangflowChatbotPlugin.js', async (req, res) => {
    const pluginPath = path.join(__dirname, '..', '..', 'dist', 'plugins', 'LangflowChatbotPlugin.js');
    try {
        const data = await readFileAsync(pluginPath);
        res.status(200).type('application/javascript').send(data);
    } catch (err) {
        res.status(404).type('text/plain').send('Plugin JS file not found');
        console.error(`Error reading ${pluginPath}:`, err);
    }
});

app.get('/static/langflow-chatbot.css', async (req, res) => {
    const cssPath = path.join(__dirname, '..', '..', 'dist', 'styles', 'langflow-chatbot.css');
    try {
        const data = await readFileAsync(cssPath);
        res.status(200).type('text/css').send(data);
    } catch (err) {
        res.status(404).type('text/plain').send('CSS file not found');
        console.error(`Error reading ${cssPath}:`, err);
    }
});

app.get('/static/example-app-logic.js', async (req, res) => {
    const exampleLogicPath = path.join(__dirname, 'static', 'example-app-logic.js');
    try {
        const data = await readFileAsync(exampleLogicPath);
        res.status(200).type('application/javascript').send(data);
    } catch (err) {
        res.status(404).type('text/plain').send('Example App Logic JS file not found');
        console.error(`Error reading ${exampleLogicPath}:`, err);
    }
});

// All requests to the langflowApiPath will be handled by the proxy
// This should cover GET, POST, etc. for all sub-paths.
// Crucially, we do NOT modify req.url or req.originalUrl here.
// The LangflowProxyService is now responsible for interpreting them.
app.all(path.join(langflowApiPath, '*'), async (req, res) => {
    if (!langflowProxy) {
        res.status(503).json({ error: "LangflowProxyService not available. Check server startup logs." });
        return;
    }
    // req.originalUrl will be used by the proxy if present (which it is in Express)
    // req.body will be pre-parsed by express.json() if the Content-Type was application/json
    await langflowProxy.handleRequest(req, res);
});

// Fallback for 404
app.use((req, res) => {
    res.status(404).type('text/plain').send('Not Found');
});

// Wrap server startup in an async function to allow awaiting proxy initialization
async function startServer() {
    if (!langflowProxy) {
        console.error("Basic Server (Express): LangflowProxyService was not initialized. Cannot start server.");
        process.exit(1);
    }
    // LangflowProxyService now handles its initialization internally.
    // The constructor kicks off an async initialization process.
    // Public methods like handleRequest will await this internal initialization.
    // Therefore, we don't need to explicitly call an initializeFlows() method here.

    // We should, however, wait for the internal initialization to complete before 
    // declaring the server fully ready, or at least be aware that requests might 
    // be processed by the proxy only after its internal init finishes.
    // For this basic example, we can await the internal promise before starting the server 
    // to ensure all profiles are loaded and logged.
    try {
        // @ts-expect-error Accessing private member for robust startup logging
        await langflowProxy.initializationPromise; 
        console.log("Basic Server (Express): LangflowProxyService internal initialization complete. Profiles processed.");

        const httpServer = http.createServer(app); // Use the Express app
        httpServer.listen(port, hostname, () => {
            console.log(`Server running at http://${hostname}:${port}/`);
        });
    } catch (error) {
        console.error("Basic Server (Express): CRITICAL - Error during LangflowProxyService internal initialization:", error);
        process.exit(1); // Exit if internal async initialization fails
    }
}

startServer(); 