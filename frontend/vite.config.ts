import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import { alphaTab } from "@coderline/alphatab-vite";
import viteCompression from "vite-plugin-compression";
import { visualizer } from "rollup-plugin-visualizer";

// @ts-ignore
import * as jsonc from "jsr:@std/jsonc";

const viteCompressionFilter = /\.(js|mjs|json|css|html|svg)$/i;

// @ts-ignore
const denoJSONC = jsonc.parse(await Deno.readTextFile("../deno.jsonc"));

// Parse deno.jsonc
const appVersion: string = denoJSONC.version;

// https://vite.dev/config/
export default defineConfig({
    define: {
        appVersion: JSON.stringify(appVersion),
    },
    build: {
        outDir: "../dist",
        emptyOutDir: true,
    },
    plugins: [
        vue(),
        alphaTab({
            alphaTabSourceDir: "node_modules/@coderline/alphatab/dist",
        }),
        viteCompression({
            algorithm: "gzip",
            filter: viteCompressionFilter,
        }),
        // https://github.com/denoland/deno/issues/30430
        // Deno 2.4.4 issue, temporarily disable brotli
        /* viteCompression({
            algorithm: "brotliCompress",
            filter: viteCompressionFilter,
        }),*/
        visualizer({
            filename: "../data/stats.html",
        }),
    ],

    server: {
        host: "0.0.0.0",
    },
});
