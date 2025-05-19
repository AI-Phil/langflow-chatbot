export const PROXY_BASE_API_PATH = '/api/langflow';

// Suffix for specific, global operations
export const PROXY_FLOWS_CONFIG_ENDPOINT_SUFFIX = '/flows_config'; // For listing all available flows

// Prefixes for routes that will include a dynamic :proxyEndpointId
export const PROXY_CONFIG_ENDPOINT_PREFIX = '/config'; // e.g., /api/langflow/config/:proxyEndpointId
export const PROXY_CHAT_MESSAGES_ENDPOINT_PREFIX = '/chat'; // e.g., /api/langflow/chat/:proxyEndpointId
                                                       // History will be e.g., /api/langflow/chat/:proxyEndpointId/history

// Full paths for global operations
export const PROXY_FLOWS_PATH = PROXY_BASE_API_PATH + PROXY_FLOWS_CONFIG_ENDPOINT_SUFFIX;

// The old PROXY_MESSAGES_PATH (for history) is removed.
// Client should use profile-specific history endpoint: 
// PROXY_BASE_API_PATH + PROXY_CHAT_MESSAGES_ENDPOINT_PREFIX + '/' + proxyEndpointId + '/history'

// Note: The old PROXY_CHAT_PATH has been removed as chat is now routed via
// PROXY_BASE_API_PATH + PROXY_CHAT_MESSAGES_ENDPOINT_PREFIX + :proxyEndpointId

// New constant for listing available chatbot profiles
export const PROXY_PROFILES_LIST_SUFFIX = '/profiles'; // e.g., /api/langflow/profiles
export const PROXY_PROFILES_PATH = PROXY_BASE_API_PATH + PROXY_PROFILES_LIST_SUFFIX;
