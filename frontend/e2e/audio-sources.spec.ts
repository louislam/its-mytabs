import { expect, test } from "./fixtures.ts";
import { AUDIO_FILENAME, beatPosition, findBackingTrackTabId, openTab, selectBars, waitForAudioReady, waitForDemoTab } from "./helpers.ts";

type Source = "synth" | "audio" | "backing" | "none";

async function openSource(page, request, source: Source) {
    if (source === "synth") {
        await openTab(page, "synth");
    } else if (source === "audio") {
        await openTab(page, `audio-${AUDIO_FILENAME}`);
        await waitForAudioReady(page);
    } else if (source === "backing") {
        await openTab(page, "backingTrack", await findBackingTrackTabId(request));
    } else {
        await openTab(page, "none");
    }
}

const cases: { source: Source; label: string }[] = [
    { source: "synth", label: "synth" },
    { source: "audio", label: "audio file" },
    { source: "backing", label: "embedded backing track" },
    { source: "none", label: "no audio" },
];

for (const { source, label } of cases) {
    test.describe(`core player functions on ${label}`, () => {
        if (source === "backing") {
            // Mainly for Webkit (MacOS)
            test.describe.configure({ retries: 5 });
        }

        test("play/pause toggles playback", async ({ page, request }) => {
            await waitForDemoTab(request);
            await openSource(page, request, source);

            await page.getByRole("button", { name: "Play" }).click();
            await expect.poll(() => page.evaluate(() => window.api.playerState)).toBe(1);

            await page.getByRole("button", { name: "Pause" }).click();
            await expect.poll(() => page.evaluate(() => window.api.playerState)).toBe(0);
        });

        test("loop toggles", async ({ page, request }) => {
            await waitForDemoTab(request);
            await openSource(page, request, source);

            await page.getByRole("button", { name: "Loop" }).click();
            await expect(page.getByRole("button", { name: "Loop" })).toHaveClass(/active/);
            await expect.poll(() => page.evaluate(() => window.api.isLooping)).toBe(true);

            await page.getByRole("button", { name: "Loop" }).click();
            await expect.poll(() => page.evaluate(() => window.api.isLooping)).toBe(false);
        });

        test("speed input changes the playback speed", async ({ page, request }) => {
            await waitForDemoTab(request);
            await openSource(page, request, source);

            await page.locator(".select-percentage input").fill("50");
            await expect.poll(() => page.evaluate(() => window.api.playbackSpeed)).toBeCloseTo(0.5);
        });

        test("restart plays from the highlighted range", async ({ page, request }) => {
            await waitForDemoTab(request);
            await openSource(page, request, source);

            const range = await selectBars(page, 1, 3);
            const restart = page.getByRole("button", { name: "Restart" });
            await expect(restart).toBeVisible();

            await restart.click();
            await expect.poll(() => page.evaluate(() => window.api.playerState)).toBe(1);
            await expect
                .poll(() => page.evaluate(() => window.api.tickPosition ?? 0))
                .toBeGreaterThanOrEqual(range.startTick);
        });

        test("clicking a note inside the range seeks", async ({ page, request }) => {
            await waitForDemoTab(request);
            await openSource(page, request, source);

            await selectBars(page, 1, 3);

            // Click while playing so every source applies the seek
            await page.getByRole("button", { name: "Play" }).click();
            await expect.poll(() => page.evaluate(() => window.api.playerState)).toBe(1);

            // Click a beat in the last bar of the range, clearly ahead of the
            // current position so the jump proves the seek happened
            const pos = await beatPosition(page, 3, 0);
            const insideTick = await page.evaluate(
                () => window.api.score.tracks[0].staves[0].bars[3].voices[0].beats[0].absolutePlaybackStart,
            );

            await page.mouse.click(pos.x, pos.y);
            await expect
                .poll(() => page.evaluate(() => window.api.tickPosition ?? 0), { timeout: 3000 })
                .toBeGreaterThanOrEqual(insideTick);

            await page.getByRole("button", { name: "Pause" }).click();
        });
    });
}
