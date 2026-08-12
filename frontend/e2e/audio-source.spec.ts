import { expect, test } from "@playwright/test";
import { AUDIO_FILENAME, openTab, waitForDemoTab } from "./helpers.ts";

test.describe("audio source switching", () => {
    test("switches to an audio file and back", async ({ page, request }) => {
        await waitForDemoTab(request);
        await openTab(page, "synth");

        // The audio element is set up with the file once it becomes the source
        await page.click(".audio-selector .button");
        await page.locator(".audio-list .audio.item", { hasText: AUDIO_FILENAME }).click();
        await expect
            .poll(() => page.evaluate(() => document.querySelector("audio")?.getAttribute("src") ?? ""))
            .toContain(AUDIO_FILENAME);

        // External media player mode is engaged (PlayerMode.EnabledExternalMedia = 4)
        await expect
            .poll(() => page.evaluate(() => window.api.settings.player.playerMode))
            .toBe(4);

        // The item is marked active
        await page.click(".audio-selector .button");
        await expect(page.locator(".audio-list .audio.item", { hasText: AUDIO_FILENAME })).toHaveClass(/active/);

        // Back to synth (PlayerMode.EnabledSynthesizer = 2)
        await page.locator(".audio-list .audio.item", { hasText: "Synth" }).click();
        await expect
            .poll(() => page.evaluate(() => window.api.settings.player.playerMode))
            .toBe(2);
    });

    test("no audio source mutes the player and synth restores volume", async ({ page, request }) => {
        await waitForDemoTab(request);
        await openTab(page, "synth");

        await page.click(".audio-selector .button");
        await page.locator(".audio-list .audio.item", { hasText: "No Audio" }).click();
        await expect.poll(() => page.evaluate(() => window.api.player.masterVolume)).toBe(0);

        await page.click(".audio-selector .button");
        await page.locator(".audio-list .audio.item", { hasText: "Synth" }).click();
        await expect.poll(() => page.evaluate(() => window.api.player.masterVolume)).toBe(1);
    });

    test("plays an audio file source", async ({ page, request }) => {
        await waitForDemoTab(request);
        await openTab(page, `audio-${AUDIO_FILENAME}`);

        await page.getByRole("button", { name: "Play" }).click();
        await expect
            .poll(() =>
                page.evaluate(() => {
                    const audio = document.querySelector("audio");
                    return audio ? !audio.paused : false;
                })
            )
            .toBe(true);

        await page.getByRole("button", { name: "Pause" }).click();
        await expect
            .poll(() => page.evaluate(() => document.querySelector("audio")?.paused ?? true))
            .toBe(true);
    });

    test("backing track item reflects whether the score has one", async ({ page, request }) => {
        await waitForDemoTab(request);
        await openTab(page, "synth");

        const hasBackingTrack = await page.evaluate(() => !!window.api.score.backingTrack);
        await page.click(".audio-selector .button");

        const item = page.locator(".audio-list .audio.item", { hasText: "Embedded Backing Track" });

        if (hasBackingTrack) {
            await expect(item).toBeVisible();
            await item.click();
            await expect(page.locator(".audio-list .audio.item", { hasText: "Embedded Backing Track" })).toHaveClass(
                /active/,
            );
        } else {
            await expect(item).toHaveCount(0);
        }
    });
});
