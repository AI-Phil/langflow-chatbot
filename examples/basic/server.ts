import http from 'http';
import path from 'path';
import { readFile as readFileAsync } from 'fs/promises';
import ejs from 'ejs';
import dotenv from 'dotenv';
import { LangflowProxyService, LangflowProxyConfig } from '../../src/langflow-proxy';
import { PROXY_BASE_API_PATH } from '../../src/config/apiPaths';

dotenv.config({ path: path.join(__dirname, '.env') });

const hostname = '127.0.0.1';
const port = 3001;

// Configuration for Langflow Proxy Service now comes primarily from chatbot-config.yaml
let langflowProxy: LangflowProxyService;

// The proxyConfig now only needs the path to the YAML configuration file.
const proxyConfig: LangflowProxyConfig = {
    baseConfigPath: path.join(__dirname, '..', '..', 'chatbot-config.yaml'),
    instanceConfigPath: path.join(__dirname, 'app-chatbots.yaml')
};

try {
    langflowProxy = new LangflowProxyService(proxyConfig);
    console.log(`Basic Server: LangflowProxyService initialized using base config: ${proxyConfig.baseConfigPath} and instance config: ${proxyConfig.instanceConfigPath}.`);
} catch (error) {
    console.error("Basic Server: CRITICAL - Failed to initialize LangflowProxyService:", error);
    process.exit(1); // Exit if proxy can't be set up
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
    } else if (req.url === '/static/LangflowChatbotPlugin.js') {
        const pluginPath = path.join(__dirname, '..', '..', 'dist', 'plugins', 'LangflowChatbotPlugin.js');
        try {
            const data = await readFileAsync(pluginPath);
            res.statusCode = 200;
            res.setHeader('Content-Type', 'application/javascript');
            res.end(data);
        } catch (err) {
            res.statusCode = 404;
            res.setHeader('Content-Type', 'text/plain');
            res.end('Plugin JS file not found');
            console.error(`Error reading ${pluginPath}:`, err);
        }
    } else if (req.url === '/static/langflow-chatbot.css') {
        const cssPath = path.join(__dirname, '..', '..', 'dist', 'styles', 'langflow-chatbot.css');
        try {
            const data = await readFileAsync(cssPath);
            res.statusCode = 200;
            res.setHeader('Content-Type', 'text/css');
            res.end(data);
        } catch (err) {
            res.statusCode = 404;
            res.setHeader('Content-Type', 'text/plain');
            res.end('CSS file not found');
            console.error(`Error reading ${cssPath}:`, err);
        }
    } else if (req.url === '/static/example-app-logic.js') {
        const exampleLogicPath = path.join(__dirname, 'static', 'example-app-logic.js');
        try {
            const data = await readFileAsync(exampleLogicPath);
            res.statusCode = 200;
            res.setHeader('Content-Type', 'application/javascript');
            res.end(data);
        } catch (err) {
            res.statusCode = 404;
            res.setHeader('Content-Type', 'text/plain');
            res.end('Example App Logic JS file not found');
            console.error(`Error reading ${exampleLogicPath}:`, err);
        }
    } else if (req.url?.startsWith(PROXY_BASE_API_PATH)) {
        if (!langflowProxy) {
            res.statusCode = 503; // Service Unavailable
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: "LangflowProxyService not available. Check server startup logs." }));
            return;
        }
        // Delegate to the LangflowProxyService
        await langflowProxy.handleRequest(req, res);
    } else {
        res.statusCode = 404;
        res.setHeader('Content-Type', 'text/plain');
        res.end('Not Found');
    }
});

// Wrap server startup in an async function to allow awaiting proxy initialization
async function startServer() {
    if (!langflowProxy) {
        console.error("Basic Server: LangflowProxyService was not initialized. Cannot start server.");
        process.exit(1);
    }
    try {
        await langflowProxy.initializeFlowMappings();
        console.log("Basic Server: LangflowProxyService flow mappings initialized.");
        
        server.listen(port, hostname, () => {
            console.log(`Server running at http://${hostname}:${port}/`);
        });
    } catch (error) {
        console.error("Basic Server: CRITICAL - Failed to initialize flow mappings for LangflowProxyService:", error);
        process.exit(1); // Exit if mappings can't be initialized
    }
}

startServer(); 