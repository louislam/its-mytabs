import { defineConfig, devices } from "@playwright/test";

// The backend runs in demo mode and serves the built frontend from ./dist
const e2ePort = process.env.MYTABS_E2E_PORT ?? "47779";

export default defineConfig({
    testDir: "./e2e",
    fullyParallel: false,
    workers: 1,
    timeout: 90_000,
    expect: { timeout: 15_000 },
    retries: 0,
    maxFailures: 1,
    reporter: [["list"]],
    use: {
        baseURL: `http://127.0.0.1:${e2ePort}`,
        viewport: { width: 1280, height: 720 },
        trace: "on-first-retry",
        video: "retain-on-failure",
    },
    projects: [
        {
            name: "chromium",
            use: {
                ...devices["Desktop Chrome"],
                headless: true,
                launchOptions: {
                    // The count-in delays media playback by ~a bar after the play
                    // click, so allow the audio element to start without a fresh
                    // user gesture.
                    args: ["--autoplay-policy=no-user-gesture-required"],
                },
            },
        },
        {
            name: "firefox",
            // Headless Firefox occasionally fails to start the <audio> element
            // (intermittent media quirk), so retry once before declaring failure.
            retries: 1,
            use: {
                ...devices["Desktop Firefox"],
                // A headed Firefox window that is not focused gets throttled
                // (timers + Web Audio), making playback tests take minutes.
                // Headless avoids the throttling entirely.
                headless: true,
                launchOptions: {
                    // Allow audio playback without a user gesture (Firefox
                    // otherwise blocks autoplay for audible media).
                    firefoxUserPrefs: {
                        "media.autoplay.default": 0,
                        "media.autoplay.blocking_policy": 0,
                        "media.autoplay.ask-permission": false,
                        "media.autoplay.enabled.user-gestures-needed": false,
                        "media.autoplay.block-webaudio": false,
                        // Avoid background-tab throttling when debugging headed
                        // (an unfocused Firefox window throttles timers/audio).
                        "dom.min_background_timeout_value": 0,
                        "dom.min_background_timeout_value_without_budget_throttling": 0,
                    },
                },
            },
        },
        {
            name: "webkit",
            use: {
                ...devices["Desktop Safari"],
                headless: true,
            },
        },
    ],
    webServer: {
        // Build the frontend and start the backend (demo mode) for the tests.
        command: "deno task build-frontend && deno run -A --config=deno.jsonc frontend/e2e/start-server.ts",
        cwd: "..",
        url: `http://127.0.0.1:${e2ePort}`,
        reuseExistingServer: !process.env.CI,
        timeout: 180_000,
    },
});
