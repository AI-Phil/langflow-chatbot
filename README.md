# langflow-chatbot

A toolkit for embedding Langflow-powered chatbots in your app, with both server (proxy) and browser plugin components.

## Configuration

Chatbot profiles and flow mappings are defined in a YAML file (see `examples/basic/app-chatbots.yaml`).

Langflow connection details (endpoint URL, API key) can be set in the YAML or via environment variables (see `.env.example`).

**Environment variables override YAML for connection details.**

## Proxy Example (Node.js/Express)

```ts
import express from 'express';
import { LangflowProxyService } from 'langflow-chatbot';

const app = express();
const proxy = new LangflowProxyService({
  instanceConfigPath: './app-chatbots.yaml',
  proxyApiBasePath: '/api/langflow',
});
app.use(express.json());
app.all('/api/langflow/*', (req, res) => proxy.handleRequest(req, res));
app.listen(3001);
```

## Browser Plugin Example

### Embedded Mode (default when containerId provided)
```html
<div id="chatbot-container"></div>
<script src="/static/LangflowChatbotPlugin.js"></script>
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
<script src="/static/LangflowChatbotPlugin.js"></script>
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
<script src="/static/LangflowChatbotPlugin.js"></script>
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

See `examples/basic/server.ts` and `examples/basic/views/partials/chatbot.ejs` for more details.
