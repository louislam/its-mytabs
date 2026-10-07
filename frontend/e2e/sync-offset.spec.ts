import { expect, test } from "./fixtures.ts";
import { AUDIO_FILENAME2, login, openTab, waitForDemoTab } from "./helpers.ts";

// e2e-silence-2.ogg is configured with simple sync, so the Sync Offset input
// is the simple-sync offset the tab view exposes to logged-in editors.
const SIMPLE_AUDIO = `audio-${AUDIO_FILENAME2}`;

test.describe("show sync offset setting", () => {
    test.beforeEach(async ({ request }) => {
        await waitForDemoTab(request);
    });

    test("shows the Sync Offset by default", async ({ page }) => {
        await login(page);
        await openTab(page, SIMPLE_AUDIO);

        const syncOffset = page.locator(".sync-offset");
        await expect(syncOffset).toBeVisible();
        await expect(syncOffset).toContainText("Sync Offset");
        await expect(syncOffset.locator("input")).toHaveValue("0");
    });

    test("setting page control hides the Sync Offset in the tab view", async ({ page }) => {
        await login(page);

        // The setting is on by default.
        await page.goto("/settings");
        const control = page.locator("#showSyncOffset");
        await expect(control).toHaveValue("true");

        // Turning it off persists and removes the input from the tab view.
        await control.selectOption("false");
        await expect
            .poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("userSetting") ?? "{}").showSyncOffset))
            .toBe(false);
        await openTab(page, SIMPLE_AUDIO);
        await expect(page.locator(".sync-offset")).toHaveCount(0);
    });
});
