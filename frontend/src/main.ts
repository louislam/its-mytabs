import { createApp } from "vue";

import App from "./App.vue";
import { FontAwesomeIcon } from "./icon.ts";
import { createBootstrap } from "bootstrap-vue-next";

// Dependencies
import { router } from "./router.ts";
import { i18n } from "./i18n.ts";

// CSS
import "./styles/main.scss";

const app = createApp(App);
app.use(router);
app.use(i18n);
app.use(createBootstrap()); // Important
app.component("FontAwesomeIcon", FontAwesomeIcon);
app.mount("#app");

// HMR is not working properly with AlphaTab, so we do a full reload on update
if (import.meta.hot) {
    import.meta.hot.on("vite:afterUpdate", () => {
        console.log("Hot update - reloading page to reset AlphaTab");

        // tab page only
        const isTabPage = window.location.pathname.startsWith("/tab/");
        if (isTabPage) {
            window.location.reload();
        }
    });
}
