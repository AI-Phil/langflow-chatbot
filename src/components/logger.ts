// logger.ts
export type LogLevel = 'error' | 'warn' | 'info' | 'debug';

const LOG_LEVELS: Record<LogLevel, number> = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3,
};

export class Logger {
  private level: LogLevel;
  private prefix: string;

  constructor(level: LogLevel = 'warn', prefix: string = 'LangflowChatbot') {
    this.level = level;
    this.prefix = prefix;
  }

  setLevel(level: LogLevel) {
    this.level = level;
  }

  private shouldLog(level: LogLevel): boolean {
    return LOG_LEVELS[level] <= LOG_LEVELS[this.level];
  }

  private format(level: LogLevel, ...args: any[]): any[] {
    const tag = `[${this.prefix}] [${level.toUpperCase()}]`;
    return [tag, ...args];
  }

  error(...args: any[]) {
    if (this.shouldLog('error')) {
      console.error(...this.format('error', ...args));
    }
  }

  warn(...args: any[]) {
    if (this.shouldLog('warn')) {
      console.warn(...this.format('warn', ...args));
    }
  }

  info(...args: any[]) {
    if (this.shouldLog('info')) {
      console.info(...this.format('info', ...args));
    }
  }

  debug(...args: any[]) {
    if (this.shouldLog('debug')) {
      console.debug(...this.format('debug', ...args));
    }
  }
} 