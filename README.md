# langflow-chatbot

A toolkit for embedding Langflow-powered chatbots in your app, with both server (proxy) and browser plugin components.

## Installation

```bash
npm install langflow-chatbot
```

## Quick Start

### 1. Server Setup (Node.js/Express)

```typescript
import express from 'express';
import { LangflowProxyService } from 'langflow-chatbot';

const app = express();
const proxy = new LangflowProxyService({
  instanceConfigPath: './app-chatbots.yaml',
  proxyApiBasePath: '/api/langflow',
});

app.use(express.json());

// Serve the chatbot plugin and styles
app.use('/static/LangflowChatbotPlugin.js', express.static(
  require.resolve('langflow-chatbot/plugin')
));
app.use('/static/langflow-chatbot.css', express.static(
  require.resolve('langflow-chatbot/styles')
));

// Handle chatbot API requests
app.all('/api/langflow/*', (req, res) => proxy.handleRequest(req, res));

app.listen(3001);
```

### 2. Browser Integration

Include the CSS and JavaScript files in your HTML:

```html
<link rel="stylesheet" href="/static/langflow-chatbot.css">
<script src="/static/LangflowChatbotPlugin.js"></script>
```

## Configuration

Chatbot profiles and flow mappings are defined in a YAML file (see `examples/basic/app-chatbots.yaml`).

Langflow connection details (endpoint URL, API key) can be set in the YAML or via environment variables (see `.env.example`).

**Environment variables override YAML for connection details.**

## Usage Examples

### Embedded Mode (default when containerId provided)
```html
<div id="chatbot-container"></div>
<script>
LangflowChatbotPlugin.init({
  containerId: 'chatbot-container',
  profileId: 'your-profile-id',
  proxyApiBasePath: '/api/langflow',
  mode: 'embedded' // optional - defaults to embedded when containerId provided
});
</script>
```

### Floating Mode
```html
<script>
LangflowChatbotPlugin.init({
  profileId: 'your-profile-id',
  proxyApiBasePath: '/api/langflow',
  mode: 'floating' // creates a floating chat widget
});
</script>
```

### Floating Mode with Container for Listeners
```html
<div id="my-chatbot-container"></div>
<script>
// Create floating chatbot but provide containerId for attaching listeners
const chatbot = await LangflowChatbotPlugin.init({
  containerId: 'my-chatbot-container', // For attaching listeners/custom behavior
  profileId: 'your-profile-id',
  proxyApiBasePath: '/api/langflow',
  mode: 'floating' // Explicitly specify floating mode
});

// Attach listeners to the container
const container = chatbot.getContainerElement();
if (container) {
  container.addEventListener('click', () => console.log('Container clicked!'));
  // Add any other custom behavior...
}
</script>
```

## Import Options

The package provides several convenient import paths:

```javascript
// Main exports (includes LangflowProxyService and other components)
const { LangflowProxyService } = require('langflow-chatbot');

// Direct access to specific modules
const { LangflowProxyService } = require('langflow-chatbot/langflow-proxy');

// Static assets
const pluginPath = require.resolve('langflow-chatbot/plugin');
const stylesPath = require.resolve('langflow-chatbot/styles');
```

## Local Development

For local testing with `npm link` or `file://` paths, the package will automatically build when installed thanks to the `prepare` script.

## Examples

See `examples/basic/server.ts` and `examples/basic/views/partials/chatbot.ejs` for complete working examples.

To run the basic example:

```bash
npm run examples:basic
```
