import { createRouter, createWebHistory, RouteRecordRaw } from "vue-router";

import Layout from "./layouts/Layout.vue";
import Dashboard from "./pages/Dashboard.vue";
import Home from "./pages/Home.vue";
import Register from "./pages/Register.vue";
import Login from "./pages/Login.vue";
import TabConfig from "./pages/TabConfig.vue";
import Settings from "./pages/Settings.vue";
import TabNew from "./pages/TabNew.vue";
import { baseURL } from "./app.js";

const Tab = () => import("./pages/Tab.vue");

// Demo mode redirect URL
const DEMO_TAB_URL = "/tab/1?audio=youtube-VuKSlOT__9s&track=2";

const routes: RouteRecordRaw[] = [
    {
        path: "/empty",
        component: Layout,
        children: [
            {
                path: "",
                component: Dashboard,
                children: [
                    {
                        name: "home",
                        path: "/",
                        component: Home,
                    },
                    {
                        path: "/tab/:id/edit/info",
                        component: TabConfig,
                    },
                    {
                        path: "/tab/:id/edit/audio",
                        component: TabConfig,
                    },
                    {
                        path: "/tab/:id/edit/tab-file",
                        component: TabConfig,
                    },
                    {
                        name: "tabNew",
                        path: "/new-tab",
                        component: TabNew,
                    },
                    {
                        name: "tab",
                        path: "/tab/:id",
                        component: Tab,
                    },
                    {
                        name: "settings",
                        path: "/settings",
                        component: Settings,
                    },
                ],
            },
            {
                name: "register",
                path: "/register",
                component: Register,
            },
            {
                name: "login",
                path: "/login",
                component: Login,
            },
        ],
    },
];

export const router = createRouter({
    linkActiveClass: "active",
    history: createWebHistory(),
    routes,
});

// Navigation guard to redirect to demo tab when in demo mode
let isDemoMode: boolean | null = null;
router.beforeEach(async (to, from, next) => {
    // Lazy load demo mode status on first navigation
    if (isDemoMode === null) {
        try {
            const response = await fetch(`${baseURL}/api/is-demo-mode`);
            const data = await response.json();
            isDemoMode = data.isDemoMode || false;
        } catch (error) {
            console.error("Failed to check demo mode:", error);
            isDemoMode = false;
        }
    }

    if (isDemoMode) {
        // Allow Settings and Tab view pages (but not edit pages)
        const isSettingsPage = to.path === "/settings";
        const isTabViewPage = to.name === "tab";
        
        if (!isSettingsPage && !isTabViewPage) {
            // Redirect to the demo tab
            next(DEMO_TAB_URL);
            return;
        }
    }
    next();
});
