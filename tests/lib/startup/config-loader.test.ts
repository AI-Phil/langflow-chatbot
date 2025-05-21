import { loadBaseConfig, loadInstanceConfig } from '../../../src/lib/startup/config-loader';

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
            `Langflow endpoint URL is not defined in environment variables (LANGFLOW_ENDPOINT_URL) or in the base YAML config. Path: ${resolvedMockPath}`
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

// New describe block for environment variable override tests
describe('loadBaseConfig with environment variable overrides', () => {
    let originalEnvSnapshot: NodeJS.ProcessEnv;
    const mockFilePath = 'test-base-config.yaml';
    const resolvedMockPath = originalPathResolve(mockFilePath);

    beforeEach(() => {
        originalEnvSnapshot = { ...process.env }; // Store a copy of current env properties
        jest.resetModules(); // Reset modules. This might give a "clean" process.env to newly loaded modules.

        // Clear out keys that might be set by other tests or previous runs within this suite
        // This ensures that modifications within a test are applied to the actual global process.env
        // that the newly required module will see.
        delete process.env.LANGFLOW_ENDPOINT_URL;
        delete process.env.LANGFLOW_API_KEY;
        // Add any other ENV VARS that are manipulated in this test suite if necessary

        if (global.console.log && (global.console.log as jest.Mock).mockClear) {
            (global.console.log as jest.Mock).mockClear();
        }
        
        if (mockPathResolve && mockPathResolve.mockRestore) {
            mockPathResolve.mockRestore();
        }
        mockPathResolve = jest.spyOn(path, 'resolve').mockImplementation((inputPath) => {
            if (inputPath === mockFilePath) return resolvedMockPath;
            return originalPathResolve(inputPath); 
        });
    });

    afterEach(() => {
        // Restore process.env to its state before this test suite's beforeEach
        // First, delete any keys added during the test that weren't in the original snapshot
        Object.keys(process.env).forEach(key => {
            if (!originalEnvSnapshot.hasOwnProperty(key)) {
                delete process.env[key];
            }
        });
        // Then, restore original values for keys that were present or modified
        for (const key in originalEnvSnapshot) {
            process.env[key] = originalEnvSnapshot[key];
        }

        if (mockPathResolve && mockPathResolve.mockRestore) {
            mockPathResolve.mockRestore();
        }
        jest.restoreAllMocks(); // This should also unmock fs if jest.unmock was used in tests.
    });

    test('should use LANGFLOW_ENDPOINT_URL and LANGFLOW_API_KEY from environment variables, overriding file config', () => {
        process.env.LANGFLOW_ENDPOINT_URL = 'http://env-url.com';
        process.env.LANGFLOW_API_KEY = 'env-api-key';

        const mockFileContentWithBotName = yaml.dump({
            langflow_connection: {
                endpoint_url: 'http://should-be-overridden.com',
                api_key: 'should-be-overridden-key'
            },
            chatbot_defaults: { bot_name: 'FileBot' } // This should be picked up
        });

        jest.doMock('fs', () => ({
            existsSync: jest.fn().mockReturnValue(true),
            readFileSync: jest.fn().mockReturnValue(mockFileContentWithBotName)
        }));
        (global.console.log as jest.Mock).mockClear();
        const { loadBaseConfig } = require('../../../src/lib/startup/config-loader');

        const result = loadBaseConfig(mockFilePath);

        expect(result.langflowConnection.endpoint_url).toBe('http://env-url.com');
        expect(result.langflowConnection.api_key).toBe('env-api-key');
        expect(result.chatbotDefaults).toEqual({ bot_name: 'FileBot' });
        expect((global.console.log as jest.Mock).mock.calls).toContainEqual(['ConfigLoader: Using LANGFLOW_ENDPOINT_URL from environment: http://env-url.com']);
        expect((global.console.log as jest.Mock).mock.calls).toContainEqual(['ConfigLoader: Using LANGFLOW_API_KEY from environment.']);
        jest.unmock('fs');
    });

    test('should use file config when environment variables are not set', () => {
        delete process.env.LANGFLOW_ENDPOINT_URL;
        delete process.env.LANGFLOW_API_KEY;

        const mockFileContent = yaml.dump({
            langflow_connection: {
                endpoint_url: 'http://file-url.com',
                api_key: 'file-api-key'
            },
            chatbot_defaults: { bot_name: 'FileBotFromFile' }
        });
        jest.doMock('fs', () => ({
            existsSync: jest.fn().mockReturnValue(true),
            readFileSync: jest.fn().mockReturnValue(mockFileContent)
        }));
        (global.console.log as jest.Mock).mockClear();
        const { loadBaseConfig } = require('../../../src/lib/startup/config-loader');

        const result = loadBaseConfig(mockFilePath);
        expect(result.langflowConnection.endpoint_url).toBe('http://file-url.com');
        expect(result.langflowConnection.api_key).toBe('file-api-key');
        expect(result.chatbotDefaults).toEqual({ bot_name: 'FileBotFromFile' });
        jest.unmock('fs');
    });

    test('should use LANGFLOW_ENDPOINT_URL from env and api_key from file if LANGFLOW_API_KEY is not set in env', () => {
        process.env.LANGFLOW_ENDPOINT_URL = 'http://env-url.com';
        delete process.env.LANGFLOW_API_KEY;

        const mockFileContent = yaml.dump({
            langflow_connection: {
                endpoint_url: 'http://should-be-overridden-by-env.com',
                api_key: 'file-api-key-to-use'
            },
            chatbot_defaults: { bot_name: 'FileBot' }
        });
        jest.doMock('fs', () => ({
            existsSync: jest.fn().mockReturnValue(true),
            readFileSync: jest.fn().mockReturnValue(mockFileContent)
        }));
        (global.console.log as jest.Mock).mockClear();
        const { loadBaseConfig } = require('../../../src/lib/startup/config-loader');

        const result = loadBaseConfig(mockFilePath);
        expect(result.langflowConnection.endpoint_url).toBe('http://env-url.com');
        expect(result.langflowConnection.api_key).toBe('file-api-key-to-use');
        expect((global.console.log as jest.Mock).mock.calls).toContainEqual(['ConfigLoader: Using LANGFLOW_ENDPOINT_URL from environment: http://env-url.com']);
        expect((global.console.log as jest.Mock).mock.calls).not.toContainEqual(['ConfigLoader: Using LANGFLOW_API_KEY from environment.']);
        jest.unmock('fs');
    });

    test('should use api_key from env and LANGFLOW_ENDPOINT_URL from file if LANGFLOW_ENDPOINT_URL is not set in env', () => {
        delete process.env.LANGFLOW_ENDPOINT_URL;
        process.env.LANGFLOW_API_KEY = 'env-api-key-to-use';

        const mockFileContent = yaml.dump({
            langflow_connection: {
                endpoint_url: 'http://file-url-to-use.com',
                api_key: 'should-be-overridden-by-env-key'
            },
            chatbot_defaults: { bot_name: 'FileBot' }
        });
        jest.doMock('fs', () => ({
            existsSync: jest.fn().mockReturnValue(true),
            readFileSync: jest.fn().mockReturnValue(mockFileContent)
        }));
        (global.console.log as jest.Mock).mockClear();
        const { loadBaseConfig } = require('../../../src/lib/startup/config-loader');

        const result = loadBaseConfig(mockFilePath);
        expect(result.langflowConnection.endpoint_url).toBe('http://file-url-to-use.com');
        expect(result.langflowConnection.api_key).toBe('env-api-key-to-use');
        expect((global.console.log as jest.Mock).mock.calls).not.toContainEqual(['ConfigLoader: Using LANGFLOW_ENDPOINT_URL from environment: http://env-url.com']);
        expect((global.console.log as jest.Mock).mock.calls).toContainEqual(['ConfigLoader: Using LANGFLOW_API_KEY from environment.']);
        jest.unmock('fs');
    });
    
    test('should allow LANGFLOW_API_KEY to be optional (not in env or file)', () => {
        delete process.env.LANGFLOW_API_KEY;
        const mockFileContentNoApiKey = yaml.dump({
            langflow_connection: { endpoint_url: 'http://file-url.com' }
        });
        mockedFs.readFileSync.mockReturnValue(mockFileContentNoApiKey);

        const result = loadBaseConfig(mockFilePath);
        expect(result.langflowConnection.endpoint_url).toBe('http://file-url.com');
        expect(result.langflowConnection.api_key).toBeUndefined();
    });

    test('should correctly use only LANGFLOW_ENDPOINT_URL from env if LANGFLOW_API_KEY is not in env and not in file', () => {
        process.env.LANGFLOW_ENDPOINT_URL = 'http://env-url.com';
        delete process.env.LANGFLOW_API_KEY;
        const mockFileContentNoApiKey = yaml.dump({
            langflow_connection: { endpoint_url: 'http://another-file-url.com' } // endpoint in file to ensure env is used
        });
        mockedFs.readFileSync.mockReturnValue(mockFileContentNoApiKey);
    
        const result = loadBaseConfig(mockFilePath);
        expect(result.langflowConnection.endpoint_url).toBe('http://env-url.com');
        expect(result.langflowConnection.api_key).toBeUndefined();
        expect(global.console.log).toHaveBeenCalledWith('ConfigLoader: Using LANGFLOW_ENDPOINT_URL from environment: http://env-url.com');
    });

    test('should correctly use only LANGFLOW_API_KEY from env if LANGFLOW_ENDPOINT_URL is not in env and not in file (should throw for missing endpoint)', () => {
        jest.isolateModules(() => {
            const apiKeyForTest = 'env-api-key-for-this-specific-test';
            
            const mockFileContentNoEndpointOrKey = yaml.dump({
                langflow_connection: {} 
            });

            // Mock 'process' to control 'process.env' for the dynamic require
            jest.doMock('process', () => {
                const actualProcess = jest.requireActual('process');
                return {
                    ...actualProcess,
                    env: {
                        ...actualProcess.env, 
                        LANGFLOW_API_KEY: apiKeyForTest, 
                        LANGFLOW_ENDPOINT_URL: undefined,
                    },
                };
            });

            // Mock 'fs' for file operations
            jest.doMock('fs', () => ({
                existsSync: jest.fn().mockReturnValue(true),
                readFileSync: jest.fn().mockReturnValue(mockFileContentNoEndpointOrKey)
            }));
            
            (global.console.log as jest.Mock).mockClear(); 

            const { loadBaseConfig } = require('../../../src/lib/startup/config-loader');

            let thrownError: Error | undefined;
            try {
                loadBaseConfig(mockFilePath);
            } catch (e: any) {
                thrownError = e;
            }

            expect(thrownError).toBeInstanceOf(Error);
            expect(thrownError!.message).toBe(
                `Langflow endpoint URL is not defined in environment variables (LANGFLOW_ENDPOINT_URL) or in the base YAML config. Path: ${resolvedMockPath}`
            );
            
            const consoleCalls = (global.console.log as jest.Mock).mock.calls;

            expect(consoleCalls).toContainEqual([
                `ConfigLoader: Loading base configuration from: ${resolvedMockPath}`
            ]);
            
            jest.unmock('fs'); 
            jest.unmock('process'); 
        }); // End of jest.isolateModules
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