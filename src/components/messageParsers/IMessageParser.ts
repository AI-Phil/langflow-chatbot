export interface IMessageParser {
    /**
     * Parses a chunk of a streaming message.
     * @param chunk The current chunk of text from the stream.
     * @param rawAccumulatedContentBeforeThisChunk The raw, unparsed content that has been accumulated
     *                                             so far in the stream, *before* this current chunk.
     *                                             This allows parsers to be context-aware if needed.
     * @returns The processed string version of the current chunk to be appended to the display.
     */
    parseChunk(chunk: string, rawAccumulatedContentBeforeThisChunk: string): string;

    /**
     * Parses a complete message. This is used for:
     * - Non-streamed responses.
     * - The final aggregated content of a stream if provided by the 'end' event.
     * - Self-contained messages like errors, "(no content streamed)", or other system messages.
     * @param fullContent The complete raw string content.
     * @returns The processed string content to be displayed.
     */
    parseComplete(fullContent: string): string;
} 