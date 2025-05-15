# langflow-chatbot

A Node.js package for interacting with Langflow using [@datastax/langflow-client](https://www.npmjs.com/package/@datastax/langflow-client).

## Installation

```bash
npm install langflow-chatbot
```

## Usage

This package re-exports `LangflowClient` from `@datastax/langflow-client` for convenience.

```typescript
import { LangflowClient } from "langflow-chatbot";

const client = new LangflowClient({
  baseUrl: "http://localhost:7860", // or your Langflow instance URL
  apiKey: "your-api-key" // if required
});

// Example: run a flow
const flowId = "your-flow-id";
const response = await client.flow(flowId).run("Hello!");
console.log(response.outputs);
```

See the [@datastax/langflow-client documentation](https://www.npmjs.com/package/@datastax/langflow-client) for more details on configuration and advanced usage.
