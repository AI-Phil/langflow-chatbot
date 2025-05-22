/**
 * @file flow-mapper.ts
 * @description This module handles the initialization of flow mappings during application startup.
 * It fetches all available flows from the configured Langflow instance and resolves
 * human-readable flow names (or other identifiers used in chatbot profiles) to their
 * corresponding Langflow UUIDs. This is crucial for ensuring that chatbot profiles
 * correctly point to the intended Langflow flows. This process typically runs once
 * at startup to prepare the configurations for runtime use.
 */
import { Profile } from '../../types';
import {
    LANGFLOW_API_BASE_PATH_V1,
    LANGFLOW_FLOWS_ENDPOINT_SUFFIX
} from '../../config/apiPaths';

export async function initializeFlowMappings(
    langflowEndpointUrl: string,
    langflowApiKey: string | undefined,
    chatbotConfigurations: Map<string, Profile>
): Promise<void> {
    console.log("FlowMapper: Initializing flow mappings. Fetching all flows from Langflow...");
    const targetPath = `${LANGFLOW_API_BASE_PATH_V1}${LANGFLOW_FLOWS_ENDPOINT_SUFFIX}`;
    const queryParams = new URLSearchParams();
    queryParams.append('remove_example_flows', 'true');

    try {
        const fetchUrl = new URL(targetPath, langflowEndpointUrl);
        fetchUrl.search = queryParams.toString();

        const headers: HeadersInit = { 'Accept': 'application/json' };
        if (langflowApiKey) {
            headers['Authorization'] = `Bearer ${langflowApiKey}`;
        }

        console.log(`FlowMapper: Fetching all flows from Langflow: ${fetchUrl.toString()}`);
        const langflowApiResponse = await fetch(fetchUrl.toString(), { method: 'GET', headers });

        if (!langflowApiResponse.ok) {
            const errorBody = await langflowApiResponse.text();
            throw new Error(`Failed to fetch flows from Langflow. Status: ${langflowApiResponse.status} ${langflowApiResponse.statusText}. Body: ${errorBody}`);
        }

        const responseJson = await langflowApiResponse.json();
        let actualFlowsArray: Array<{ id: string; name: string; endpoint_name?: string; [key: string]: any }> = [];

        if (Array.isArray(responseJson)) {
            actualFlowsArray = responseJson;
        } else if (responseJson && Array.isArray(responseJson.records)) {
            actualFlowsArray = responseJson.records;
        } else if (responseJson && Array.isArray(responseJson.flows)) {
            actualFlowsArray = responseJson.flows;
        } else {
            console.error("FlowMapper: Unexpected response structure for flows list. Expected an array, or {records: [...]}, or {flows: [...]}. Response:", responseJson);
            throw new Error("Unexpected response structure for flows list from Langflow.");
        }
        
        const flowNameToIdMap = new Map<string, string>();
        for (const flow of actualFlowsArray) {
            if (flow && typeof flow.endpoint_name === 'string' && flow.endpoint_name.trim() !== '' && typeof flow.id === 'string') {
                flowNameToIdMap.set(flow.endpoint_name, flow.id);
            } else if (flow && typeof flow.name === 'string' && typeof flow.id === 'string'){
                console.debug(`FlowMapper: Flow '${flow.name}' (ID: ${flow.id}) does not have a suitable endpoint_name for mapping. Received endpoint_name: '${flow.endpoint_name}'. It will not be directly addressable by endpoint_name.`);
            } else {
                console.debug("FlowMapper: Skipping a flow entry from Langflow due to missing or invalid id, or unusable name/endpoint_name:", flow);
            }
        }
        
        console.log(`FlowMapper: Processed ${actualFlowsArray.length} flow entries, successfully mapped ${flowNameToIdMap.size} flows by endpoint_name.`);

        const resolvedProfiles: string[] = [];
        const unresolvedProfiles: string[] = [];

        for (const [proxyId, profile] of chatbotConfigurations.entries()) {
            const configuredFlowId = profile.server.flowId;
            const isLikelyUuid = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(configuredFlowId);

            if (isLikelyUuid) {
                console.log(`FlowMapper: Profile '${proxyId}' uses a UUID for flowId '${configuredFlowId}'. No resolution needed.`);
                continue;
            }

            const resolvedUuid = flowNameToIdMap.get(configuredFlowId);
            if (resolvedUuid) {
                console.log(`FlowMapper: Resolved flow name '${configuredFlowId}' to UUID '${resolvedUuid}' for profile '${proxyId}'.`);
                profile.server.flowId = resolvedUuid;
                resolvedProfiles.push(proxyId);
            } else {
                console.error(`FlowMapper: CRITICAL - Could not resolve flow name '${configuredFlowId}' for profile '${proxyId}'. This profile will not function correctly.`);
                unresolvedProfiles.push(proxyId);
            }
        }

        if (unresolvedProfiles.length > 0) {
            console.warn(`FlowMapper: Finished flow resolution. ${resolvedProfiles.length} profiles resolved. ${unresolvedProfiles.length} profiles had unresolved flow names: ${unresolvedProfiles.join(', ')}.`);
        } else {
            console.log(`FlowMapper: Finished flow resolution. All ${resolvedProfiles.length} flow names (if any) were resolved successfully.`);
        }

    } catch (error: any) {
        console.error(`FlowMapper: CRITICAL - Error during flow ID resolution: ${error.message}`);
    }
} 