import { createRouter, createWebHistory, RouteRecordRaw } from "vue-router";

import Layout from "./layouts/Layout.vue";
import Dashboard from "./pages/Dashboard.vue";
import Home from "./pages/Home.vue";
import Tab from "./pages/Tab.vue";
import Register from "./pages/Register.vue";
import Login from "./pages/Login.vue";
import TabConfig from "./pages/TabConfig.vue";
import Settings from "./pages/Settings.vue";
import TabNew from "./pages/TabNew.vue";

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
                        name: "tabConfig",
                        path: "/tab/:id/config",
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
