/**
 * @file flow-mapper.ts
 * @description This module handles the initialization of flow mappings during application startup.
 * It fetches all available flows from the configured Langflow instance and resolves
 * human-readable flow names (or other identifiers used in chatbot profiles) to their
 * corresponding Langflow UUIDs. This is crucial for ensuring that chatbot profiles
 * correctly point to the intended Langflow flows. This process typically runs once
 * at startup to prepare the configurations for runtime use.
 */
import { Profile } from '../types';
import {
    LANGFLOW_API_BASE_PATH_V1,
    LANGFLOW_FLOWS_ENDPOINT_SUFFIX
} from '../config/apiPaths';

export class FlowMapper {
    private langflowEndpointUrl: string;
    private langflowApiKey: string | undefined;
    private flowNameToIdMap: Map<string, string>;
    private isInitialized: boolean = false;

    constructor(langflowEndpointUrl: string, langflowApiKey?: string) {
        this.langflowEndpointUrl = langflowEndpointUrl;
        this.langflowApiKey = langflowApiKey;
        this.flowNameToIdMap = new Map<string, string>();
    }

    public async initialize(): Promise<void> {
        if (this.isInitialized) {
            console.log("FlowMapper: Already initialized.");
            return;
        }
        console.log("FlowMapper: Initializing - fetching all flows from Langflow...");
        const targetPath = `${LANGFLOW_API_BASE_PATH_V1}${LANGFLOW_FLOWS_ENDPOINT_SUFFIX}`;
        const queryParams = new URLSearchParams();
        queryParams.append('remove_example_flows', 'true');
        queryParams.append('header_flows', 'true'); // Assuming this is still desired

        try {
            const fetchUrl = new URL(targetPath, this.langflowEndpointUrl);
            fetchUrl.search = queryParams.toString();

            const headers: HeadersInit = { 'Accept': 'application/json' };
            if (this.langflowApiKey) {
                headers['Authorization'] = `Bearer ${this.langflowApiKey}`;
            }

            console.log(`FlowMapper: Fetching flows from: ${fetchUrl.toString()}`);
            const langflowApiResponse = await fetch(fetchUrl.toString(), { method: 'GET', headers });

            if (!langflowApiResponse.ok) {
                const errorBody = await langflowApiResponse.text();
                throw new Error(`FlowMapper: Failed to fetch flows from Langflow. Status: ${langflowApiResponse.status} ${langflowApiResponse.statusText}. Body: ${errorBody}`);
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
                throw new Error("FlowMapper: Unexpected response structure for flows list from Langflow.");
            }
            
            this.flowNameToIdMap.clear(); // Clear any previous mappings
            for (const flow of actualFlowsArray) {
                if (flow && typeof flow.id === 'string') {
                    if (typeof flow.endpoint_name === 'string' && flow.endpoint_name.trim() !== '') {
                        this.flowNameToIdMap.set(flow.endpoint_name, flow.id);
                    } else if (typeof flow.name === 'string' && flow.name.trim() !== '') {
                        // Fallback to name if endpoint_name is not suitable or missing
                        if (!this.flowNameToIdMap.has(flow.name)) { // Avoid overwriting if endpoint_name was already used for a different flow that happened to have this name
                           this.flowNameToIdMap.set(flow.name, flow.id);
                           console.debug(`FlowMapper: Flow '${flow.name}' (ID: ${flow.id}) mapped by its 'name' as 'endpoint_name' was not suitable. Ensure names are unique if used for mapping.`);
                        } else {
                           console.debug(`FlowMapper: Flow '${flow.name}' (ID: ${flow.id}) could not be mapped by name as the name is already in use by another flow's endpoint_name or name. Ensure unique names/endpoint_names.`);
                        }
                    } else {
                         console.debug("FlowMapper: Skipping a flow entry from Langflow due to missing or invalid id, or unusable name/endpoint_name:", flow);
                    }
                } else {
                    console.debug("FlowMapper: Skipping a flow entry from Langflow due to missing or invalid id:", flow);
                }
            }
            
            this.isInitialized = true;
            console.log(`FlowMapper: Initialization complete. Processed ${actualFlowsArray.length} flow entries, successfully mapped ${this.flowNameToIdMap.size} flows by name/endpoint_name.`);

        } catch (error: any) {
            console.error(`FlowMapper: CRITICAL - Error during flow map initialization: ${error.message}`);
            this.isInitialized = false; // Ensure it's marked as not initialized on error
            throw error; // Re-throw to indicate failure to the caller
        }
    }

    public getTrueFlowId(identifier: string): string | undefined {
        if (!this.isInitialized) {
            console.warn("FlowMapper: getTrueFlowId called before successful initialization. Results may be incorrect.");
            // Optionally, you could throw an error here or attempt a lazy initialization.
            // For now, it will proceed with an empty or outdated map if not initialized.
        }

        if (!identifier || typeof identifier !== 'string') {
            console.warn(`FlowMapper: Invalid identifier provided to getTrueFlowId: ${identifier}`);
            return undefined;
        }

        // Check if the identifier is already a UUID
        const isLikelyUuid = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(identifier);
        if (isLikelyUuid) {
            // console.log(`FlowMapper: Identifier '${identifier}' is a UUID. Returning as is.`);
            return identifier;
        }

        const resolvedUuid = this.flowNameToIdMap.get(identifier);
        if (resolvedUuid) {
            // console.log(`FlowMapper: Resolved identifier '${identifier}' to UUID '${resolvedUuid}'.`);
            return resolvedUuid;
        } else {
            // console.log(`FlowMapper: Identifier '${identifier}' not found in flow map and is not a UUID.`);
            return undefined;
        }
    }
} 