import type { APIRequestContext, Page } from "@playwright/test";

export const TAB_ID = "1";
export const AUDIO_FILENAME = "e2e-silence.ogg";
/** Second non-stem audio file, used to assert buttons are disabled during a job. */
export const SECOND_AUDIO_FILENAME = "e2e-second.ogg";
/** Filename that looks like a separated stem; its Separate button must be hidden. */
export const STEM_EXAMPLE_FILENAME = "e2e-stem-example_guitar.ogg";

/** Admin account created by the e2e server bootstrap via the /register endpoint. */
export const ADMIN_EMAIL = "e2e@its-mytabs.test";
export const ADMIN_PASSWORD = "e2e-admin-password";

/**
 * Log in as the e2e admin account through the real login UI.
 */
export async function login(page: Page): Promise<void> {
    await page.goto("/login");
    await page.fill("#floatingInput", ADMIN_EMAIL);
    await page.fill("#floatingPassword", ADMIN_PASSWORD);
    await page.click('button[type="submit"]');
    await page.waitForURL("/");
}

/**
 * Wait until the demo tab is ready and the e2e audio file is registered.
 * The server helper adds the audio file after the backend starts, so it may
 * not be there on the very first request.
 */
export async function waitForDemoTab(request: APIRequestContext): Promise<void> {
    const deadline = Date.now() + 60_000;
    while (Date.now() < deadline) {
        const res = await request.get(`/api/tab/${TAB_ID}`);
        if (res.ok()) {
            const data = await res.json();
            if (data.audioList?.some((a: { filename: string }) => a.filename === AUDIO_FILENAME)) {
                return;
            }
        }
        await new Promise((r) => setTimeout(r, 500));
    }
    throw new Error(`Demo tab with ${AUDIO_FILENAME} not ready`);
}
