import { IMessageParser } from './IMessageParser';

export class PlaintextMessageParser implements IMessageParser {
    /**
     * For plaintext, parsing a chunk doesn't depend on prior content.
     * It simply returns the chunk itself.
     * @param chunk The current chunk of text from the stream.
     * @param rawAccumulatedContentBeforeThisChunk The raw, unparsed content accumulated before this chunk (ignored for plaintext).
     * @returns The chunk itself.
     */
    parseChunk(chunk: string, rawAccumulatedContentBeforeThisChunk: string): string {
        // Plaintext processing doesn't typically care about previous chunks for the current one.
        return chunk;
    }

    /**
     * For plaintext, parsing a complete message returns the message itself.
     * @param fullContent The complete raw string content.
     * @returns The same content, as it's treated as plain text.
     */
    parseComplete(fullContent: string): string {
        return fullContent;
    }
} 