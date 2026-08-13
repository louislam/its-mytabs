import { expect, test } from "./fixtures.ts";
import { AUDIO_FILENAME, TAB_ID, waitForDemoTab } from "./helpers.ts";

const audioIsPaused = (page) =>
    page.evaluate(() => {
        const audio = document.querySelector("audio");
        return audio ? audio.paused : null;
    });

const audioIsPlaying = (page) =>
    page.evaluate(() => {
        const audio = document.querySelector("audio");
        return audio ? !audio.paused : false;
    });

async function openExternalAudio(page) {
    await page.goto(`/tab/${TAB_ID}?audio=audio-${AUDIO_FILENAME}`);
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
}

async function getCountInMs(page) {
    return page.evaluate(() => {
        const api = window.api;
        const bar = api.score.masterBars[0];
        const bpm = bar.tempoAutomations?.[0]?.value ?? 120;
        const beats = bar.timeSignatureNumerator ?? 4;
        return Math.round((beats * 60000) / bpm);
    });
}

async function selectFirstBars(page) {
    await page.evaluate(() => {
        const api = window.api;
        const bars = api.score.tracks[0].staves[0].bars;
        const firstBeat = bars[0].voices[0].beats[0];
        const lastBeat = bars[Math.min(2, bars.length - 1)].voices[0].beats.at(-1);
        api.playbackRange = {
            startTick: firstBeat.absolutePlaybackStart,
            endTick: lastBeat.absolutePlaybackStart + lastBeat.playbackDuration,
        };
    });
}

test.describe("count in", () => {
    test("delays external audio playback until the count-in finishes", async ({ page, request }) => {
        await waitForDemoTab(request);

        await openExternalAudio(page);

        // Sanity: the audio element is there and not playing yet
        await expect.poll(() => audioIsPaused(page)).toBe(true);

        // Enable count in (now usable on external audio sources too)
        await page.getByRole("button", { name: "Count in" }).click();
        await expect(page.getByRole("button", { name: "Count in" })).toHaveClass(/active/);

        const countInMs = await getCountInMs(page);

        // Press play: the audio must be delayed by the count-in
        await page.getByRole("button", { name: "Play" }).click();

        const startedAt = Date.now();
        await expect.poll(() => audioIsPlaying(page), { timeout: countInMs + 8000 }).toBe(true);
        const elapsed = Date.now() - startedAt;

        // The audio only started after the count-in finished, not immediately
        expect(elapsed).toBeGreaterThanOrEqual(countInMs - 500);
        expect(elapsed).toBeLessThanOrEqual(countInMs + 2000);
    });

    test("re-runs the count-in when seeking by clicking the score while playing", async ({ page, request }) => {
        await waitForDemoTab(request);

        await openExternalAudio(page);

        // Enable count in
        await page.getByRole("button", { name: "Count in" }).click();
        await expect(page.getByRole("button", { name: "Count in" })).toHaveClass(/active/);

        const countInMs = await getCountInMs(page);

        // Start playing (count-in then playback)
        await page.getByRole("button", { name: "Play" }).click();
        await expect.poll(() => audioIsPlaying(page), { timeout: countInMs + 8000 }).toBe(true);

        // Click a beat on the score to seek while playing
        const beatPos = await page.evaluate(() => {
            const api = window.api;
            const bars = api.score.tracks[0].staves[0].bars;
            const beat = bars[Math.min(1, bars.length - 1)].voices[0].beats[0];
            const bounds = api.boundsLookup?.findBeat(beat);
            const surface = document.querySelector(".at-surface");
            if (!bounds || !surface) {
                return null;
            }
            const rect = surface.getBoundingClientRect();
            return {
                x: rect.left + bounds.realBounds.x + bounds.realBounds.w / 2,
                y: rect.top + bounds.realBounds.y + bounds.realBounds.h / 2,
            };
        });
        expect(beatPos).not.toBeNull();

        const seekAt = Date.now();
        await page.mouse.click(beatPos.x, beatPos.y);

        // Playback stops while the count-in runs...
        await expect.poll(() => audioIsPaused(page), { timeout: Math.max(1000, countInMs) }).toBe(true);

        // ... and resumes only after the count-in finished
        await expect.poll(() => audioIsPlaying(page), { timeout: countInMs + 8000 }).toBe(true);
        const elapsed = Date.now() - seekAt;

        expect(elapsed).toBeGreaterThanOrEqual(countInMs - 500);
        expect(elapsed).toBeLessThanOrEqual(countInMs + 2000);
    });
});
