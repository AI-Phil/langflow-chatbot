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
import { Profile, ServerProfile, ChatbotProfile } from '../../../src/types'; // Import Profile, ServerProfile, ChatbotProfile types

// Mock the fs module
jest.mock('fs');
const mockedFs = fs as jest.Mocked<typeof fs>;

// Store original path.resolve and prepare for spy
const originalPathResolve = path.resolve;
let mockPathResolve: jest.SpyInstance;

// Mock console.log and console.error
global.console = {
    ...global.console,
    log: jest.fn(),
    error: jest.fn(),
};

const EXPECTED_DEFAULT_SERVER_CONFIG: Partial<ServerProfile> = {
    enableStream: DEFAULT_ENABLE_STREAM,
    datetimeFormat: DEFAULT_DATETIME_FORMAT,
    // flowId is instance-specific, not part of server defaults
};

const EXPECTED_DEFAULT_CHATBOT_CONFIG: Partial<ChatbotProfile> = {
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
    template: {
        mainContainerTemplate: DEFAULT_MAIN_CONTAINER_TEMPLATE,
        inputAreaTemplate: DEFAULT_INPUT_AREA_TEMPLATE,
        messageTemplate: DEFAULT_MESSAGE_TEMPLATE,
    },
};


describe('loadBaseConfig', () => {
    let originalEnv: NodeJS.ProcessEnv;

    beforeEach(() => {
        originalEnv = { ...process.env };
        delete process.env.LANGFLOW_ENDPOINT_URL;
        delete process.env.LANGFLOW_API_KEY;
        (global.console.log as jest.Mock).mockClear();
        (global.console.error as jest.Mock).mockClear();
    });

    afterEach(() => {
        process.env = originalEnv;
        jest.restoreAllMocks();
    });

    test('should load configuration from environment variables and UI constants', () => {
        process.env.LANGFLOW_ENDPOINT_URL = 'http://env-test-url.com';
        process.env.LANGFLOW_API_KEY = 'env-test-api-key';

        const result = loadBaseConfig();

        expect(result.langflowConnection.endpoint_url).toBe('http://env-test-url.com');
        expect(result.langflowConnection.api_key).toBe('env-test-api-key');
        expect(result.serverDefaults).toEqual(EXPECTED_DEFAULT_SERVER_CONFIG);
        expect(result.chatbotDefaults).toEqual(EXPECTED_DEFAULT_CHATBOT_CONFIG);
        expect(global.console.log).toHaveBeenCalledWith('ConfigLoader: Loading base configuration from environment variables and UI constants.');
        expect(global.console.log).toHaveBeenCalledWith('ConfigLoader: Using LANGFLOW_ENDPOINT_URL from environment: http://env-test-url.com');
        expect(global.console.log).toHaveBeenCalledWith('ConfigLoader: Using LANGFLOW_API_KEY from environment.');
    });

    test('should allow LANGFLOW_API_KEY to be optional', () => {
        process.env.LANGFLOW_ENDPOINT_URL = 'http://another-env-url.com';

        const result = loadBaseConfig();

        expect(result.langflowConnection.endpoint_url).toBe('http://another-env-url.com');
        expect(result.langflowConnection.api_key).toBeUndefined();
        expect(result.serverDefaults).toEqual(EXPECTED_DEFAULT_SERVER_CONFIG);
        expect(result.chatbotDefaults).toEqual(EXPECTED_DEFAULT_CHATBOT_CONFIG);
        expect(global.console.log).not.toHaveBeenCalledWith('ConfigLoader: Using LANGFLOW_API_KEY from environment.');
    });

    test('should throw an error if LANGFLOW_ENDPOINT_URL is not defined', () => {
        delete process.env.LANGFLOW_ENDPOINT_URL;
        expect(() => loadBaseConfig()).toThrow(
            'Langflow endpoint URL is not defined in environment variable LANGFLOW_ENDPOINT_URL.'
        );
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
        (global.console.log as jest.Mock).mockClear();
        (global.console.error as jest.Mock).mockClear();
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
        const mockProfilesData: Array<Partial<Profile>> = [
            { 
                profileId: 'id1', 
                server: { flowId: 'flow1', enableStream: true }, 
                chatbot: { labels: { widgetTitle: 'Bot1' } }
            },
            { 
                profileId: 'id2', 
                server: { flowId: 'flow2', datetimeFormat: 'YYYY-MM-DD' }, 
                // chatbot section can be omitted or empty
            },
        ];
        const mockFileContent = yaml.dump({ profiles: mockProfilesData });

        mockPathResolve.mockImplementation((inputPath) => inputPath === mockFilePath ? resolvedMockPath : originalPathResolve(inputPath));
        mockedFs.existsSync.mockReturnValue(true);
        mockedFs.readFileSync.mockReturnValue(mockFileContent);

        const result = loadInstanceConfig(mockFilePath);

        expect(mockPathResolve).toHaveBeenCalledWith(mockFilePath);
        expect(mockedFs.existsSync).toHaveBeenCalledWith(resolvedMockPath);
        expect(mockedFs.readFileSync).toHaveBeenCalledWith(resolvedMockPath, 'utf-8');
        // Expect the transformation to full Profile objects
        expect(result).toEqual([
            {
                profileId: 'id1',
                server: { flowId: 'flow1', enableStream: true, datetimeFormat: undefined }, // datetimeFormat undefined as not in mock
                chatbot: { labels: { widgetTitle: 'Bot1' } }
            },
            {
                profileId: 'id2',
                server: { flowId: 'flow2', enableStream: undefined, datetimeFormat: 'YYYY-MM-DD' }, // enableStream undefined
                chatbot: {} // chatbot defaults to empty object if not provided
            },
        ]);
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
        const mockInvalidFileContent = 'profiles: [ { profileId: "id1" :::: } ]'; // Invalid YAML

        mockPathResolve.mockImplementation(inputPath => inputPath === mockFilePath ? resolvedMockPath : originalPathResolve(inputPath));
        mockedFs.existsSync.mockReturnValue(true);
        mockedFs.readFileSync.mockReturnValue(mockInvalidFileContent);

        expect(() => loadInstanceConfig(mockFilePath)).toThrow(yaml.YAMLException);
    });

    test('should throw an error if profiles array is missing in instance config', () => {
        const mockFilePath = 'missing-profiles-array-config.yaml';
        const resolvedMockPath = originalPathResolve(mockFilePath);
        const mockFileContent = yaml.dump({ some_other_key: 'value' }); 

        mockPathResolve.mockImplementation(inputPath => inputPath === mockFilePath ? resolvedMockPath : originalPathResolve(inputPath));
        mockedFs.existsSync.mockReturnValue(true);
        mockedFs.readFileSync.mockReturnValue(mockFileContent);

        expect(() => loadInstanceConfig(mockFilePath)).toThrow(
            `Instance YAML config missing required 'profiles' array. Path: ${resolvedMockPath}`
        );
    });

    test('should throw an error if profiles is not an array in instance config', () => {
        const mockFilePath = 'profiles-not-array-config.yaml';
        const resolvedMockPath = originalPathResolve(mockFilePath);
        const mockFileContent = yaml.dump({ profiles: { profileId: 'id1' } }); 

        mockPathResolve.mockImplementation(inputPath => inputPath === mockFilePath ? resolvedMockPath : originalPathResolve(inputPath));
        mockedFs.existsSync.mockReturnValue(true);
        mockedFs.readFileSync.mockReturnValue(mockFileContent);

        expect(() => loadInstanceConfig(mockFilePath)).toThrow(
            `Instance YAML config missing required 'profiles' array. Path: ${resolvedMockPath}`
        );
    });

    test('should throw an error if a profile is missing profileId', () => {
        const mockFilePath = 'missing-profileId-config.yaml';
        const resolvedMockPath = originalPathResolve(mockFilePath);
        const mockProfilesData = [{ server: { flowId: 'flow1' } }]; // Missing profileId
        const mockFileContent = yaml.dump({ profiles: mockProfilesData });

        mockPathResolve.mockImplementation(inputPath => inputPath === mockFilePath ? resolvedMockPath : originalPathResolve(inputPath));
        mockedFs.existsSync.mockReturnValue(true);
        mockedFs.readFileSync.mockReturnValue(mockFileContent);

        expect(() => loadInstanceConfig(mockFilePath)).toThrow(
            `ConfigLoader: Profile at index 0 is missing required 'profileId' or 'server.flowId'. Path: ${resolvedMockPath}`
        );
    });

    test('should throw an error if a profile is missing server.flowId', () => {
        const mockFilePath = 'missing-flowId-config.yaml';
        const resolvedMockPath = originalPathResolve(mockFilePath);
        const mockProfilesData = [{ profileId: 'id1', server: {} }]; // Missing server.flowId
        const mockFileContent = yaml.dump({ profiles: mockProfilesData });

        mockPathResolve.mockImplementation(inputPath => inputPath === mockFilePath ? resolvedMockPath : originalPathResolve(inputPath));
        mockedFs.existsSync.mockReturnValue(true);
        mockedFs.readFileSync.mockReturnValue(mockFileContent);

        expect(() => loadInstanceConfig(mockFilePath)).toThrow(
            `ConfigLoader: Profile at index 0 is missing required 'profileId' or 'server.flowId'. Path: ${resolvedMockPath}`
        );
    });

     test('should correctly process a profile with only mandatory fields', () => {
        const mockFilePath = 'minimal-profile-config.yaml';
        const resolvedMockPath = originalPathResolve(mockFilePath);
        const mockProfilesData = [
            { profileId: 'minimalId', server: { flowId: 'minimalFlow' } }
        ];
        const mockFileContent = yaml.dump({ profiles: mockProfilesData });

        mockPathResolve.mockImplementation(inputPath => inputPath === mockFilePath ? resolvedMockPath : originalPathResolve(inputPath));
        mockedFs.existsSync.mockReturnValue(true);
        mockedFs.readFileSync.mockReturnValue(mockFileContent);

        const result = loadInstanceConfig(mockFilePath);
        expect(result).toEqual([
            {
                profileId: 'minimalId',
                server: { flowId: 'minimalFlow', enableStream: undefined, datetimeFormat: undefined },
                chatbot: {} 
            }
        ]);
    });
}); 