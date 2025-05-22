// Standalone, static paths (no dynamic parameters)
export const PROXY_PROFILES_SUFFIX = '/profiles'; // Path for listing available chatbot profiles
export const PROXY_FLOWS_SUFFIX = '/flows-config'; // Path for listing available langflow flows

// Prefixes for routes that include a dynamic :profileId
export const PROFILE_CONFIG_ENDPOINT_PREFIX = '/config'; // e.g., /api/langflow/config/:profileId
export const PROFILE_CHAT_ENDPOINT_PREFIX = '/chat'; // e.g., /api/langflow/chat/:profileId, and /api/langflow/chat/:profileId/history

// Langflow specific API base path (version 1)
export const LANGFLOW_API_BASE_PATH_V1 = '/api/v1';

// Suffix for Langflow flows endpoint (listing, creating, etc.)
export const LANGFLOW_FLOWS_ENDPOINT_SUFFIX = '/flows/';  // Trailing slash is required!

// Suffix for Langflow chat endpoint (within a specific flow)
export const LANGFLOW_CHAT_ENDPOINT_SUFFIX = '/chat'; // e.g. /api/v1/chat/{flow_id}