import { expect, test, type Page } from "@playwright/test";
import { AUDIO_FILENAME, TAB_ID, waitForDemoTab } from "./helpers.ts";

async function waitForTabReady(page: Page) {
    await page.goto(`/tab/${TAB_ID}?audio=synth`);
    await page.waitForFunction(() => {
        const api = window.api;
        return (
            api &&
            api.score &&
            api.score.masterBars &&
            api.score.masterBars.length > 0 &&
            api.player?.isReadyForPlayback &&
            api.boundsLookup &&
            api.boundsLookup.isFinished
        );
    });
}

async function selectBars(page: Page, startBar: number, endBar: number) {
    return page.evaluate(
        ({ startBar, endBar }) => {
            const api = window.api;
            const bars = api.score.tracks[0].staves[0].bars;
            const firstBar = bars[startBar];
            const lastBar = bars[Math.min(endBar, bars.length - 1)];
            const firstBeat = firstBar.voices[0].beats[0];
            const lastBeat = lastBar.voices[0].beats[lastBar.voices[0].beats.length - 1];
            const startTick = firstBeat.absolutePlaybackStart;
            // Match alphaTab's own end-tick convention (duration - 50) so the
            // end snap stays inside the selected bar instead of the next bar.
            const endTick = lastBeat.absolutePlaybackStart + lastBeat.playbackDuration - 50;
            api.playbackRange = { startTick, endTick };
            return { startTick, endTick };
        },
        { startBar, endBar }
    );
}

/** Screen coordinates of a beat (for real mouse events on the score). */
async function beatPosition(page: Page, bar: number, beat: number) {
    return page.evaluate(
        ({ bar, beat }) => {
            const api = window.api;
            const beats = api.score.tracks[0].staves[0].bars[bar].voices[0].beats;
            const target = beats[Math.min(beat, beats.length - 1)];
            const bounds = api.boundsLookup.findBeat(target);
            const element = (api.canvasElement as unknown as { element: HTMLElement }).element;
            const rect = element.getBoundingClientRect();
            return {
                x: rect.left + bounds.realBounds.x + bounds.realBounds.w / 2,
                y: rect.top + bounds.realBounds.y + bounds.realBounds.h / 2,
            };
        },
        { bar, beat }
    );
}

test.describe("playback range highlight", () => {
    test("is preserved when switching the audio source", async ({ page, request }) => {
        await waitForDemoTab(request);

        // Demo mode redirects every page to /tab/1. Force synth so no YouTube is loaded.
        await waitForTabReady(page);

        // Select a bar range (highlights the bars), like the user would
        const selected = await page.evaluate(() => {
            const api = window.api;
            const bars = api.score.tracks[0].staves[0].bars;
            const firstBar = bars[0];
            const lastBar = bars[Math.min(2, bars.length - 1)];
            const firstBeat = firstBar.voices[0].beats[0];
            const lastBeat = lastBar.voices[0].beats[lastBar.voices[0].beats.length - 1];
            const startTick = firstBeat.absolutePlaybackStart;
            // Match alphaTab's own end-tick convention (duration - 50) so the
            // end snap stays inside the selected bar instead of the next bar.
            const endTick = lastBeat.absolutePlaybackStart + lastBeat.playbackDuration - 50;
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

test.describe("selection handles", () => {
    test("handles and close button appear when a range is selected", async ({ page, request }) => {
        await waitForDemoTab(request);
        await waitForTabReady(page);

        await selectBars(page, 1, 3);

        const startHandle = page.locator(".at-selection-handle-start");
        const endHandle = page.locator(".at-selection-handle-end");
        const close = page.locator(".at-selection-close");

        await expect(startHandle).toBeVisible();
        await expect(endHandle).toBeVisible();
        await expect(close).toBeVisible();
        await expect(page.getByRole("button", { name: "Restart" })).toBeVisible();
    });

    test("single-clicking a note does not clear the selected range", async ({ page, request }) => {
        await waitForDemoTab(request);
        await waitForTabReady(page);

        const selected = await selectBars(page, 1, 3);

        // Plain click on a beat outside the selected range
        const pos = await beatPosition(page, 0, 0);
        await page.mouse.click(pos.x, pos.y);

        // The range survives and the "Restart" button is still there
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
        await expect(page.getByRole("button", { name: "Restart" })).toBeVisible();
        await expect(page.locator(".at-selection-handle-start")).toBeVisible();

        // The click still seeks the cursor
        const clickedTick = await page.evaluate(() => {
            const api = window.api;
            const bars = api.score.tracks[0].staves[0].bars;
            return bars[0].voices[0].beats[0].absolutePlaybackStart;
        });
        await expect
            .poll(() => page.evaluate(() => window.api.tickPosition ?? 0))
            .toBeGreaterThanOrEqual(clickedTick);
    });

    test("dragging the end handle expands the selected range", async ({ page, request }) => {
        await waitForDemoTab(request);
        await waitForTabReady(page);

        const before = await selectBars(page, 1, 2);

        const endHandle = page.locator(".at-selection-handle-end");
        const endRect = await endHandle.boundingBox();
        expect(endRect).toBeTruthy();

        // Drag the end handle over a beat in a later bar
        const target = await beatPosition(page, 5, 0);
        await page.mouse.move(endRect!.x + endRect!.width / 2, endRect!.y + endRect!.height / 2);
        await page.mouse.down();
        await page.mouse.move(target.x, target.y, { steps: 10 });
        await page.mouse.up();

        const after = await page.evaluate(() => {
            const range = window.api.playbackRange;
            if (!range) {
                return null;
            }
            return { startTick: range.startTick, endTick: range.endTick };
        });
        expect(after).toBeTruthy();
        expect(after!.startTick).toBe(before.startTick);
        expect(after!.endTick).toBeGreaterThan(before.endTick);
        await expect(page.getByRole("button", { name: "Restart" })).toBeVisible();
    });

    test("dragging the start handle expands the selected range backwards", async ({ page, request }) => {
        await waitForDemoTab(request);
        await waitForTabReady(page);

        const before = await selectBars(page, 2, 3);

        const startHandle = page.locator(".at-selection-handle-start");
        const startRect = await startHandle.boundingBox();
        expect(startRect).toBeTruthy();

        // Drag the start handle over a beat in an earlier bar
        const target = await beatPosition(page, 0, 0);
        await page.mouse.move(startRect!.x + startRect!.width / 2, startRect!.y + startRect!.height / 2);
        await page.mouse.down();
        await page.mouse.move(target.x, target.y, { steps: 10 });
        await page.mouse.up();

        const after = await page.evaluate(() => {
            const range = window.api.playbackRange;
            if (!range) {
                return null;
            }
            return { startTick: range.startTick, endTick: range.endTick };
        });
        expect(after).toBeTruthy();
        expect(after!.startTick).toBeLessThan(before.startTick);
        expect(after!.endTick).toBe(before.endTick);
        await expect(page.getByRole("button", { name: "Restart" })).toBeVisible();
    });

    test("dragging on the score selects a range", async ({ page, request }) => {
        await waitForDemoTab(request);
        await waitForTabReady(page);

        // Drag from the first beat of bar 0 to the last beat of bar 2
        const start = await beatPosition(page, 0, 0);
        const end = await beatPosition(page, 2, 0);
        await page.mouse.move(start.x, start.y);
        await page.mouse.down();
        await page.mouse.move(end.x, end.y, { steps: 10 });
        await page.mouse.up();

        const range = await page.evaluate(() => {
            const r = window.api.playbackRange;
            if (!r) {
                return null;
            }
            return { startTick: r.startTick, endTick: r.endTick };
        });
        expect(range).toBeTruthy();
        expect(range!.endTick).toBeGreaterThan(range!.startTick);
        await expect(page.getByRole("button", { name: "Restart" })).toBeVisible();
        await expect(page.locator(".at-selection-handle-start")).toBeVisible();
    });

    test("close button clears the selection", async ({ page, request }) => {
        await waitForDemoTab(request);
        await waitForTabReady(page);

        await selectBars(page, 1, 3);

        await expect(page.getByRole("button", { name: "Restart" })).toBeVisible();
        await page.locator(".at-selection-close").click();

        await expect
            .poll(() => page.evaluate(() => window.api.playbackRange))
            .toBeNull();
        await expect(page.getByRole("button", { name: "Restart" })).toBeHidden();
        await expect(page.locator(".at-selection-handle-start")).toBeHidden();
        await expect(page.locator(".at-selection-handle-end")).toBeHidden();
        await expect(page.locator(".at-selection-close")).toBeHidden();
    });
});
