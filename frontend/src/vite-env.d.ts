/// <reference types="vite/client" />

import type { AlphaTabApi } from "@coderline/alphatab";

/**
 * Global window properties injected by the backend
 */
declare global {
    interface Window {
        /**
         * Indicates if the application is running in demo mode.
         * Set by the backend based on the MYTABS_DEMO_MODE environment variable.
         * When true, navigation is restricted to demo tab, settings, and register pages.
         */
        isDemo: boolean;

        /**
         * The alphaTab API instance exposed for debugging on the tab page.
         * Set in Tab.vue (initContainer).
         */
        api: AlphaTabApi;
    }
}
