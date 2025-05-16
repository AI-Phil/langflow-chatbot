import http from 'http';
import path from 'path';
// import { readFile } from 'fs'; // No longer needed here
import { readFile as readFileAsync } from 'fs/promises';
import ejs from 'ejs';
// import { LangflowClient } from '@datastax/langflow-client'; // Will be used by the proxy service
import dotenv from 'dotenv';
import { LangflowProxyService, LangflowProxyConfig } from '../../src/langflow-proxy'; // Adjusted path

// Load environment variables from .env file
dotenv.config({ path: path.join(__dirname, '.env') });

const hostname = '127.0.0.1';
const port = 3000;

// Configuration for Langflow Proxy Service
const langflowEndpointUrl = process.env.LANGFLOW_ENDPOINT_URL || 'http://127.0.0.1:7860';
const langflowApiKeyFromEnv = process.env.LANGFLOW_API_KEY; // Can be undefined
// const langflowDefaultFlowId = process.env.LANGFLOW_DEFAULT_FLOW_ID || 'YOUR_DEFAULT_FLOW_ID_PLACEHOLDER'; // Removed
// const langflowIdFromEnv = process.env.LANGFLOW_ID; // This was not used for client/proxy, can be kept if used elsewhere or removed

let langflowProxy: LangflowProxyService;

const proxyConfig: LangflowProxyConfig = {
    langflowEndpointUrl,
    langflowApiKey: langflowApiKeyFromEnv,
    // langflowDefaultFlowId // Removed
};

try {
    langflowProxy = new LangflowProxyService(proxyConfig);
    console.log(`Basic Server: LangflowProxyService initialized and ready.`);
} catch (error) {
    console.error("Basic Server: CRITICAL - Failed to initialize LangflowProxyService:", error);
    // Optionally, exit if the proxy is essential and failed to initialize
    // process.exit(1);
}

// const DATASTAX_LANGFLOW_URL = 'https://api.langflow.astra.datastax.com'; // Not used by client logic directly

// Helper to parse JSON body is now in LangflowProxyService
// async function parseJsonBody(req: http.IncomingMessage): Promise<any> { ... }

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

server.listen(port, hostname, () => {
    console.log(`Server running at http://${hostname}:${port}/`);
    // if (!langflowDefaultFlowId || langflowDefaultFlowId === 'YOUR_DEFAULT_FLOW_ID_PLACEHOLDER') { // Removed warning for default flow id
    //     console.warn("Reminder: LANGFLOW_DEFAULT_FLOW_ID is not set or is using the default placeholder. Update it with your actual Flow ID (environment variable LANGFLOW_DEFAULT_FLOW_ID).");
    // }
    if (!langflowProxy) {
        // This check is redundant if the server exits on proxy init failure, but good for safety.
        console.error("CRITICAL: LangflowProxyService failed to initialize. The /api/langflow endpoint will not work.");
    }
}); 