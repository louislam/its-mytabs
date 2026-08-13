import { expect, test } from "@playwright/test";
import { AUDIO_FILENAME, beatPosition, openTab, playbackRange, selectBars, waitForDemoTab } from "./helpers.ts";

test.describe("playback range highlight", () => {
    test("is preserved when switching the audio source", async ({ page, request }) => {
        await waitForDemoTab(request);

        // Demo mode redirects every page to /tab/1. Force synth so no YouTube is loaded.
        await openTab(page, "synth");

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
        await openTab(page, "synth");

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
        await openTab(page, "synth");

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
        await openTab(page, "synth");

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
        await openTab(page, "synth");

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

    test("dragging the end handle past the start cannot collapse the range", async ({ page, request }) => {
        await waitForDemoTab(request);
        await openTab(page, "synth");

        const before = await selectBars(page, 1, 3);

        const endHandle = page.locator(".at-selection-handle-end");
        const endRect = await endHandle.boundingBox();
        expect(endRect).toBeTruthy();

        // Drag the end handle far to the left, past the start handle
        const target = await beatPosition(page, 0, 0);
        await page.mouse.move(endRect!.x + endRect!.width / 2, endRect!.y + endRect!.height / 2);
        await page.mouse.down();
        await page.mouse.move(target.x, target.y, { steps: 10 });
        await page.mouse.up();

        // The range is clamped to a minimum instead of disappearing
        const range = await playbackRange(page);
        expect(range).toBeTruthy();
        expect(range!.startTick).toBe(before.startTick);
        expect(range!.endTick).toBeGreaterThan(range!.startTick);
        expect(range!.endTick).toBeLessThan(before.endTick);

        // Still a visible, locked selection (no "invisible playback" state)
        await expect(page.locator(".at-selection-handle-start")).toBeVisible();
        await expect(page.locator(".at-selection-handle-end")).toBeVisible();
        await expect(page.getByRole("button", { name: "Restart" })).toBeVisible();
    });

    test("dragging the start handle past the end cannot collapse the range", async ({ page, request }) => {
        await waitForDemoTab(request);
        await openTab(page, "synth");

        const before = await selectBars(page, 1, 3);

        const startHandle = page.locator(".at-selection-handle-start");
        const startRect = await startHandle.boundingBox();
        expect(startRect).toBeTruthy();

        // Drag the start handle far to the right, past the end handle
        const target = await beatPosition(page, 5, 0);
        await page.mouse.move(startRect!.x + startRect!.width / 2, startRect!.y + startRect!.height / 2);
        await page.mouse.down();
        await page.mouse.move(target.x, target.y, { steps: 10 });
        await page.mouse.up();

        const range = await playbackRange(page);
        expect(range).toBeTruthy();
        expect(range!.startTick).toBeLessThan(range!.endTick);
        expect(range!.startTick).toBeGreaterThan(before.startTick);
        expect(range!.endTick).toBe(before.endTick);

        await expect(page.locator(".at-selection-handle-start")).toBeVisible();
        await expect(page.locator(".at-selection-handle-end")).toBeVisible();
        await expect(page.getByRole("button", { name: "Restart" })).toBeVisible();
    });

    test("dragging on the score selects a range", async ({ page, request }) => {
        await waitForDemoTab(request);
        await openTab(page, "synth");

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

    test("dragging the score does not replace an existing selection", async ({ page, request }) => {
        await waitForDemoTab(request);
        await openTab(page, "synth");

        const locked = await selectBars(page, 1, 3);

        // Drag somewhere else on the score (a fresh selection attempt)
        const start = await beatPosition(page, 0, 0);
        const end = await beatPosition(page, 5, 0);
        await page.mouse.move(start.x, start.y);
        await page.mouse.down();
        await page.mouse.move(end.x, end.y, { steps: 10 });
        await page.mouse.up();

        // The locked range is unchanged
        const range = await page.evaluate(() => {
            const r = window.api.playbackRange;
            if (!r) {
                return null;
            }
            return { startTick: r.startTick, endTick: r.endTick };
        });
        expect(range).toEqual(locked);
        await expect(page.getByRole("button", { name: "Restart" })).toBeVisible();

        // The handles still sit on the locked range, and it is only cleared
        // by the close button
        await expect(page.locator(".at-selection-handle-start")).toBeVisible();
        await page.locator(".at-selection-close").click();
        await expect
            .poll(() => page.evaluate(() => window.api.playbackRange))
            .toBeNull();
    });

    test("only clicks inside the selected range seek", async ({ page, request }) => {
        await waitForDemoTab(request);
        await openTab(page, "synth");

        await selectBars(page, 1, 3);

        // Wait for the cursor to settle at the range start before capturing
        // the "before" position (the seek can land a tick late)
        const range = await playbackRange(page);
        await expect
            .poll(() => page.evaluate(() => window.api.tickPosition ?? 0))
            .toBeGreaterThanOrEqual(range.startTick);

        // Click a beat outside the range: nothing should happen
        const before = await page.evaluate(() => window.api.tickPosition ?? 0);
        const outside = await beatPosition(page, 0, 0);
        await page.mouse.click(outside.x, outside.y);
        await expect.poll(() => page.evaluate(() => window.api.tickPosition ?? 0)).toBe(before);

        // Click a beat inside the range: the cursor seeks there
        const inside = await beatPosition(page, 2, 0);
        const insideTick = await page.evaluate(() => {
            const api = window.api;
            const bar = api.score.tracks[0].staves[0].bars[2];
            return bar.voices[0].beats[0].absolutePlaybackStart;
        });
        await page.mouse.click(inside.x, inside.y);
        await expect
            .poll(() => page.evaluate(() => window.api.tickPosition ?? 0))
            .toBeGreaterThanOrEqual(insideTick);

        // The range is still locked
        await expect(page.getByRole("button", { name: "Restart" })).toBeVisible();
    });

    test("close button clears the selection", async ({ page, request }) => {
        await waitForDemoTab(request);
        await openTab(page, "synth");

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
