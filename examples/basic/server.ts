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

// Configuration for Langflow Proxy Service
const langflowEndpointUrl = process.env.LANGFLOW_ENDPOINT_URL || 'http://127.0.0.1:7860';
const langflowApiKeyFromEnv = process.env.LANGFLOW_API_KEY; // Can be undefined

let langflowProxy: LangflowProxyService;

const proxyConfig: LangflowProxyConfig = {
    langflowEndpointUrl,
    langflowApiKey: langflowApiKeyFromEnv
};

try {
    langflowProxy = new LangflowProxyService(proxyConfig);
    console.log(`Basic Server: LangflowProxyService initialized and ready.`);
} catch (error) {
    console.error("Basic Server: CRITICAL - Failed to initialize LangflowProxyService:", error);
    process.exit(1);
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

server.listen(port, hostname, () => {
    console.log(`Server running at http://${hostname}:${port}/`);
}); 