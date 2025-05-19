// examples/basic/static/example-app-logic.ts

interface Profile {
  proxyEndpointId: string;
  widgetTitle?: string;
  // Add other profile properties if they exist and are used in the UI
}

// Define the LangflowChatbotPlugin and its instance type if available globally
// This is for TypeScript to understand the shape of the plugin
declare global {
  interface Window {
    LangflowChatbotPlugin?: {
      init: (config: any) => Promise<any>; // Replace 'any' with actual config/instance types
      // Add other plugin methods/properties if needed
    };
    ChatbotExampleApp: {
      ui: {
        initializeUI: (launchCallback: () => Promise<void>) => Promise<void>;
        getUserProvidedConfig: () => { proxyEndpointId: string | undefined; sessionId: string | undefined };
        updateSessionIdField: (newId: string) => void;
      };
      // Add other ChatbotExampleApp methods if they need to be globally accessible
    };
  }
}

const ChatbotAppUIManager = {
  fetchAndPopulateProfiles: async (): Promise<string | null> => {
    const profileSelect = document.getElementById('proxy-endpoint-id-select') as HTMLSelectElement | null;
    const launchButton = document.getElementById('launch-chatbot-button') as HTMLButtonElement | null;

    if (launchButton) launchButton.disabled = true;

    try {
      const response = await fetch('/api/langflow/profiles');
      if (!response.ok) throw new Error(`Failed to fetch profiles: ${response.status} ${response.statusText}`);
      const profiles: Profile[] = await response.json();

      if (profileSelect && profiles && profiles.length > 0) {
        profiles.forEach(profile => {
          const option = document.createElement('option');
          option.value = profile.proxyEndpointId;
          option.textContent = profile.widgetTitle || profile.proxyEndpointId;
          profileSelect.appendChild(option);
        });
        profileSelect.value = profiles[0].proxyEndpointId;
        if (launchButton) launchButton.disabled = false;
        return profiles[0].proxyEndpointId;
      } else {
        console.warn("No chatbot profiles or profile select element not found.");
        if (profileSelect) {
            const option = document.createElement('option');
            option.textContent = 'No profiles available';
            option.disabled = true;
            profileSelect.appendChild(option);
        }
        return null;
      }
    } catch (error) {
      console.error("Error fetching profiles:", error);
      if (profileSelect) {
        const option = document.createElement('option');
        option.textContent = 'Error loading profiles';
        option.disabled = true;
        profileSelect.appendChild(option);
      }
      alert(`Could not load chatbot profiles: ${(error as Error).message}.`);
      return null;
    }
  },

  getUserProvidedConfig: (): { proxyEndpointId: string | undefined; sessionId: string | undefined } => {
    const profileSelect = document.getElementById('proxy-endpoint-id-select') as HTMLSelectElement | null;
    const sessionIdInput = document.getElementById('session-id-input') as HTMLInputElement | null;
    return {
      proxyEndpointId: profileSelect ? profileSelect.value : undefined,
      sessionId: sessionIdInput ? sessionIdInput.value.trim() || undefined : undefined,
    };
  },

  updateSessionIdField: (newId: string): void => {
    const sessionIdInput = document.getElementById('session-id-input') as HTMLInputElement | null;
    if (sessionIdInput && sessionIdInput.value.trim() === '') {
        sessionIdInput.value = newId;
        console.log('UI Session ID field populated by plugin event:', newId);
    } else if (sessionIdInput) {
        console.log('Plugin reported session ID change to:', newId, '; UI field not updated as it already contained a value or was user-set.');
    }
  },

  setupLaunchTriggers: (launchCallback: () => Promise<void>): void => {
    const launchButton = document.getElementById('launch-chatbot-button') as HTMLButtonElement | null;
    const sessionIdInput = document.getElementById('session-id-input') as HTMLInputElement | null;
    const profileSelectElement = document.getElementById('proxy-endpoint-id-select') as HTMLSelectElement | null;

    if (launchButton) launchButton.addEventListener('click', launchCallback);

    const enterKeyHandler = (event: KeyboardEvent) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        launchCallback();
      }
    };
    if (sessionIdInput) sessionIdInput.addEventListener('keydown', enterKeyHandler);
    if (profileSelectElement) profileSelectElement.addEventListener('keydown', enterKeyHandler);
  },

  initializeUI: async function(launchCallback: () => Promise<void>): Promise<void> {
    const firstProfileId = await this.fetchAndPopulateProfiles();
    this.setupLaunchTriggers(launchCallback);

    if (firstProfileId) {
      const initialUserConfig = this.getUserProvidedConfig();
      if (!initialUserConfig.sessionId) {
        console.log("UI initialized: Auto-triggering chatbot launch with first profile and no initial session ID.");
        await launchCallback(); 
      } else {
        console.log("UI initialized: Found pre-filled session ID, launch button is active for user to initiate.");
      }
    } else {
        console.warn("UI initialized, but chatbot auto-launch skipped: no profiles or error during profile fetch.");
    }
  }
};

// Assign to window for global access
if (typeof window !== 'undefined') {
  window.ChatbotExampleApp = { ui: ChatbotAppUIManager };
}

// Add an empty export to treat this file as a module for TypeScript
export {}; 