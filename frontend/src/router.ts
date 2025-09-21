import { createRouter, createWebHistory } from "vue-router";

import Layout from "./layouts/Layout.vue";
import Dashboard from "./pages/Dashboard.vue";
import Home from "./pages/Home.vue";
import Tab from "./pages/Tab.vue";

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
                        name: "tab",
                        path: "/tab/:requestPath",
                        component: Tab,
                    },
                ],
            },
        ],
    },
];

export const router = createRouter({
    linkActiveClass: "active",
    history: createWebHistory(),
    routes,
});
