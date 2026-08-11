import { expect, test } from "@playwright/test";
import { AUDIO_FILENAME, TAB_ID, waitForDemoTab } from "./helpers.ts";

test.describe("playback range highlight", () => {
    test("is preserved when switching the audio source", async ({ page, request }) => {
        await waitForDemoTab(request);

        // Demo mode redirects every page to /tab/1. Force synth so no YouTube is loaded.
        await page.goto(`/tab/${TAB_ID}?audio=synth`);

        // Wait for the score to be loaded and the player to be ready for playback
        await page.waitForFunction(() => {
            const api = window.api;
            return (
                api &&
                api.score &&
                api.score.masterBars &&
                api.score.masterBars.length > 0 &&
                api.player?.isReadyForPlayback
            );
        });

        // Select a bar range (highlights the bars), like the user would
        const selected = await page.evaluate(() => {
            const api = window.api;
            const bars = api.score.tracks[0].staves[0].bars;
            const firstBar = bars[0];
            const lastBar = bars[Math.min(2, bars.length - 1)];
            const firstBeat = firstBar.voices[0].beats[0];
            const lastBeat = lastBar.voices[0].beats[lastBar.voices[0].beats.length - 1];
            const startTick = firstBeat.absolutePlaybackStart;
            const endTick = lastBeat.absolutePlaybackStart + lastBeat.playbackDuration;
            api.playbackRange = { startTick, endTick };
            return { startTick, endTick };
        });

        // The range is applied, e.g. the "Restart" button appears
        await expect(page.getByRole("button", { name: "Restart" })).toBeVisible();

        // Switch to the e2e audio file
        await page.click(".audio-selector .button");
        await page.locator(".audio-list .audio.item", { hasText: AUDIO_FILENAME }).click();

        // The player is re-created on audio switch; the range must be restored once the new player is ready
        await expect
            .poll(() =>
                page.evaluate(() => {
                    const api = window.api;
                    if (!api?.playbackRange) {
                        return null;
                    }
                    return {
                        startTick: api.playbackRange.startTick,
                        endTick: api.playbackRange.endTick,
                    };
                })
            )
            .toEqual(selected);

        // The "Restart" button is still available after the switch
        await expect(page.getByRole("button", { name: "Restart" })).toBeVisible();
    });
});
