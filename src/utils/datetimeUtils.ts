import { format as formatDate, formatDistanceToNow } from 'date-fns';

// New Signature: Handler takes only the datetime string.
// Formatting options are encapsulated within the handler itself or, for the default, set at creation time.
export type DatetimeHandler = (datetime: string) => string;

/**
 * Creates a default datetime handler function.
 * This default handler can be configured with a format string at creation time.
 * @param format - The format string (e.g., 'relative', 'MM/dd/yyyy', or others supported by date-fns).
 *                 Defaults to 'relative' if not provided.
 * @returns A DatetimeHandler function.
 */
export function createDefaultDatetimeHandler(format: string = 'relative'): DatetimeHandler {
    return (datetime: string): string => {
        try {
            const dateObj = new Date(datetime);
            if (format === 'relative') {
                return formatDistanceToNow(dateObj, { addSuffix: true });
            } else if (typeof format === 'string' && format.trim() !== '' && format !== 'default') {
                return formatDate(dateObj, format);
            } else {
                return dateObj.toLocaleString();
            }
        } catch (e) {
            // console.error("Error in defaultDatetimeHandler execution:", e);
            return datetime; // Fallback to original datetime string on error
        }
    };
}

/**
 * Validates if a given handler function conforms to the new DatetimeHandler signature ((datetime: string) => string).
 * It checks if the handler is a function and can be called with a typical ISO date string
 * without throwing an error, and returns a string.
 * @param handler - The function to validate.
 * @returns True if the handler is a valid DatetimeHandler, false otherwise.
 */
export function isValidDatetimeHandler(handler: any): handler is DatetimeHandler {
    if (typeof handler !== 'function') {
        return false;
    }
    try {
        const testDate = new Date().toISOString();
        const result = handler(testDate); // Test with only one argument
        return typeof result === 'string';
    } catch (e) {
        console.error("Datetime handler validation: Threw an error during test call:", e);
        return false;
    }
}

// Helper to normalize Langflow timestamps (e.g., '2025-05-19 13:33:46 UTC') to ISO format
export function normalizeLangflowTimestamp(ts?: string): string | undefined {
    if (!ts) return undefined;
    // Replace ' ' with 'T' (only the first occurrence), and ' UTC' with 'Z'
    return ts.replace(' ', 'T').replace(' UTC', 'Z');
} 