# langflow-chatbot

A toolkit for embedding Langflow-powered chatbots in your app, with both server (proxy) and browser plugin components.

## 📋 Table of Contents

- [Installation](#installation)
- [Quick Start](#quick-start)
  - [Server Setup](#1-server-setup-nodejsexpress)
  - [Browser Integration](#2-browser-integration)
- [Configuration](#configuration)
- [Usage Examples](#usage-examples)
  - [Embedded Mode](#embedded-mode-default-when-containerid-provided)
  - [Floating Mode](#floating-mode)
  - [Advanced Usage](#floating-mode-with-container-for-listeners)
- [Import Options](#import-options)
- [Local Development](#local-development)
- [Examples](#examples)

## Installation

```bash
npm install langflow-chatbot
```

## Quick Start

### 1. Server Setup (Node.js/Express)

<details>
<summary>Click to expand server setup instructions</summary>

#### Step 1: Environment Variables (Recommended)

Create a `.env` file for Langflow connection settings:

```bash
# .env
LANGFLOW_ENDPOINT_URL=http://localhost:7860
LANGFLOW_API_KEY=your-api-key-here  # Optional: only if your Langflow instance requires keys
```

#### Step 2: Create Configuration File

Create an `app-chatbots.yaml` file in your project root:

```yaml
# app-chatbots.yaml
langflow_connection:
  # These values are used as fallbacks if environment variables are not set
  endpoint_url: "http://localhost:7860"  # Fallback for LANGFLOW_ENDPOINT_URL
  # api_key: ""  # Fallback for LANGFLOW_API_KEY (leave commented if not needed)

profiles:
  - profileId: "my-chatbot"  # Unique identifier for this chatbot profile
    server:
      flowId: "your-flow-id"  # The ID of your Langflow flow
    chatbot:
      floatingWidget:
        useFloating: false  # Set to true for floating widget mode
      labels:
        widgetTitle: "My Chatbot"
        botSender: "Assistant"
        welcomeMessage: "Hello! How can I help you today?"
```

> **Configuration Priority:** Environment variables (`LANGFLOW_ENDPOINT_URL`, `LANGFLOW_API_KEY`) take precedence over YAML values. Use environment variables for sensitive data and deployment-specific settings.

#### Step 3: Server Code

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
app.use('/static/langflow-chatbot-plugin.js', express.static(
  require.resolve('langflow-chatbot/plugin')
));
app.use('/static/langflow-chatbot.css', express.static(
  require.resolve('langflow-chatbot/styles')
));

// Handle chatbot API requests
app.all('/api/langflow/*', (req, res) => proxy.handleRequest(req, res));

app.listen(3001);
```

</details>

### 2. Browser Integration

Include the CSS and JavaScript files in your HTML:

```html
<link rel="stylesheet" href="/static/langflow-chatbot.css">
<script src="/static/langflow-chatbot-plugin.js"></script>
```

## Configuration

<details>
<summary>Configuration Details</summary>

Chatbot profiles and flow mappings are defined in a YAML file (see `examples/basic/app-chatbots.yaml`).

Langflow connection details (endpoint URL, API key) can be set in the YAML or via environment variables (see `.env.example`).

**Environment variables override YAML for connection details.**

</details>

## Usage Examples

### Embedded Mode (default when containerId provided)

<details>
<summary>View embedded mode example</summary>

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

</details>

### Floating Mode

<details>
<summary>View floating mode example</summary>

```html
<script>
LangflowChatbotPlugin.init({
  profileId: 'your-profile-id',
  proxyApiBasePath: '/api/langflow',
  mode: 'floating' // creates a floating chat widget
});
</script>
```

</details>

### Floating Mode with Container for Listeners

<details>
<summary>View advanced floating mode example</summary>

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

</details>

## Import Options

<details>
<summary>Available import paths</summary>

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

</details>

## Local Development

<details>
<summary>Development setup</summary>

For local testing with `npm link` or `file://` paths, the package will automatically build when installed thanks to the `prepare` script.

</details>

## Examples

<details>
<summary>Complete setup guide for the basic example</summary>

### Prerequisites

#### 1. Set up Langflow

Install and run Langflow if you have not already. See the [Langflow Getting Started](https://docs.langflow.org/get-started-installation) docs.

If you have Langflow running somewhere other than [`http://localhost:7860`](http://localhost:7860), be sure to have that set in either `.env` or
in file `examples/basic/app-chatbots.yaml`.

#### 2. Import the Memory Chatbot Flow

1. Open Langflow in your browser at `http://localhost:7860`
2. Click "New Flow" or the import button
3. Import the flow file: `examples/basic/Memory Chatbot.json`
4. The flow will load with Chat Input → Memory → Prompt → OpenAI → Chat Output components

#### 3. Configure OpenAI API Key

1. In the imported flow, click on the **OpenAI** component
2. In the component settings, find the **"OpenAI API Key"** field
3. Enter your OpenAI API key (get one from [OpenAI's API Key Page](https://platform.openai.com/api-keys))
4. Save the flow

### Running the Example

Once Langflow is set up with the imported flow:

```bash
npm run examples:basic
```

The server will start and display the URL where it's running (Node.js will automatically pick an available port). Look for the console output:

```
Server running at http://127.0.0.1:3000/
```

Open that URL in your browser to see the chatbot integrated into the example page.

### Example Files

- `examples/basic/server.ts` - Complete Express server setup
- `examples/basic/views/partials/chatbot.ejs` - Frontend integration
- `examples/basic/Memory Chatbot.json` - Langflow flow definition
- `examples/basic/app-chatbots.yaml` - Chatbot configuration

</details>
