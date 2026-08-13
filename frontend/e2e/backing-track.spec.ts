import { expect, test } from "./fixtures.ts";
import { findBackingTrackTabId, openTab, waitForDemoTab } from "./helpers.ts";

test.describe("embedded backing track", () => {
    test("is offered, can be selected and plays", async ({ page, request }) => {
        await waitForDemoTab(request);
        const tabId = await findBackingTrackTabId(request);
        await openTab(page, "synth", tabId);

        // The fixture score carries a backing track with its audio loaded
        const hasBackingTrack = await page.evaluate(() => {
            const bt = window.api.score.backingTrack;
            return !!bt && bt.rawAudioFile && bt.rawAudioFile.length > 0;
        });
        expect(hasBackingTrack).toBe(true);

        // The audio list offers the embedded backing track
        await page.click(".audio-selector .button");
        const item = page.locator(".audio-list .audio.item", { hasText: "Embedded Backing Track" });
        await expect(item).toBeVisible();
        await item.click();

        // Backing-track player mode is engaged (PlayerMode.EnabledBackingTrack = 3)
        await expect
            .poll(() => page.evaluate(() => window.api.settings.player.playerMode))
            .toBe(3);

        // The item is marked active and the player is ready
        await page.click(".audio-selector .button");
        await expect(item).toHaveClass(/active/);
        await expect
            .poll(() => page.evaluate(() => window.api.player?.isReadyForPlayback ?? false))
            .toBe(true);

        // Playback actually advances through the embedded audio
        await page.getByRole("button", { name: "Play" }).click();
        await expect.poll(() => page.evaluate(() => window.api.playerState)).toBe(1);
        await expect
            .poll(() => page.evaluate(() => window.api.timePosition ?? 0), { timeout: 10_000 })
            .toBeGreaterThan(100);
    });
});
