import http from 'http';
import { URLSearchParams } from 'url';
import { LANGFLOW_API_BASE_PATH_V1 } from '../../config/apiPaths';
import { sendJsonError, proxyLangflowApiRequest } from '../request-utils';

export async function handleGetChatHistoryRequest(
    res: http.ServerResponse,
    flowId: string,
    sessionId: string | null,
    makeDirectLangflowApiRequest: (
        res: http.ServerResponse,
        path: string,
        method: 'GET',
        queryParams?: URLSearchParams
    ) => Promise<Response | null>
): Promise<void> {
    console.log(`RequestHandler: Received GET request for chat history for flow '${flowId}', session '${sessionId}'`); 

    if (!sessionId) {
        sendJsonError(res, 400, "session_id is a required query parameter for history.");
        return;
    }

    const targetPath = `${LANGFLOW_API_BASE_PATH_V1}/monitor/messages`;
    const queryParams = new URLSearchParams();
    queryParams.append('flow_id', flowId);
    queryParams.append('session_id', sessionId);
    
    await proxyLangflowApiRequest(res, () => 
        makeDirectLangflowApiRequest(res, targetPath, 'GET', queryParams)
    );
} 