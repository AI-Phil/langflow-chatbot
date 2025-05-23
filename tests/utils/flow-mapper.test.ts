import {
    FlowMapper
} from '../../src/utils/flow-mapper';
import { LANGFLOW_API_BASE_PATH_V1, LANGFLOW_FLOWS_ENDPOINT_SUFFIX } from '../../src/config/apiPaths';

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

describe('FlowMapper', () => {
    let flowMapper: FlowMapper;

    beforeEach(() => {
        // Reset fetch mock
        (global.fetch as jest.Mock).mockReset();
        // Reset console mocks
        mockConsoleLog.mockClear();
        mockConsoleError.mockClear();
        mockConsoleWarn.mockClear();
        mockConsoleDebug.mockClear();
        // Initialize FlowMapper before each test that needs it
        // Some tests might mock its initialization differently
    });

    test('initialize: should fetch flows and build the name-to-ID map', async () => {
        const mockFlowsResponse = [
            {
                name: 'Flow One',
                endpoint_name: 'flow-one-endpoint',
                id: 'uuid-flow-one',
            },
            {
                name: 'Flow Two No Endpoint',
                id: 'uuid-flow-two',
            },
            {
                name: 'Product Catalog Hybrid Search',
                endpoint_name: 'kinetic-constructs-hybrid-search',
                id: 'bf8a66b2-e708-45f5-a23c-9b0796a48d0d',
            }
        ];

        (global.fetch as jest.Mock).mockResolvedValueOnce({
            ok: true,
            json: async () => mockFlowsResponse,
            status: 200,
            statusText: 'OK'
        });

        flowMapper = new FlowMapper(mockLangflowEndpoint, 'test-api-key');
        await flowMapper.initialize();

        const expectedUrl = new URL(`${LANGFLOW_API_BASE_PATH_V1}${LANGFLOW_FLOWS_ENDPOINT_SUFFIX}`, mockLangflowEndpoint);
        expectedUrl.searchParams.append('remove_example_flows', 'true');
        expectedUrl.searchParams.append('header_flows', 'true');
        expect(global.fetch).toHaveBeenCalledWith(expectedUrl.toString(), {
            method: 'GET',
            headers: { 'Accept': 'application/json', 'Authorization': 'Bearer test-api-key' }
        });

        expect(mockConsoleLog).toHaveBeenCalledWith("FlowMapper: Initializing - fetching all flows from Langflow...");
        expect(mockConsoleLog).toHaveBeenCalledWith(expect.stringContaining("FlowMapper: Initialization complete. Processed 3 flow entries, successfully mapped 3 flows by name/endpoint_name."));
        // Check if Flow Two No Endpoint was mapped by name as a fallback
        expect(mockConsoleDebug).toHaveBeenCalledWith(expect.stringContaining("FlowMapper: Flow 'Flow Two No Endpoint' (ID: uuid-flow-two) mapped by its 'name' as 'endpoint_name' was not suitable"));
        expect(mockConsoleError).not.toHaveBeenCalled();
    });

    test('getTrueFlowId: should return UUID for valid endpoint_name after initialization', async () => {
        const mockFlowsResponse = [
            { name: 'Flow One', endpoint_name: 'flow-one-endpoint', id: 'uuid-flow-one' }
        ];
        (global.fetch as jest.Mock).mockResolvedValueOnce({
            ok: true, json: async () => mockFlowsResponse, status: 200, statusText: 'OK'
        });

        flowMapper = new FlowMapper(mockLangflowEndpoint);
        await flowMapper.initialize();

        expect(flowMapper.getTrueFlowId('flow-one-endpoint')).toBe('uuid-flow-one');
    });

    test('getTrueFlowId: should return UUID for valid name (as fallback) after initialization', async () => {
        const mockFlowsResponse = [
            { name: 'FlowOnlyByName', id: 'uuid-name-only' } // No endpoint_name
        ];
        (global.fetch as jest.Mock).mockResolvedValueOnce({
            ok: true, json: async () => mockFlowsResponse, status: 200, statusText: 'OK'
        });

        flowMapper = new FlowMapper(mockLangflowEndpoint);
        await flowMapper.initialize();
        expect(flowMapper.getTrueFlowId('FlowOnlyByName')).toBe('uuid-name-only');
    });

    test('getTrueFlowId: should return the identifier itself if it is a UUID', async () => {
        flowMapper = new FlowMapper(mockLangflowEndpoint);
        // No initialization needed as it should directly return UUIDs
        const testUuid = '00000000-0000-0000-0000-000000000000';
        expect(flowMapper.getTrueFlowId(testUuid)).toBe(testUuid);
    });

    test('getTrueFlowId: should return undefined for unresolved name after initialization', async () => {
        const mockFlowsResponse = [
            { name: 'Existing Flow', endpoint_name: 'existing-flow', id: 'uuid-existing' }
        ];
        (global.fetch as jest.Mock).mockResolvedValueOnce({
            ok: true, json: async () => mockFlowsResponse, status: 200, statusText: 'OK'
        });

        flowMapper = new FlowMapper(mockLangflowEndpoint);
        await flowMapper.initialize();

        expect(flowMapper.getTrueFlowId('non-existent-flow-name')).toBeUndefined();
    });

    test('initialize: should handle flows nested under a "records" key', async () => {
        const mockFlowsResponse = {
            records: [
                { name: 'Flow A', endpoint_name: 'flow-a-endpoint', id: 'uuid-flow-a' }
            ]
        };
        (global.fetch as jest.Mock).mockResolvedValueOnce({
            ok: true, json: async () => mockFlowsResponse, status: 200, statusText: 'OK'
        });
        flowMapper = new FlowMapper(mockLangflowEndpoint);
        await flowMapper.initialize();
        expect(flowMapper.getTrueFlowId('flow-a-endpoint')).toBe('uuid-flow-a');
        expect(mockConsoleError).not.toHaveBeenCalled();
    });

    test('initialize: should handle flows nested under a "flows" key', async () => {
        const mockFlowsResponse = {
            flows: [
                { name: 'Flow B', endpoint_name: 'flow-b-endpoint', id: 'uuid-flow-b' }
            ]
        };
        (global.fetch as jest.Mock).mockResolvedValueOnce({
            ok: true, json: async () => mockFlowsResponse, status: 200, statusText: 'OK'
        });
        flowMapper = new FlowMapper(mockLangflowEndpoint, 'api-key-here');
        await flowMapper.initialize();

        const expectedUrl = new URL(`${LANGFLOW_API_BASE_PATH_V1}${LANGFLOW_FLOWS_ENDPOINT_SUFFIX}`, mockLangflowEndpoint);
        expectedUrl.searchParams.append('remove_example_flows', 'true');
        expectedUrl.searchParams.append('header_flows', 'true');
        expect(global.fetch).toHaveBeenCalledWith(expectedUrl.toString(), {
            method: 'GET',
            headers: { 'Accept': 'application/json', 'Authorization': 'Bearer api-key-here' }
        });
        expect(flowMapper.getTrueFlowId('flow-b-endpoint')).toBe('uuid-flow-b');
        expect(mockConsoleError).not.toHaveBeenCalled();
    });

    test('initialize: should handle API fetch failure (non-OK status)', async () => {
        (global.fetch as jest.Mock).mockResolvedValueOnce({
            ok: false,
            json: async () => ({ detail: 'Unauthorized' }),
            text: async () => 'Unauthorized API Key',
            status: 401,
            statusText: 'Unauthorized'
        });

        flowMapper = new FlowMapper(mockLangflowEndpoint, 'bad-key');
        await expect(flowMapper.initialize()).rejects.toThrow(
            'FlowMapper: Failed to fetch flows from Langflow. Status: 401 Unauthorized. Body: Unauthorized API Key'
        );
        expect(mockConsoleError).toHaveBeenCalledWith("FlowMapper: CRITICAL - Error during flow map initialization: FlowMapper: Failed to fetch flows from Langflow. Status: 401 Unauthorized. Body: Unauthorized API Key");
    });

    test('initialize: should handle network error during fetch', async () => {
        (global.fetch as jest.Mock).mockRejectedValueOnce(new Error('Network connection failed'));

        flowMapper = new FlowMapper(mockLangflowEndpoint, 'any-key');
        await expect(flowMapper.initialize()).rejects.toThrow('Network connection failed');
        expect(mockConsoleError).toHaveBeenCalledWith("FlowMapper: CRITICAL - Error during flow map initialization: Network connection failed");
    });

    test('initialize: should handle unexpected API response structure', async () => {
        (global.fetch as jest.Mock).mockResolvedValueOnce({
            ok: true,
            json: async () => ({ some_unexpected_key: [] }),
            status: 200,
            statusText: 'OK'
        });

        flowMapper = new FlowMapper(mockLangflowEndpoint, 'any-key');
        await expect(flowMapper.initialize()).rejects.toThrow(
            'FlowMapper: Unexpected response structure for flows list from Langflow.'
        );
        expect(mockConsoleError).toHaveBeenCalledWith("FlowMapper: Unexpected response structure for flows list. Expected an array, or {records: [...]}, or {flows: [...]}. Response:", { some_unexpected_key: [] });
        expect(mockConsoleError).toHaveBeenCalledWith("FlowMapper: CRITICAL - Error during flow map initialization: FlowMapper: Unexpected response structure for flows list from Langflow.");
    });

    test('getTrueFlowId: should return undefined if called with non-existent name and empty API response', async () => {
        (global.fetch as jest.Mock).mockResolvedValueOnce({
            ok: true,
            json: async () => [], // Empty array
            status: 200,
            statusText: 'OK'
        });

        flowMapper = new FlowMapper(mockLangflowEndpoint);
        await flowMapper.initialize();

        expect(flowMapper.getTrueFlowId('some-flow-name')).toBeUndefined();
        expect(mockConsoleLog).toHaveBeenCalledWith("FlowMapper: Initialization complete. Processed 0 flow entries, successfully mapped 0 flows by name/endpoint_name.");
    });

    test('initialize: should skip flows with missing/invalid id, or unusable name/endpoint_name', async () => {
        const mockFlowsResponse = [
            { name: 'Valid Flow', endpoint_name: 'valid-flow', id: 'uuid-valid' }, // Mapped by endpoint_name
            { name: 'Missing ID Flow', endpoint_name: 'missing-id' /* id is missing */ }, // Skipped
            { name: 'Flow With Only Name', id: 'uuid-only-name' }, // Mapped by name
            { endpoint_name: 'missing-name-but-has-id', id: 'uuid-missing-name' /* name is missing, endpoint_name is present */}, // Mapped by endpoint_name
            { name: 'Flow With Null ID', endpoint_name: 'flow-null-id', id: null }, // Skipped
            { name: 'Flow With Empty Endpoint Name', endpoint_name: ' ', id: 'uuid-empty-endpoint' }, // Mapped by name 'Flow With Empty Endpoint Name'
            { name: 'Duplicate Name', id: 'uuid-duplicate-1'},
            { name: 'Duplicate Name', endpoint_name: 'duplicate-ep', id: 'uuid-duplicate-2'} // endpoint_name takes precedence
        ];
        (global.fetch as jest.Mock).mockResolvedValueOnce({
            ok: true,
            json: async () => mockFlowsResponse,
            status: 200,
            statusText: 'OK'
        });

        flowMapper = new FlowMapper(mockLangflowEndpoint, 'key');
        await flowMapper.initialize();

        expect(flowMapper.getTrueFlowId('valid-flow')).toBe('uuid-valid');
        expect(flowMapper.getTrueFlowId('missing-id')).toBeUndefined();
        expect(flowMapper.getTrueFlowId('Flow With Only Name')).toBe('uuid-only-name');
        expect(flowMapper.getTrueFlowId('missing-name-but-has-id')).toBe('uuid-missing-name');
        expect(flowMapper.getTrueFlowId('flow-null-id')).toBeUndefined();
        expect(flowMapper.getTrueFlowId('Flow With Empty Endpoint Name')).toBe('uuid-empty-endpoint');
        expect(flowMapper.getTrueFlowId('duplicate-ep')).toBe('uuid-duplicate-2');
        // Since 'duplicate-ep' (endpoint_name) for 'uuid-duplicate-2' would have mapped, 
        // 'Duplicate Name' (name) for 'uuid-duplicate-1' would not be mapped if 'duplicate-ep' was processed first and had the same name.
        // However, our logic prioritizes endpoint_name. If flow for uuid-duplicate-2 is processed first, 'duplicate-ep' is mapped.
        // If flow for uuid-duplicate-1 is processed first, 'Duplicate Name' is mapped to 'uuid-duplicate-1'.
        // Then when uuid-duplicate-2 is processed, 'duplicate-ep' is mapped to 'uuid-duplicate-2'.
        // The map should correctly reflect endpoint_name priority.
        // If 'Duplicate Name' was the identifier, it should resolve to 'uuid-duplicate-1' if that flow object came first and did not have an endpoint_name.
        // Let's clarify the behavior for the test: if a name is already used, it won't be overwritten by another flow's name (only by endpoint_name).
        // In this specific order, 'uuid-duplicate-1' maps 'Duplicate Name'. Then 'uuid-duplicate-2' maps 'duplicate-ep'.
        expect(flowMapper.getTrueFlowId('Duplicate Name')).toBe('uuid-duplicate-1');


        expect(mockConsoleLog).toHaveBeenCalledWith("FlowMapper: Initialization complete. Processed 8 flow entries, successfully mapped 6 flows by name/endpoint_name.");
        expect(mockConsoleDebug).toHaveBeenCalledWith("FlowMapper: Skipping a flow entry from Langflow due to missing or invalid id:", mockFlowsResponse[1]);
        expect(mockConsoleDebug).toHaveBeenCalledWith("FlowMapper: Flow 'Flow With Only Name' (ID: uuid-only-name) mapped by its 'name' as 'endpoint_name' was not suitable. Ensure names are unique if used for mapping.");
        expect(mockConsoleDebug).toHaveBeenCalledWith("FlowMapper: Skipping a flow entry from Langflow due to missing or invalid id:", mockFlowsResponse[4]);
        expect(mockConsoleDebug).toHaveBeenCalledWith("FlowMapper: Flow 'Flow With Empty Endpoint Name' (ID: uuid-empty-endpoint) mapped by its 'name' as 'endpoint_name' was not suitable. Ensure names are unique if used for mapping.");
        // For the duplicate name scenario:
        // Flow 'Duplicate Name' (ID: uuid-duplicate-1) mapped by its 'name'
        expect(mockConsoleDebug).toHaveBeenCalledWith("FlowMapper: Flow 'Duplicate Name' (ID: uuid-duplicate-1) mapped by its 'name' as 'endpoint_name' was not suitable. Ensure names are unique if used for mapping.");
        // Flow 'Duplicate Name' (ID: uuid-duplicate-2) with endpoint_name 'duplicate-ep' would just map 'duplicate-ep'.

    });

    test('getTrueFlowId: should warn if called before initialization and return undefined for non-UUIDs', () => {
        flowMapper = new FlowMapper(mockLangflowEndpoint);
        // DO NOT call await flowMapper.initialize();
        expect(flowMapper.getTrueFlowId('some-name')).toBeUndefined();
        expect(mockConsoleWarn).toHaveBeenCalledWith("FlowMapper: getTrueFlowId called before successful initialization. Results may be incorrect.");
    });

    test('getTrueFlowId: should warn if called before initialization but still return UUID for UUIDs', () => {
        flowMapper = new FlowMapper(mockLangflowEndpoint);
        const testUuid = '123e4567-e89b-12d3-a456-426614174000';
        // DO NOT call await flowMapper.initialize();
        expect(flowMapper.getTrueFlowId(testUuid)).toBe(testUuid);
        // It should still warn because initialization status is checked first in getTrueFlowId
        expect(mockConsoleWarn).toHaveBeenCalledWith("FlowMapper: getTrueFlowId called before successful initialization. Results may be incorrect.");
    });

    test('getTrueFlowId: should return undefined and warn for invalid identifier types', () => {
        flowMapper = new FlowMapper(mockLangflowEndpoint);
        // @ts-expect-error testing invalid input
        expect(flowMapper.getTrueFlowId(null)).toBeUndefined();
        expect(mockConsoleWarn).toHaveBeenCalledWith(expect.stringContaining("FlowMapper: Invalid identifier provided to getTrueFlowId: null"));
        // @ts-expect-error testing invalid input
        expect(flowMapper.getTrueFlowId(undefined)).toBeUndefined();
        expect(mockConsoleWarn).toHaveBeenCalledWith(expect.stringContaining("FlowMapper: Invalid identifier provided to getTrueFlowId: undefined"));
        // @ts-expect-error testing invalid input
        expect(flowMapper.getTrueFlowId(123)).toBeUndefined();
        expect(mockConsoleWarn).toHaveBeenCalledWith(expect.stringContaining("FlowMapper: Invalid identifier provided to getTrueFlowId: 123"));
    });

    test('initialize: calling initialize multiple times should only fetch once', async () => {
        const mockFlowsResponse = [{ name: 'Flow One', endpoint_name: 'flow-one-endpoint', id: 'uuid-flow-one' }];
        (global.fetch as jest.Mock).mockResolvedValueOnce({
            ok: true, json: async () => mockFlowsResponse, status: 200, statusText: 'OK'
        });

        flowMapper = new FlowMapper(mockLangflowEndpoint);
        await flowMapper.initialize(); // First call
        await flowMapper.initialize(); // Second call

        expect(global.fetch).toHaveBeenCalledTimes(1); // Should only be called once
        expect(mockConsoleLog).toHaveBeenCalledWith("FlowMapper: Already initialized."); // From the second call
    });

}); 