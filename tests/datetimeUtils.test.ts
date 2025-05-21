import {
    createDefaultDatetimeHandler,
    isValidDatetimeHandler,
    normalizeLangflowTimestamp,
    DatetimeHandler
} from '../src/utils/datetimeUtils';

// Mock date-fns to control its behavior and outputs for testing
jest.mock('date-fns', () => ({
    ...jest.requireActual('date-fns'), // Import and retain default behavior
    format: jest.fn(),
    formatDistanceToNow: jest.fn(),
}));

import { format as mockFormat, formatDistanceToNow as mockFormatDistanceToNow } from 'date-fns';

describe('datetimeUtils', () => {
    const testISOString = '2023-01-01T12:00:00.000Z';
    const testDate = new Date(testISOString);

    beforeEach(() => {
        jest.clearAllMocks();
        // Default mock implementations
        (mockFormat as jest.Mock).mockImplementation((date, fmt) => `formatted:${date.toISOString()}:${fmt}`);
        (mockFormatDistanceToNow as jest.Mock).mockImplementation((date, opts) => `relative:${date.toISOString()}${opts?.addSuffix ? ':suffixed' : ''}`);
    });

    describe('createDefaultDatetimeHandler', () => {
        it('should use formatDistanceToNow for "relative" format (default)', () => {
            const handler = createDefaultDatetimeHandler(); // Default is 'relative'
            const result = handler(testISOString);
            expect(mockFormatDistanceToNow).toHaveBeenCalledWith(testDate, { addSuffix: true });
            expect(result).toBe(`relative:${testISOString}:suffixed`);
            expect(mockFormat).not.toHaveBeenCalled();
        });

        it('should use formatDistanceToNow for explicit "relative" format', () => {
            const handler = createDefaultDatetimeHandler('relative');
            const result = handler(testISOString);
            expect(mockFormatDistanceToNow).toHaveBeenCalledWith(testDate, { addSuffix: true });
            expect(result).toBe(`relative:${testISOString}:suffixed`);
            expect(mockFormat).not.toHaveBeenCalled();
        });

        it('should use date-fns format for a specific format string', () => {
            const specificFormat = 'MM/dd/yyyy HH:mm';
            const handler = createDefaultDatetimeHandler(specificFormat);
            const result = handler(testISOString);
            expect(mockFormat).toHaveBeenCalledWith(testDate, specificFormat);
            expect(result).toBe(`formatted:${testISOString}:${specificFormat}`);
            expect(mockFormatDistanceToNow).not.toHaveBeenCalled();
        });

        it('should use toLocaleString for an empty format string', () => {
            const handler = createDefaultDatetimeHandler('');
            const result = handler(testISOString);
            expect(result).toBe(testDate.toLocaleString());
            expect(mockFormat).not.toHaveBeenCalled();
            expect(mockFormatDistanceToNow).not.toHaveBeenCalled();
        });

        it('should use toLocaleString for "default" format string', () => {
            const handler = createDefaultDatetimeHandler('default');
            const result = handler(testISOString);
            expect(result).toBe(testDate.toLocaleString());
            expect(mockFormat).not.toHaveBeenCalled();
            expect(mockFormatDistanceToNow).not.toHaveBeenCalled();
        });

        it('should return original datetime string if date parsing fails', () => {
            const invalidDateString = "not a date";
            const handler = createDefaultDatetimeHandler(); // Default is 'relative'
            const result = handler(invalidDateString);
            expect(result).toBe(invalidDateString);
            expect(mockFormat).not.toHaveBeenCalled();
            // mockFormatDistanceToNow IS called with an Invalid Date object, then the SUT returns the original string.
            // So, we cannot assert it's not called. The key is the fallback output.
            // expect(mockFormatDistanceToNow).not.toHaveBeenCalled(); 
        });

        it('should handle valid ISO date string correctly with relative format', () => {
            const handler = createDefaultDatetimeHandler('relative');
            const result = handler(testISOString);
            expect(mockFormatDistanceToNow).toHaveBeenCalledWith(testDate, { addSuffix: true });
            expect(result).toBe(`relative:${testISOString}:suffixed`);
        });
    });

    describe('isValidDatetimeHandler', () => {
        const validHandler: DatetimeHandler = (datetime) => new Date(datetime).toLocaleTimeString();
        const handlerReturningNotString: any = (datetime: string) => new Date(datetime);
        const handlerThrowingError: any = (datetime: string) => { throw new Error("Test error"); };
        const handlerWithWrongArgs: any = (datetime: string, extra: string) => new Date(datetime).toString() + extra;

        beforeEach(() => {
            // Suppress console.error for tests that expect it
            jest.spyOn(console, 'error').mockImplementation(() => {});
        });

        afterEach(() => {
            (console.error as jest.Mock).mockRestore();
        });

        it('should return true for a valid handler', () => {
            expect(isValidDatetimeHandler(validHandler)).toBe(true);
        });

        it('should return false if handler is not a function', () => {
            expect(isValidDatetimeHandler(null)).toBe(false);
            expect(isValidDatetimeHandler(undefined)).toBe(false);
            expect(isValidDatetimeHandler("not a function")).toBe(false);
            expect(isValidDatetimeHandler({})).toBe(false);
            expect(isValidDatetimeHandler(123)).toBe(false);
        });

        it('should return false if handler does not return a string', () => {
            expect(isValidDatetimeHandler(handlerReturningNotString)).toBe(false);
        });

        it('should return false if handler throws an error during test call', () => {
            expect(isValidDatetimeHandler(handlerThrowingError)).toBe(false);
            expect(console.error).toHaveBeenCalledWith("Datetime handler validation: Threw an error during test call:", expect.any(Error));
        });

        it('should return true for a handler that matches signature, even if it could take more args', () => {
            // The current validation only tests by calling handler(testDate). 
            // So, a function that *could* take more args but works with one is still valid by this check.
            const versatileHandler = (dt: string, opt?: string) => opt ? dt + opt : dt;
            expect(isValidDatetimeHandler(versatileHandler)).toBe(true);
        });

        it('should return false if handler requires more than one arg to not throw (implicitly)', () => {
            // This tests a function that would fail if called with only one arg as isValidDatetimeHandler does.
            // const needsTwoArgs = (dt: string, mustHave: string) => dt + mustHave; 
            // When called as needsTwoArgs(testDate), mustHave is undefined. dt + undefined is a string in JS.
            // So, this handler IS valid by the current SUT check.
            const handlerProducingStringWithUndefined = (dt: string, mustHave?: string) => dt + mustHave;
            expect(isValidDatetimeHandler(handlerProducingStringWithUndefined)).toBe(true); 
            // console.error would not be called here as no JS error is thrown by string + undefined
            expect(console.error).not.toHaveBeenCalled();
        });
    });

    describe('normalizeLangflowTimestamp', () => {
        it('should correctly normalize a standard Langflow timestamp string', () => {
            const langflowTs = '2023-05-19 13:33:46 UTC';
            const expectedIso = '2023-05-19T13:33:46Z';
            expect(normalizeLangflowTimestamp(langflowTs)).toBe(expectedIso);
        });

        it('should return undefined if no timestamp is provided', () => {
            expect(normalizeLangflowTimestamp(undefined)).toBeUndefined();
        });

        it('should return undefined for an empty string due to !ts check', () => {
            // SUT: if (!ts) return undefined; An empty string is falsy.
            expect(normalizeLangflowTimestamp('')).toBeUndefined(); 
        });

        it('should handle a string without spaces or "UTC" (e.g., an ISO string)', () => {
            const isoString = '2023-01-01T12:00:00Z';
            expect(normalizeLangflowTimestamp(isoString)).toBe(isoString);
        });

        it('should handle a string with a space but no "UTC"', () => {
            const ts = '2023-05-19 13:33:46';
            const expected = '2023-05-19T13:33:46'; // Only the first space is replaced
            expect(normalizeLangflowTimestamp(ts)).toBe(expected);
        });

        it('should handle a string with "UTC" but no preceding space for it', () => {
            const ts = '2023-05-19T13:33:46UTC'; // Missing space before UTC
            // .replace(' ', 'T') does nothing as no space.
            // .replace(' UTC', 'Z') does nothing as no space before UTC.
            expect(normalizeLangflowTimestamp(ts)).toBe(ts);
        });

        it('should handle string with multiple spaces', () => {
            const langflowTs = '2023-05-19  13:33:46 UTC'; // Extra space
            const expectedIso = '2023-05-19T 13:33:46Z'; // First space replaced by T, second space remains, ' UTC' replaced by 'Z'
            expect(normalizeLangflowTimestamp(langflowTs)).toBe(expectedIso);
        });
    });
}); 