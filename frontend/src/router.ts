import { createRouter, createWebHistory } from "vue-router";

import Layout from "./layouts/Layout.vue";
import Dashboard from "./pages/Dashboard.vue";
import Home from "./pages/Home.vue";
import Tab from "./pages/Tab.vue";
import Register from "./pages/Register.vue";
import Login from "./pages/Login.vue";
import TabConfig from "./pages/TabConfig.vue";
import Settings from "./pages/Settings.vue";

const routes = [
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
                        name: "tabConfig",
                        path: "/new-tab",
                        component: TabConfig,
                    },
                    {
                        name: "tab",
                        path: "/tab/:requestPath",
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
