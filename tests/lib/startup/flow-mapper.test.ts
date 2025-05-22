import { LangflowClient } from '@datastax/langflow-client';
import {
    initializeFlowMappings
} from '../../../src/lib/startup/flow-mapper';
import { Profile } from '../../../src/types';
import { LANGFLOW_API_BASE_PATH_V1, LANGFLOW_FLOWS_ENDPOINT_SUFFIX } from '../../../src/config/apiPaths';

// Mock global.fetch
global.fetch = jest.fn();

// Mock console methods
const mockConsoleLog = jest.fn();
const mockConsoleError = jest.fn();
const mockConsoleWarn = jest.fn();
const mockConsoleDebug = jest.fn();

global.console = {
    ...global.console,
    log: mockConsoleLog,
    error: mockConsoleError,
    warn: mockConsoleWarn,
    debug: mockConsoleDebug,
};

const mockLangflowEndpoint = 'http://localhost:7860';

describe('initializeFlowMappings', () => {
    beforeEach(() => {
        // Reset fetch mock
        (global.fetch as jest.Mock).mockReset();
        // Reset console mocks
        mockConsoleLog.mockClear();
        mockConsoleError.mockClear();
        mockConsoleWarn.mockClear();
        mockConsoleDebug.mockClear();
    });

    test('should resolve flow names to IDs and update profiles, skipping UUIDs', async () => {
        const mockFlowsResponse = [
            {
                name: 'Flow One',
                endpoint_name: 'flow-one-endpoint',
                id: 'uuid-flow-one',
                description: 'Description for flow one',
                // ... other properties if needed
            },
            {
                name: 'Flow Two No Endpoint',
                // endpoint_name: null, // or missing
                id: 'uuid-flow-two',
                description: 'Flow two, no endpoint_name for direct mapping'
            },
            {
                name: 'Product Catalog Hybrid Search',
                endpoint_name: 'kinetic-constructs-hybrid-search',
                id: 'bf8a66b2-e708-45f5-a23c-9b0796a48d0d',
                description: 'Searches a product catalog using Hybrid Search',
                folder_id: 'c406ef88-00da-48ab-8656-f3d6fcd9a27c'
            }
        ];

        (global.fetch as jest.Mock).mockResolvedValueOnce({
            ok: true,
            json: async () => mockFlowsResponse,
            status: 200,
            statusText: 'OK'
        });

        const chatbotConfigurations = new Map<string, Profile>([
            ['profile1', { 
                profileId: 'profile1', 
                server: { flowId: 'flow-one-endpoint' }, 
                chatbot: { labels: { widgetTitle: 'Profile 1'} }
            }],
            ['profile2', { 
                profileId: 'profile2', 
                server: { flowId: 'kinetic-constructs-hybrid-search' }, 
                chatbot: { template: { messageTemplate: '<p></p>'} }
            }],
            ['profile3', { 
                profileId: 'profile3', 
                server: { flowId: '00000000-0000-0000-0000-000000000000' }, 
                chatbot: { floatingWidget: { useFloating: true } }
            }]
        ]);

        await initializeFlowMappings(mockLangflowEndpoint, 'test-api-key', chatbotConfigurations);

        const expectedUrl = new URL(`${LANGFLOW_API_BASE_PATH_V1}${LANGFLOW_FLOWS_ENDPOINT_SUFFIX}`, mockLangflowEndpoint);
        expectedUrl.searchParams.append('remove_example_flows', 'true');
        expectedUrl.searchParams.append('header_flows', 'true');
        expect(global.fetch).toHaveBeenCalledWith(expectedUrl.toString(), {
            method: 'GET',
            headers: { 'Accept': 'application/json', 'Authorization': 'Bearer test-api-key' }
        });

        expect(chatbotConfigurations.get('profile1')?.server.flowId).toBe('uuid-flow-one');
        expect(chatbotConfigurations.get('profile2')?.server.flowId).toBe('bf8a66b2-e708-45f5-a23c-9b0796a48d0d');
        expect(chatbotConfigurations.get('profile3')?.server.flowId).toBe('00000000-0000-0000-0000-000000000000'); // Unchanged

        expect(mockConsoleError).not.toHaveBeenCalled();
        expect(mockConsoleWarn).not.toHaveBeenCalled(); // Assuming all resolvable flow names are found
        expect(mockConsoleLog).toHaveBeenCalledWith("FlowMapper: Initializing flow mappings. Fetching all flows from Langflow...");
        expect(mockConsoleLog).toHaveBeenCalledWith(expect.stringContaining("FlowMapper: Resolved flow name 'flow-one-endpoint' to UUID 'uuid-flow-one' for profile 'profile1'."));
        expect(mockConsoleLog).toHaveBeenCalledWith(expect.stringContaining("FlowMapper: Resolved flow name 'kinetic-constructs-hybrid-search' to UUID 'bf8a66b2-e708-45f5-a23c-9b0796a48d0d' for profile 'profile2'."));
        expect(mockConsoleLog).toHaveBeenCalledWith(expect.stringContaining("FlowMapper: Profile 'profile3' uses a UUID for flowId '00000000-0000-0000-0000-000000000000'. No resolution needed."));
        expect(mockConsoleLog).toHaveBeenCalledWith(expect.stringContaining("FlowMapper: Finished flow resolution. All 2 flow names (if any) were resolved successfully."));
        expect(mockConsoleDebug).toHaveBeenCalledWith("FlowMapper: Flow 'Flow Two No Endpoint' (ID: uuid-flow-two) does not have a suitable endpoint_name for mapping. Received endpoint_name: 'undefined'. It will not be directly addressable by endpoint_name.");

    });

    test('should handle flows nested under a "records" key in the response', async () => {
        const mockFlowsResponse = {
            records: [
                { name: 'Flow A', endpoint_name: 'flow-a-endpoint', id: 'uuid-flow-a' }
            ]
        };
        (global.fetch as jest.Mock).mockResolvedValueOnce({
            ok: true,
            json: async () => mockFlowsResponse,
        });

        const chatbotConfigurations = new Map<string, Profile>([
            ['profileA', { 
                profileId: 'profileA', 
                server: { flowId: 'flow-a-endpoint' }, 
                chatbot: { labels: { userSender: 'User A'} }
            }]
        ]);

        await initializeFlowMappings(mockLangflowEndpoint, undefined, chatbotConfigurations);

        expect(chatbotConfigurations.get('profileA')?.server.flowId).toBe('uuid-flow-a');
        expect(mockConsoleError).not.toHaveBeenCalled();
    });

    test('should handle flows nested under a "flows" key in the response', async () => {
        const mockFlowsResponse = {
            flows: [
                { name: 'Flow B', endpoint_name: 'flow-b-endpoint', id: 'uuid-flow-b' }
            ]
        };
        (global.fetch as jest.Mock).mockResolvedValueOnce({
            ok: true,
            json: async () => mockFlowsResponse,
        });

        const chatbotConfigurations = new Map<string, Profile>([
            ['profileB', { 
                profileId: 'profileB', 
                server: { flowId: 'flow-b-endpoint' }, 
                chatbot: { template: { mainContainerTemplate: '<div></div>'} }
            }]
        ]);

        await initializeFlowMappings(mockLangflowEndpoint, 'another-key', chatbotConfigurations);
        
        const expectedUrl = new URL(`${LANGFLOW_API_BASE_PATH_V1}${LANGFLOW_FLOWS_ENDPOINT_SUFFIX}`, mockLangflowEndpoint);
        expectedUrl.searchParams.append('remove_example_flows', 'true');
        expectedUrl.searchParams.append('header_flows', 'true');
        expect(global.fetch).toHaveBeenCalledWith(expectedUrl.toString(), {
            method: 'GET',
            headers: { 'Accept': 'application/json', 'Authorization': 'Bearer another-key' }
        });

        expect(chatbotConfigurations.get('profileB')?.server.flowId).toBe('uuid-flow-b');
        expect(mockConsoleError).not.toHaveBeenCalled();
    });

    test('should handle API fetch failure (non-OK status)', async () => {
        (global.fetch as jest.Mock).mockResolvedValueOnce({
            ok: false,
            json: async () => ({ detail: 'Unauthorized' }),
            text: async () => 'Unauthorized API Key',
            status: 401,
            statusText: 'Unauthorized'
        });

        const chatbotConfigurations = new Map<string, Profile>();
        await initializeFlowMappings(mockLangflowEndpoint, 'bad-key', chatbotConfigurations);

        expect(mockConsoleError).toHaveBeenCalledWith("FlowMapper: CRITICAL - Error during flow ID resolution: Failed to fetch flows from Langflow. Status: 401 Unauthorized. Body: Unauthorized API Key");
    });

    test('should handle network error during fetch', async () => {
        (global.fetch as jest.Mock).mockRejectedValueOnce(new Error('Network connection failed'));

        const chatbotConfigurations = new Map<string, Profile>();
        await initializeFlowMappings(mockLangflowEndpoint, 'any-key', chatbotConfigurations);

        expect(mockConsoleError).toHaveBeenCalledWith("FlowMapper: CRITICAL - Error during flow ID resolution: Network connection failed");
    });

    test('should handle unexpected API response structure', async () => {
        (global.fetch as jest.Mock).mockResolvedValueOnce({
            ok: true,
            json: async () => ({ some_unexpected_key: [] }), // Neither array, nor .records, nor .flows
            status: 200,
            statusText: 'OK'
        });

        const chatbotConfigurations = new Map<string, Profile>();
        await initializeFlowMappings(mockLangflowEndpoint, 'any-key', chatbotConfigurations);
        
        expect(mockConsoleError).toHaveBeenCalledWith("FlowMapper: Unexpected response structure for flows list. Expected an array, or {records: [...]}, or {flows: [...]}. Response:", { some_unexpected_key: [] });
        expect(mockConsoleError).toHaveBeenCalledWith("FlowMapper: CRITICAL - Error during flow ID resolution: Unexpected response structure for flows list from Langflow.");
    });

    test('should warn and not update profile if a flow name cannot be resolved', async () => {
        const mockFlowsResponse = [
            { name: 'Existing Flow', endpoint_name: 'existing-flow', id: 'uuid-existing' }
        ];
        (global.fetch as jest.Mock).mockResolvedValueOnce({
            ok: true,
            json: async () => mockFlowsResponse,
        });

        const chatbotConfigurations = new Map<string, Profile>([
            ['profileUnresolved', { 
                profileId: 'profileUnresolved', 
                server: { flowId: 'non-existent-flow-name' }, 
                chatbot: { labels: { botSender: 'Bot Unresolved'} }
            }],
            ['profileResolved', { 
                profileId: 'profileResolved', 
                server: { flowId: 'existing-flow' }, 
                chatbot: { floatingWidget: { floatPosition: 'top-left'} }
            }]
        ]);

        await initializeFlowMappings(mockLangflowEndpoint, 'some-key', chatbotConfigurations);

        expect(chatbotConfigurations.get('profileUnresolved')?.server.flowId).toBe('non-existent-flow-name'); // Unchanged
        expect(chatbotConfigurations.get('profileResolved')?.server.flowId).toBe('uuid-existing'); // Resolved
        expect(mockConsoleError).toHaveBeenCalledWith("FlowMapper: CRITICAL - Could not resolve flow name 'non-existent-flow-name' for profile 'profileUnresolved'. This profile will not function correctly.");
        expect(mockConsoleWarn).toHaveBeenCalledWith("FlowMapper: Finished flow resolution. 1 profiles resolved. 1 profiles had unresolved flow names: profileUnresolved.");
    });

    test('should handle empty list of flows from API', async () => {
        (global.fetch as jest.Mock).mockResolvedValueOnce({
            ok: true,
            json: async () => [], // Empty array
        });

        const chatbotConfigurations = new Map<string, Profile>([
            ['profileWithFlowName', { 
                profileId: 'profileWithFlowName', 
                server: { flowId: 'some-flow-name' }, 
                chatbot: { labels: { widgetTitle: 'Test'} }
            }]
        ]);
        const originalFlowId = chatbotConfigurations.get('profileWithFlowName')?.server.flowId;

        await initializeFlowMappings(mockLangflowEndpoint, undefined, chatbotConfigurations);

        expect(chatbotConfigurations.get('profileWithFlowName')?.server.flowId).toBe(originalFlowId); // Unchanged
        expect(mockConsoleError).toHaveBeenCalledWith("FlowMapper: CRITICAL - Could not resolve flow name 'some-flow-name' for profile 'profileWithFlowName'. This profile will not function correctly.");
        expect(mockConsoleLog).toHaveBeenCalledWith("FlowMapper: Processed 0 flow entries, successfully mapped 0 flows by endpoint_name.");
    });

    test('should skip flow entries with missing or invalid id, name, or endpoint_name', async () => {
        const mockFlowsResponse = [
            { name: 'Valid Flow', endpoint_name: 'valid-flow', id: 'uuid-valid' },
            { name: 'Missing ID Flow', endpoint_name: 'missing-id' /* id is missing */ }, 
            { endpoint_name: 'missing-name', id: 'uuid-missing-name' /* name is missing */ },
            { name: 'Flow With Null ID', endpoint_name: 'flow-null-id', id: null },
            { name: 'Flow With Empty Endpoint Name', endpoint_name: ' ', id: 'uuid-empty-endpoint' },
            { name: 'Flow With Only Name', id: 'uuid-only-name' } // No endpoint_name, debug log expected
        ];
        (global.fetch as jest.Mock).mockResolvedValueOnce({
            ok: true,
            json: async () => mockFlowsResponse,
        });

        const chatbotConfigurations = new Map<string, Profile>([
            ['profileValid', { 
                profileId: 'profileValid', 
                server: { flowId: 'valid-flow' }, 
                chatbot: { labels: { errorSender: 'System Error'} }
            }]
        ]);

        await initializeFlowMappings(mockLangflowEndpoint, 'key', chatbotConfigurations);

        expect(chatbotConfigurations.get('profileValid')?.server.flowId).toBe('uuid-valid');
        expect(mockConsoleLog).toHaveBeenCalledWith("FlowMapper: Processed 6 flow entries, successfully mapped 2 flows by endpoint_name.");
        expect(mockConsoleDebug).toHaveBeenCalledTimes(4);
        expect(mockConsoleDebug).toHaveBeenCalledWith("FlowMapper: Skipping a flow entry from Langflow due to missing or invalid id, or unusable name/endpoint_name:", mockFlowsResponse[1]);
        expect(mockConsoleDebug).toHaveBeenCalledWith("FlowMapper: Skipping a flow entry from Langflow due to missing or invalid id, or unusable name/endpoint_name:", mockFlowsResponse[3]);
        expect(mockConsoleDebug).toHaveBeenCalledWith("FlowMapper: Flow 'Flow With Empty Endpoint Name' (ID: uuid-empty-endpoint) does not have a suitable endpoint_name for mapping. Received endpoint_name: ' '. It will not be directly addressable by endpoint_name.",);
        expect(mockConsoleDebug).toHaveBeenCalledWith("FlowMapper: Flow 'Flow With Only Name' (ID: uuid-only-name) does not have a suitable endpoint_name for mapping. Received endpoint_name: 'undefined'. It will not be directly addressable by endpoint_name.");
    });

    // Test cases will go here

}); 