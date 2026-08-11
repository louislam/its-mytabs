import { expect, test } from "@playwright/test";
import { AUDIO_FILENAME, TAB_ID, waitForDemoTab } from "./helpers.ts";

test.describe("count in", () => {
    test("delays external audio playback until the count-in finishes", async ({ page, request }) => {
        await waitForDemoTab(request);

        // Start on the external audio file so the custom Web Audio count-in is used
        await page.goto(`/tab/${TAB_ID}?audio=audio-${AUDIO_FILENAME}`);

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

        // Sanity: the audio element is there and not playing yet
        await expect
            .poll(() =>
                page.evaluate(() => {
                    const audio = document.querySelector("audio");
                    return audio ? audio.paused : null;
                })
            )
            .toBe(true);

        // Enable count in (now usable on external audio sources too)
        await page.getByRole("button", { name: "Count in" }).click();
        await expect(page.getByRole("button", { name: "Count in" })).toHaveClass(/active/);

        // Expected count-in length: one bar of beats at the score tempo
        const countInMs = await page.evaluate(() => {
            const api = window.api;
            const bar = api.score.masterBars[0];
            const bpm = bar.tempoAutomations?.[0]?.value ?? 120;
            const beats = bar.timeSignatureNumerator ?? 4;
            return Math.round((beats * 60000) / bpm);
        });

        // Press play: the audio must be delayed by the count-in
        await page.getByRole("button", { name: "Play" }).click();

        const startedAt = Date.now();
        await expect
            .poll(
                () =>
                    page.evaluate(() => {
                        const audio = document.querySelector("audio");
                        return audio ? !audio.paused : false;
                    }),
                { timeout: countInMs + 8000 },
            )
            .toBe(true);
        const elapsed = Date.now() - startedAt;

        // The audio only started after the count-in finished, not immediately
        expect(elapsed).toBeGreaterThanOrEqual(countInMs - 500);
        expect(elapsed).toBeLessThanOrEqual(countInMs + 2000);
    });
});
