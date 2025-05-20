import { loadBaseConfig, loadInstanceConfig } from '../src/lib/startup/config-loader';
import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';

// Mock the fs module
jest.mock('fs');
const mockedFs = fs as jest.Mocked<typeof fs>;

// Store original path.resolve and prepare for spy
const originalPathResolve = path.resolve;
let mockPathResolve: jest.SpyInstance;

// Mock console.log to prevent jest-util errors and allow spying
global.console = {
    ...global.console, // Keep other console methods like .error, .warn
    log: jest.fn(), // Mock console.log
    // If other console methods also cause issues, they can be mocked similarly
    // error: jest.fn(),
    // warn: jest.fn(),
    // info: jest.fn(),
    // debug: jest.fn(),
};


describe('loadBaseConfig', () => {
    beforeEach(() => {
        mockedFs.existsSync.mockReset();
        mockedFs.readFileSync.mockReset();
        (global.console.log as jest.Mock).mockClear(); // Clear mock calls before each test

        if (mockPathResolve) {
            mockPathResolve.mockRestore();
        }
        mockPathResolve = jest.spyOn(path, 'resolve');
    });

    afterEach(() => {
        if (mockPathResolve) {
            mockPathResolve.mockRestore();
        }
        jest.restoreAllMocks();
    });

    test('should load and parse a valid base configuration file', () => {
        const mockFilePath = 'valid-base-config.yaml';
        const resolvedMockPath = originalPathResolve(mockFilePath); // Use original for test setup consistency
        const mockFileContent = yaml.dump({
            langflow_connection: {
                endpoint_url: 'http://localhost:7860',
                api_key: 'test-api-key'
            },
            chatbot_defaults: {
                bot_name: 'TestBot',
                temperature: 0.5
            }
        });

        mockedFs.existsSync.mockReturnValue(true);
        mockedFs.readFileSync.mockReturnValue(mockFileContent);
        mockPathResolve.mockImplementation((inputPath) => {
            if (inputPath === mockFilePath) return resolvedMockPath;
            return originalPathResolve(inputPath); // Fallback to original
        });

        const result = loadBaseConfig(mockFilePath);

        expect(mockPathResolve).toHaveBeenCalledWith(mockFilePath);
        expect(mockedFs.existsSync).toHaveBeenCalledWith(resolvedMockPath);
        expect(mockedFs.readFileSync).toHaveBeenCalledWith(resolvedMockPath, 'utf-8');
        expect(result).toEqual({
            langflowConnection: {
                endpoint_url: 'http://localhost:7860',
                api_key: 'test-api-key'
            },
            chatbotDefaults: {
                bot_name: 'TestBot',
                temperature: 0.5
            }
        });
    });

    test('should throw an error if the base configuration file is not found', () => {
        const mockFilePath = 'non-existent-config.yaml';
        const resolvedMockPath = originalPathResolve(mockFilePath);
        mockedFs.existsSync.mockReturnValue(false);
        mockPathResolve.mockImplementation((inputPath) => {
            if (inputPath === mockFilePath) return resolvedMockPath;
            return originalPathResolve(inputPath);
        });

        expect(() => loadBaseConfig(mockFilePath)).toThrow(
            `Base configuration file (YAML) not found at ${resolvedMockPath}.`
        );
        expect(mockPathResolve).toHaveBeenCalledWith(mockFilePath);
        expect(mockedFs.existsSync).toHaveBeenCalledWith(resolvedMockPath);
        expect(mockedFs.readFileSync).not.toHaveBeenCalled();
    });

    test('should throw an error for invalid YAML content in base config', () => {
        const mockFilePath = 'invalid-yaml-config.yaml';
        const resolvedMockPath = originalPathResolve(mockFilePath);
        const mockInvalidFileContent = 'langflow_connection: { endpoint_url: \'http://localhost:7860\' :::: }'; 

        mockedFs.existsSync.mockReturnValue(true);
        mockedFs.readFileSync.mockReturnValue(mockInvalidFileContent);
        mockPathResolve.mockImplementation((inputPath) => {
            if (inputPath === mockFilePath) return resolvedMockPath;
            return originalPathResolve(inputPath);
        });

        expect(() => loadBaseConfig(mockFilePath)).toThrow(yaml.YAMLException);
        expect(mockPathResolve).toHaveBeenCalledWith(mockFilePath);
        expect(mockedFs.existsSync).toHaveBeenCalledWith(resolvedMockPath);
        expect(mockedFs.readFileSync).toHaveBeenCalledWith(resolvedMockPath, 'utf-8');
    });

    test('should throw an error if langflow_connection.endpoint_url is missing in base config', () => {
        const mockFilePath = 'missing-url-config.yaml';
        const resolvedMockPath = originalPathResolve(mockFilePath);
        const mockFileContent = yaml.dump({
            langflow_connection: {}
        });

        mockedFs.existsSync.mockReturnValue(true);
        mockedFs.readFileSync.mockReturnValue(mockFileContent);
        mockPathResolve.mockImplementation((inputPath) => {
            if (inputPath === mockFilePath) return resolvedMockPath;
            return originalPathResolve(inputPath);
        });

        expect(() => loadBaseConfig(mockFilePath)).toThrow(
            `Base YAML config missing required 'langflow_connection.endpoint_url'. Path: ${resolvedMockPath}`
        );
        expect(mockPathResolve).toHaveBeenCalledWith(mockFilePath);
        expect(mockedFs.existsSync).toHaveBeenCalledWith(resolvedMockPath);
        expect(mockedFs.readFileSync).toHaveBeenCalledWith(resolvedMockPath, 'utf-8');
    });

    test('should return empty chatbot_defaults if not provided in base config', () => {
        const mockFilePath = 'no-defaults-config.yaml';
        const resolvedMockPath = originalPathResolve(mockFilePath);
        const mockFileContent = yaml.dump({
            langflow_connection: {
                endpoint_url: 'http://localhost:7860'
            }
        });

        mockedFs.existsSync.mockReturnValue(true);
        mockedFs.readFileSync.mockReturnValue(mockFileContent);
        mockPathResolve.mockImplementation((inputPath) => {
            if (inputPath === mockFilePath) return resolvedMockPath;
            return originalPathResolve(inputPath);
        });

        const result = loadBaseConfig(mockFilePath);

        expect(result.chatbotDefaults).toEqual({});
        expect(mockPathResolve).toHaveBeenCalledWith(mockFilePath);
        expect(mockedFs.existsSync).toHaveBeenCalledWith(resolvedMockPath);
        expect(mockedFs.readFileSync).toHaveBeenCalledWith(resolvedMockPath, 'utf-8');
    });
});

describe('loadInstanceConfig', () => {
    beforeEach(() => {
        mockedFs.existsSync.mockReset();
        mockedFs.readFileSync.mockReset();
        if (mockPathResolve) {
            mockPathResolve.mockRestore();
        }
        mockPathResolve = jest.spyOn(path, 'resolve');
    });

    afterEach(() => {
        if (mockPathResolve) {
            mockPathResolve.mockRestore();
        }
        jest.restoreAllMocks();
    });

    test('should load and parse a valid instance configuration file', () => {
        const mockFilePath = 'valid-instance-config.yaml';
        const resolvedMockPath = originalPathResolve(mockFilePath);
        const mockChatbots = [
            { proxyEndpointId: 'id1', flowId: 'flow1', bot_name: 'Bot1' },
            { proxyEndpointId: 'id2', flowId: 'flow2', temperature: 0.7 },
        ];
        const mockFileContent = yaml.dump({ chatbots: mockChatbots });

        mockedFs.existsSync.mockReturnValue(true);
        mockedFs.readFileSync.mockReturnValue(mockFileContent);
        mockPathResolve.mockImplementation((inputPath) => {
            if (inputPath === mockFilePath) return resolvedMockPath;
            return originalPathResolve(inputPath);
        });

        const result = loadInstanceConfig(mockFilePath);

        expect(mockPathResolve).toHaveBeenCalledWith(mockFilePath);
        expect(mockedFs.existsSync).toHaveBeenCalledWith(resolvedMockPath);
        expect(mockedFs.readFileSync).toHaveBeenCalledWith(resolvedMockPath, 'utf-8');
        expect(result).toEqual(mockChatbots);
    });

    test('should throw an error if the instance configuration file is not found', () => {
        const mockFilePath = 'non-existent-instance-config.yaml';
        const resolvedMockPath = originalPathResolve(mockFilePath);
        mockedFs.existsSync.mockReturnValue(false);
        mockPathResolve.mockImplementation((inputPath) => {
            if (inputPath === mockFilePath) return resolvedMockPath;
            return originalPathResolve(inputPath);
        });

        expect(() => loadInstanceConfig(mockFilePath)).toThrow(
            `Instance configuration file (YAML) not found at ${resolvedMockPath}.`
        );
        expect(mockPathResolve).toHaveBeenCalledWith(mockFilePath);
        expect(mockedFs.existsSync).toHaveBeenCalledWith(resolvedMockPath);
        expect(mockedFs.readFileSync).not.toHaveBeenCalled();
    });

    test('should throw an error for invalid YAML content in instance config', () => {
        const mockFilePath = 'invalid-yaml-instance-config.yaml';
        const resolvedMockPath = originalPathResolve(mockFilePath);
        const mockInvalidFileContent = 'chatbots: [ { proxyEndpointId: \'id1\' :::: } ]';

        mockedFs.existsSync.mockReturnValue(true);
        mockedFs.readFileSync.mockReturnValue(mockInvalidFileContent);
        mockPathResolve.mockImplementation((inputPath) => {
            if (inputPath === mockFilePath) return resolvedMockPath;
            return originalPathResolve(inputPath);
        });

        expect(() => loadInstanceConfig(mockFilePath)).toThrow(yaml.YAMLException);
        expect(mockPathResolve).toHaveBeenCalledWith(mockFilePath);
        expect(mockedFs.existsSync).toHaveBeenCalledWith(resolvedMockPath);
        expect(mockedFs.readFileSync).toHaveBeenCalledWith(resolvedMockPath, 'utf-8');
    });

    test('should throw an error if chatbots array is missing in instance config', () => {
        const mockFilePath = 'missing-chatbots-array-config.yaml';
        const resolvedMockPath = originalPathResolve(mockFilePath);
        const mockFileContent = yaml.dump({ some_other_key: 'value' }); 

        mockedFs.existsSync.mockReturnValue(true);
        mockedFs.readFileSync.mockReturnValue(mockFileContent);
        mockPathResolve.mockImplementation((inputPath) => {
            if (inputPath === mockFilePath) return resolvedMockPath;
            return originalPathResolve(inputPath);
        });

        expect(() => loadInstanceConfig(mockFilePath)).toThrow(
            `Instance YAML config missing required 'chatbots' array. Path: ${resolvedMockPath}`
        );
        expect(mockPathResolve).toHaveBeenCalledWith(mockFilePath);
        expect(mockedFs.existsSync).toHaveBeenCalledWith(resolvedMockPath);
        expect(mockedFs.readFileSync).toHaveBeenCalledWith(resolvedMockPath, 'utf-8');
    });

    test('should throw an error if chatbots is not an array in instance config', () => {
        const mockFilePath = 'chatbots-not-array-config.yaml';
        const resolvedMockPath = originalPathResolve(mockFilePath);
        const mockFileContent = yaml.dump({ chatbots: { proxyEndpointId: 'id1' } }); 

        mockedFs.existsSync.mockReturnValue(true);
        mockedFs.readFileSync.mockReturnValue(mockFileContent);
        mockPathResolve.mockImplementation((inputPath) => {
            if (inputPath === mockFilePath) return resolvedMockPath;
            return originalPathResolve(inputPath);
        });

        expect(() => loadInstanceConfig(mockFilePath)).toThrow(
            `Instance YAML config missing required 'chatbots' array. Path: ${resolvedMockPath}`
        );
        expect(mockPathResolve).toHaveBeenCalledWith(mockFilePath);
        expect(mockedFs.existsSync).toHaveBeenCalledWith(resolvedMockPath);
        expect(mockedFs.readFileSync).toHaveBeenCalledWith(resolvedMockPath, 'utf-8');
    });

    test('should return an empty array if chatbots is an empty array in instance config', () => {
        const mockFilePath = 'empty-chatbots-array-config.yaml';
        const resolvedMockPath = originalPathResolve(mockFilePath);
        const mockFileContent = yaml.dump({ chatbots: [] });

        mockedFs.existsSync.mockReturnValue(true);
        mockedFs.readFileSync.mockReturnValue(mockFileContent);
        mockPathResolve.mockImplementation((inputPath) => {
            if (inputPath === mockFilePath) return resolvedMockPath;
            return originalPathResolve(inputPath);
        });

        const result = loadInstanceConfig(mockFilePath);
        expect(result).toEqual([]);
        expect(mockPathResolve).toHaveBeenCalledWith(mockFilePath);
        expect(mockedFs.existsSync).toHaveBeenCalledWith(resolvedMockPath);
        expect(mockedFs.readFileSync).toHaveBeenCalledWith(resolvedMockPath, 'utf-8');
    });
}); 