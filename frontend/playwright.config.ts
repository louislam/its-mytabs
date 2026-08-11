import { defineConfig } from "@playwright/test";

// The backend runs in demo mode and serves the built frontend from ./dist
const e2ePort = process.env.MYTABS_E2E_PORT ?? "47779";

export default defineConfig({
    testDir: "./e2e",
    fullyParallel: false,
    workers: 1,
    timeout: 90_000,
    expect: { timeout: 15_000 },
    retries: 0,
    reporter: [["list"]],
    use: {
        baseURL: `http://127.0.0.1:${e2ePort}`,
        headless: !!process.env.CI,
        viewport: { width: 1280, height: 720 },
        trace: "on-first-retry",
        video: "retain-on-failure",
        launchOptions: {
            // The count-in delays media playback by ~a bar after the play click,
            // so allow the audio element to start without a fresh user gesture.
            args: ["--autoplay-policy=no-user-gesture-required"],
        },
    },
    webServer: {
        // Build the frontend and start the backend (demo mode) for the tests.
        command: "deno task build-frontend && deno run -A --config=deno.jsonc frontend/e2e/start-server.ts",
        cwd: "..",
        url: `http://127.0.0.1:${e2ePort}`,
        reuseExistingServer: !process.env.CI,
        timeout: 180_000,
    },
});
