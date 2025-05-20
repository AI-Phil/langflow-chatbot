import http from 'http';

// Helper function to parse JSON body from IncomingMessage
export async function parseJsonBody(req: http.IncomingMessage): Promise<any> {
    return new Promise((resolve, reject) => {
        let body = '';
        req.on('data', chunk => {
            body += chunk.toString();
        });
        req.on('end', () => {
            try {
                resolve(JSON.parse(body));
            } catch (e) {
                reject(new Error('Invalid JSON body'));
            }
        });
        req.on('error', reject);
    });
}

export function sendJsonError(
    res: http.ServerResponse,
    statusCode: number,
    error: string,
    detail?: string
): void {
    res.statusCode = statusCode;
    res.setHeader('Content-Type', 'application/json');
    const responseBody: { error: string; detail?: string } = { error };
    if (detail) {
        responseBody.detail = detail;
    }
    res.end(JSON.stringify(responseBody));
}

export async function proxyLangflowApiRequest(
    res: http.ServerResponse, // The response object to write to
    langflowApiCall: () => Promise<Response | null> // Function that makes the actual API call
): Promise<any | null> { // Returns parsed JSON data or null if response was fully handled
    try {
        const langflowApiResponse = await langflowApiCall();
        if (!langflowApiResponse) { // Error already handled by caller or no response needed
            return null;
        }

        console.log(`RequestHandler (proxyUtil): Response status from Langflow server: ${langflowApiResponse.status} ${langflowApiResponse.statusText}`);
        
        // Relay specific headers, except those that might interfere with proxying
        langflowApiResponse.headers.forEach((value, name) => {
            const lowerName = name.toLowerCase();
            if (lowerName !== 'transfer-encoding' && 
                lowerName !== 'content-length' && 
                lowerName !== 'content-encoding') {
                res.setHeader(name, value);
            }
        });
        res.statusCode = langflowApiResponse.status;

        const contentType = langflowApiResponse.headers.get('Content-Type') || 'application/json';
        res.setHeader('Content-Type', contentType);

        const responseBodyText = await langflowApiResponse.text();

        if (contentType.includes('application/json')) {
            try {
                const jsonData = JSON.parse(responseBodyText);
                res.end(JSON.stringify(jsonData)); // Send parsed and re-serialized JSON
                return jsonData; // Return parsed data for potential further use by caller
            } catch (jsonError: any) {
                console.error(`RequestHandler (proxyUtil): Failed to parse JSON response from Langflow. Status: ${langflowApiResponse.status}. Error: ${jsonError.message}. Body: ${responseBodyText.substring(0,1000)}`);
                // If headers are already sent, we can't change status. Try to send error in body if possible.
                if (!res.headersSent) {
                    sendJsonError(res, 502, "Proxy received an invalid JSON response from Langflow server.", jsonError.message);
                } else if (!res.writableEnded) {
                     // Attempt to append an error if stream is open, though this is tricky
                    res.end('\n{"error": "Proxy received an invalid JSON response from Langflow server after starting response."} ');
                }
                return null; // Indicate error
            }
        } else {
            // For non-JSON, just pass through the text body
            res.end(responseBodyText);
            return responseBodyText; // Return text data
        }

    } catch (error: any) {
        console.error(`RequestHandler (proxyUtil): Error in API request to Langflow:`, error);
        if (!res.headersSent) {
            sendJsonError(res, 500, "Failed to make request to Langflow via proxy.", error.message);
        }
        return null; // Indicate error
    }
} 