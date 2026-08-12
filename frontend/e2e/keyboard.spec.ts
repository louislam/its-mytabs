import { expect, test } from "@playwright/test";
import { currentBarIndex, openTab, selectBars, tickPosition, waitForDemoTab } from "./helpers.ts";

test.describe("keyboard shortcuts", () => {
    test("space toggles play/pause", async ({ page, request }) => {
        await waitForDemoTab(request);
        await openTab(page, "synth");

        await page.keyboard.press("Space");
        await expect.poll(() => page.evaluate(() => window.api.playerState)).toBe(1);

        await page.keyboard.press("Space");
        await expect.poll(() => page.evaluate(() => window.api.playerState)).toBe(0);
    });

    test("arrow keys move the cursor bar by bar", async ({ page, request }) => {
        await waitForDemoTab(request);
        await openTab(page, "synth");

        const barCount = await page.evaluate(() => window.api.score.masterBars.length);
        const start = await currentBarIndex(page);

        await page.keyboard.press("ArrowRight");
        await expect.poll(() => currentBarIndex(page)).toBe(Math.min(start + 1, barCount - 1));

        await page.keyboard.press("ArrowLeft");
        await expect.poll(() => currentBarIndex(page)).toBe(start);
    });

    test("arrow left stays on the first bar", async ({ page, request }) => {
        await waitForDemoTab(request);
        await openTab(page, "synth");

        await page.evaluate(() => {
            window.api.tickPosition = 0;
        });
        await page.keyboard.press("ArrowLeft");
        await expect.poll(() => currentBarIndex(page)).toBe(0);
    });

    test("arrow up plays from the highlighted range", async ({ page, request }) => {
        await waitForDemoTab(request);
        await openTab(page, "synth");

        const range = await selectBars(page, 1, 3);

        await page.keyboard.press("ArrowUp");
        await expect.poll(() => page.evaluate(() => window.api.playerState)).toBe(1);
        await expect.poll(() => tickPosition(page)).toBeGreaterThanOrEqual(range.startTick);
    });

    test("key s plays from the first bar containing notes", async ({ page, request }) => {
        await waitForDemoTab(request);
        await openTab(page, "synth");

        await page.keyboard.press("KeyS");
        await expect.poll(() => page.evaluate(() => window.api.playerState)).toBe(1);
    });
});
