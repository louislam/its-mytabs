import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import { alphaTab } from "@coderline/alphatab/vite";

// https://vite.dev/config/
export default defineConfig({
    build: {
        outDir: "../dist",
        emptyOutDir: true,
    },
    plugins: [
        vue(),
        alphaTab({
            alphaTabSourceDir: "node_modules/@coderline/alphatab/dist",
        }),
    ],

    server: {
        host: "0.0.0.0",
    }
});
