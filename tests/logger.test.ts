import { Logger, LogLevel } from '../src/components/logger';

describe('Logger', () => {
  let logger: Logger;
  const mockError = jest.spyOn(console, 'error').mockImplementation(() => {});
  const mockWarn = jest.spyOn(console, 'warn').mockImplementation(() => {});
  const mockInfo = jest.spyOn(console, 'info').mockImplementation(() => {});
  const mockDebug = jest.spyOn(console, 'debug').mockImplementation(() => {});

  beforeEach(() => {
    // Reset mocks before each test
    mockError.mockClear();
    mockWarn.mockClear();
    mockInfo.mockClear();
    mockDebug.mockClear();
    // Initialize logger with a default level for consistent testing
    logger = new Logger('debug', 'TestPrefix');
  });

  afterAll(() => {
    // Restore original console methods
    mockError.mockRestore();
    mockWarn.mockRestore();
    mockInfo.mockRestore();
    mockDebug.mockRestore();
  });

  it('should initialize with default level "warn" and prefix "LangflowChatbot" if no params are provided', () => {
    const defaultLogger = new Logger();
    defaultLogger.error('test error'); // Should log because error > warn (default)
    expect(mockError).toHaveBeenCalledWith('[LangflowChatbot] [ERROR]', 'test error');
    
    defaultLogger.warn('test warn'); // Should log
    expect(mockWarn).toHaveBeenCalledWith('[LangflowChatbot] [WARN]', 'test warn');

    mockInfo.mockClear(); // Clear info for this specific check as default is 'warn'
    defaultLogger.info('test info'); // Should not log if default is 'warn'
    // Re-initialize for this test as default is warn
    const warnLogger = new Logger(); // Default level is 'warn'
    warnLogger.info('test info');
    expect(mockInfo).not.toHaveBeenCalled();

  });

  it('should initialize with a custom level and prefix', () => {
    logger.error('test error');
    expect(mockError).toHaveBeenCalledWith('[TestPrefix] [ERROR]', 'test error');
  });

  it('should allow setting the log level', () => {
    logger.setLevel('info');
    logger.debug('this should not be logged');
    expect(mockDebug).not.toHaveBeenCalled();

    logger.info('this should be logged');
    expect(mockInfo).toHaveBeenCalledWith('[TestPrefix] [INFO]', 'this should be logged');
  });

  describe('log methods', () => {
    const testCases: { level: LogLevel, method: 'error' | 'warn' | 'info' | 'debug', consoleMock: jest.SpyInstance }[] = [
      { level: 'error', method: 'error', consoleMock: mockError },
      { level: 'warn', method: 'warn', consoleMock: mockWarn },
      { level: 'info', method: 'info', consoleMock: mockInfo },
      { level: 'debug', method: 'debug', consoleMock: mockDebug },
    ];

    for (const { level, method, consoleMock } of testCases) {
      it(`should log ${level} messages when current level allows it`, () => {
        logger.setLevel(level); // Set to current testing level
        (logger[method] as Function)('test', level, 'message');
        expect(consoleMock).toHaveBeenCalledTimes(1);
        expect(consoleMock).toHaveBeenCalledWith(`[TestPrefix] [${level.toUpperCase()}]`, 'test', level, 'message');
      });
    }

    it('should not log debug messages if level is info', () => {
      logger.setLevel('info');
      logger.debug('debug message');
      expect(mockDebug).not.toHaveBeenCalled();
    });

    it('should not log info messages if level is warn', () => {
      logger.setLevel('warn');
      logger.info('info message');
      expect(mockInfo).not.toHaveBeenCalled();
    });

    it('should not log warn messages if level is error', () => {
      logger.setLevel('error');
      logger.warn('warn message');
      expect(mockWarn).not.toHaveBeenCalled();
    });

    it('should always log error messages regardless of level (as long as its error or higher)', () => {
        logger.setLevel('error'); // Lowest possible log output
        logger.error('error message');
        expect(mockError).toHaveBeenCalledWith('[TestPrefix] [ERROR]', 'error message');
        mockError.mockClear();

        // Check higher levels still log errors
        logger.setLevel('debug');
        logger.error('another error');
        expect(mockError).toHaveBeenCalledWith('[TestPrefix] [ERROR]', 'another error');
    });
  });

  it('should correctly format messages with multiple arguments', () => {
    logger.error('Error occurred:', { code: 500, detail: 'Server Error' });
    expect(mockError).toHaveBeenCalledWith('[TestPrefix] [ERROR]', 'Error occurred:', { code: 500, detail: 'Server Error' });
  });

  it('should handle cases where no arguments are passed to log methods', () => {
    logger.info();
    expect(mockInfo).toHaveBeenCalledWith('[TestPrefix] [INFO]');
  });
}); 