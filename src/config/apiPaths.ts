export const PROXY_BASE_API_PATH = '/api/langflow';

// Standalone, static paths (no dynamic parameters)
export const PROXY_PROFILES_PATH = `${PROXY_BASE_API_PATH}/profiles`; // Path for listing available chatbot profiles
export const PROXY_FLOWS_PATH = `${PROXY_BASE_API_PATH}/flows-config`; // Path for listing available langflow flows

// Suffix for listing all available flows
export const PROXY_FLOWS_CONFIG_ENDPOINT_SUFFIX = '/flows_config';

// Suffix for listing available chatbot profiles
export const PROXY_PROFILES_LIST_SUFFIX = '/profiles'; // e.g., /api/langflow/profiles

// Prefixes for routes that include a dynamic :profileId
export const PROXY_CONFIG_ENDPOINT_PREFIX = '/config'; // e.g., /api/langflow/config/:profileId
export const PROXY_CHAT_MESSAGES_ENDPOINT_PREFIX = '/chat'; // e.g., /api/langflow/chat/:profileId, and /api/langflow/chat/:profileId/history

// Full path for listing all available flows
export const PROXY_FLOWS_PATH_FULL = PROXY_BASE_API_PATH + PROXY_FLOWS_CONFIG_ENDPOINT_SUFFIX;

// Full path for listing available chatbot profiles
export const PROXY_PROFILES_PATH_FULL = PROXY_BASE_API_PATH + PROXY_PROFILES_LIST_SUFFIX;

// Langflow specific API base path (version 1)
export const LANGFLOW_API_BASE_PATH_V1 = '/api/v1';

// Suffix for Langflow flows endpoint (listing, creating, etc.)
export const LANGFLOW_FLOWS_ENDPOINT_SUFFIX = '/flows';

// Suffix for Langflow chat endpoint (within a specific flow)
export const LANGFLOW_CHAT_ENDPOINT_SUFFIX = '/chat'; // e.g. /api/v1/chat/{flow_id}