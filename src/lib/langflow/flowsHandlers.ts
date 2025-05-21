import http from 'http';
import { LANGFLOW_API_BASE_PATH_V1, LANGFLOW_FLOWS_ENDPOINT_SUFFIX } from '../../config/apiPaths';
import { proxyLangflowApiRequest } from '../request-utils';

export async function handleGetFlowsRequest(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    makeDirectLangflowApiRequest: (
        res: http.ServerResponse,
        path: string,
        method: 'GET',
        queryParams?: URLSearchParams
    ) => Promise<Response | null>
): Promise<void> {
    console.log(`RequestHandler: Received GET request for flows configuration: ${req.url}`);
    const targetPath = `${LANGFLOW_API_BASE_PATH_V1}${LANGFLOW_FLOWS_ENDPOINT_SUFFIX}`;
    const queryParams = new URLSearchParams();
    queryParams.append('header_flows', 'true');
    queryParams.append('get_all', 'true');

    await proxyLangflowApiRequest(res, () => 
        makeDirectLangflowApiRequest(res, targetPath, 'GET', queryParams)
    );
} 