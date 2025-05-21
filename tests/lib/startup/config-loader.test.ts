import { loadBaseConfig, loadInstanceConfig } from '../../../src/lib/startup/config-loader';

import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';
import {
    DEFAULT_ENABLE_STREAM,
    DEFAULT_USE_FLOATING,
    DEFAULT_FLOAT_POSITION,
    DEFAULT_WIDGET_TITLE,
    DEFAULT_USER_SENDER,
    DEFAULT_BOT_SENDER,
    DEFAULT_ERROR_SENDER,
    DEFAULT_SYSTEM_SENDER,
    DEFAULT_DATETIME_FORMAT,
    DEFAULT_MAIN_CONTAINER_TEMPLATE,
    DEFAULT_INPUT_AREA_TEMPLATE,
    DEFAULT_MESSAGE_TEMPLATE,
} from '../../../src/config/uiConstants';

// Mock the fs module (still needed for loadInstanceConfig)
jest.mock('fs');
const mockedFs = fs as jest.Mocked<typeof fs>;

// Store original path.resolve and prepare for spy
const originalPathResolve = path.resolve;
let mockPathResolve: jest.SpyInstance;

// Mock console.log to prevent jest-util errors and allow spying
global.console = {
    ...global.console,
    log: jest.fn(),
    error: jest.fn(), // Mock error as well if it's used by the module and causing issues
};

const EXPECTED_DEFAULT_CHATBOT_CONFIG = {
    enableStream: DEFAULT_ENABLE_STREAM,
    floatingWidget: {
        useFloating: DEFAULT_USE_FLOATING,
        floatPosition: DEFAULT_FLOAT_POSITION,
    },
    labels: {
        widgetTitle: DEFAULT_WIDGET_TITLE,
        userSender: DEFAULT_USER_SENDER,
        botSender: DEFAULT_BOT_SENDER,
        errorSender: DEFAULT_ERROR_SENDER,
        systemSender: DEFAULT_SYSTEM_SENDER,
    },
    datetimeFormat: DEFAULT_DATETIME_FORMAT,
    template: {
        mainContainerTemplate: DEFAULT_MAIN_CONTAINER_TEMPLATE,
        inputAreaTemplate: DEFAULT_INPUT_AREA_TEMPLATE,
        messageTemplate: DEFAULT_MESSAGE_TEMPLATE,
    },
};


describe('loadBaseConfig', () => {
    let originalEnv: NodeJS.ProcessEnv;

    beforeEach(() => {
        originalEnv = { ...process.env }; // Snapshot original environment
        // Clear potentially interfering env variables
        delete process.env.LANGFLOW_ENDPOINT_URL;
        delete process.env.LANGFLOW_API_KEY;

        (global.console.log as jest.Mock).mockClear();
        (global.console.error as jest.Mock).mockClear();
    });

    afterEach(() => {
        process.env = originalEnv; // Restore original environment
        jest.restoreAllMocks(); // Ensure mocks are reset, especially for process.env if modified elsewhere
    });

    test('should load configuration from environment variables and UI constants', () => {
        process.env.LANGFLOW_ENDPOINT_URL = 'http://env-test-url.com';
        process.env.LANGFLOW_API_KEY = 'env-test-api-key';

        const result = loadBaseConfig();

        expect(result.langflowConnection.endpoint_url).toBe('http://env-test-url.com');
        expect(result.langflowConnection.api_key).toBe('env-test-api-key');
        expect(result.chatbotDefaults).toEqual(EXPECTED_DEFAULT_CHATBOT_CONFIG);
        expect(global.console.log).toHaveBeenCalledWith('ConfigLoader: Loading base configuration from environment variables and UI constants.');
        expect(global.console.log).toHaveBeenCalledWith('ConfigLoader: Using LANGFLOW_ENDPOINT_URL from environment: http://env-test-url.com');
        expect(global.console.log).toHaveBeenCalledWith('ConfigLoader: Using LANGFLOW_API_KEY from environment.');
    });

    test('should allow LANGFLOW_API_KEY to be optional', () => {
        process.env.LANGFLOW_ENDPOINT_URL = 'http://another-env-url.com';
        // LANGFLOW_API_KEY is not set

        const result = loadBaseConfig();

        expect(result.langflowConnection.endpoint_url).toBe('http://another-env-url.com');
        expect(result.langflowConnection.api_key).toBeUndefined();
        expect(result.chatbotDefaults).toEqual(EXPECTED_DEFAULT_CHATBOT_CONFIG);
        expect(global.console.log).not.toHaveBeenCalledWith('ConfigLoader: Using LANGFLOW_API_KEY from environment.');
    });

    test('should throw an error if LANGFLOW_ENDPOINT_URL is not defined', () => {
        // LANGFLOW_ENDPOINT_URL is not set
        delete process.env.LANGFLOW_ENDPOINT_URL;

        expect(() => loadBaseConfig()).toThrow(
            'Langflow endpoint URL is not defined in environment variable LANGFLOW_ENDPOINT_URL.'
        );
    });
});

// Unchanged: describe('loadBaseConfig with environment variable overrides', () => { ... });
// This block can be removed or heavily simplified as its scenarios are covered above.
// For now, I'm commenting it out to avoid test duplication and ensure clarity.
/*
describe('loadBaseConfig with environment variable overrides', () => {
    let originalEnvSnapshot: NodeJS.ProcessEnv;
    // const mockFilePath = 'test-base-config.yaml'; // No longer needed
    // const resolvedMockPath = originalPathResolve(mockFilePath); // No longer needed

    beforeEach(() => {
        originalEnvSnapshot = { ...process.env };
        jest.resetModules(); // Important for re-requiring module with fresh env

        delete process.env.LANGFLOW_ENDPOINT_URL;
        delete process.env.LANGFLOW_API_KEY;

        if (global.console.log && (global.console.log as jest.Mock).mockClear) {
            (global.console.log as jest.Mock).mockClear();
        }
        
        // Mocking path.resolve is no longer needed for loadBaseConfig
        // if (mockPathResolve && mockPathResolve.mockRestore) {
        //     mockPathResolve.mockRestore();
        // }
        // mockPathResolve = jest.spyOn(path, 'resolve').mockImplementation((inputPath) => {
        //     if (inputPath === mockFilePath) return resolvedMockPath;
        //     return originalPathResolve(inputPath); 
        // });
    });

    afterEach(() => {
        process.env = originalEnvSnapshot; // Restore original environment

        // if (mockPathResolve && mockPathResolve.mockRestore) {
        //     mockPathResolve.mockRestore();
        // }
        jest.restoreAllMocks();
    });

    // These tests are now covered by the simplified `describe('loadBaseConfig', ...)` block above.
    // Keeping them would be redundant.
});
*/

describe('loadInstanceConfig', () => {
    beforeEach(() => {
        // Reset mocks for fs, path, and console
        mockedFs.existsSync.mockReset();
        mockedFs.readFileSync.mockReset();
        if (mockPathResolve) {
            mockPathResolve.mockRestore(); // Ensure spy is restored before re-applying
        }
        mockPathResolve = jest.spyOn(path, 'resolve'); // Re-apply spy
        (global.console.log as jest.Mock).mockClear();
    });

    afterEach(() => {
        if (mockPathResolve) {
            mockPathResolve.mockRestore();
        }
        jest.restoreAllMocks(); // General cleanup
    });

    test('should load and parse a valid instance configuration file', () => {
        const mockFilePath = 'valid-instance-config.yaml';
        const resolvedMockPath = originalPathResolve(mockFilePath); // For consistent path resolution in test
        const mockChatbots = [
            { proxyEndpointId: 'id1', flowId: 'flow1', bot_name: 'Bot1' },
            { proxyEndpointId: 'id2', flowId: 'flow2', temperature: 0.7 },
        ];
        const mockFileContent = yaml.dump({ chatbots: mockChatbots });

        // Setup mocks for this specific test
        mockPathResolve.mockImplementation((inputPath) => {
            if (inputPath === mockFilePath) return resolvedMockPath;
            return originalPathResolve(inputPath); // Fallback for other calls
        });
        mockedFs.existsSync.mockReturnValue(true);
        mockedFs.readFileSync.mockReturnValue(mockFileContent);

        const result = loadInstanceConfig(mockFilePath);

        expect(mockPathResolve).toHaveBeenCalledWith(mockFilePath);
        expect(mockedFs.existsSync).toHaveBeenCalledWith(resolvedMockPath);
        expect(mockedFs.readFileSync).toHaveBeenCalledWith(resolvedMockPath, 'utf-8');
        expect(result).toEqual(mockChatbots);
        expect(global.console.log).toHaveBeenCalledWith(`ConfigLoader: Loading instance-specific chatbot profiles from: ${resolvedMockPath}`);
    });

    test('should throw an error if the instance configuration file is not found', () => {
        const mockFilePath = 'non-existent-instance-config.yaml';
        const resolvedMockPath = originalPathResolve(mockFilePath);
        
        mockPathResolve.mockImplementation(inputPath => inputPath === mockFilePath ? resolvedMockPath : originalPathResolve(inputPath));
        mockedFs.existsSync.mockReturnValue(false);

        expect(() => loadInstanceConfig(mockFilePath)).toThrow(
            `Instance configuration file (YAML) not found at ${resolvedMockPath}.`
        );
        expect(mockedFs.readFileSync).not.toHaveBeenCalled();
    });

    test('should throw an error for invalid YAML content in instance config', () => {
        const mockFilePath = 'invalid-yaml-instance-config.yaml';
        const resolvedMockPath = originalPathResolve(mockFilePath);
        const mockInvalidFileContent = 'chatbots: [ { proxyEndpointId: "id1" :::: } ]';

        mockPathResolve.mockImplementation(inputPath => inputPath === mockFilePath ? resolvedMockPath : originalPathResolve(inputPath));
        mockedFs.existsSync.mockReturnValue(true);
        mockedFs.readFileSync.mockReturnValue(mockInvalidFileContent);

        expect(() => loadInstanceConfig(mockFilePath)).toThrow(yaml.YAMLException);
    });

    test('should throw an error if chatbots array is missing in instance config', () => {
        const mockFilePath = 'missing-chatbots-array-config.yaml';
        const resolvedMockPath = originalPathResolve(mockFilePath);
        const mockFileContent = yaml.dump({ some_other_key: 'value' }); 

        mockPathResolve.mockImplementation(inputPath => inputPath === mockFilePath ? resolvedMockPath : originalPathResolve(inputPath));
        mockedFs.existsSync.mockReturnValue(true);
        mockedFs.readFileSync.mockReturnValue(mockFileContent);

        expect(() => loadInstanceConfig(mockFilePath)).toThrow(
            `Instance YAML config missing required 'chatbots' array. Path: ${resolvedMockPath}`
        );
    });

    test('should throw an error if chatbots is not an array in instance config', () => {
        const mockFilePath = 'chatbots-not-array-config.yaml';
        const resolvedMockPath = originalPathResolve(mockFilePath);
        const mockFileContent = yaml.dump({ chatbots: { proxyEndpointId: 'id1' } }); 

        mockPathResolve.mockImplementation(inputPath => inputPath === mockFilePath ? resolvedMockPath : originalPathResolve(inputPath));
        mockedFs.existsSync.mockReturnValue(true);
        mockedFs.readFileSync.mockReturnValue(mockFileContent);

        expect(() => loadInstanceConfig(mockFilePath)).toThrow(
            `Instance YAML config missing required 'chatbots' array. Path: ${resolvedMockPath}`
        );
    });

    test('should return an empty array if chatbots is an empty array in instance config', () => {
        const mockFilePath = 'empty-chatbots-array-config.yaml';
        const resolvedMockPath = originalPathResolve(mockFilePath);
        const mockFileContent = yaml.dump({ chatbots: [] });

        mockPathResolve.mockImplementation(inputPath => inputPath === mockFilePath ? resolvedMockPath : originalPathResolve(inputPath));
        mockedFs.existsSync.mockReturnValue(true);
        mockedFs.readFileSync.mockReturnValue(mockFileContent);

        const result = loadInstanceConfig(mockFilePath);
        expect(result).toEqual([]);
    });
}); 