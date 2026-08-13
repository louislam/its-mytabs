import { expect, test } from "@playwright/test";
import { AUDIO_FILENAME, AUDIO_FILENAME2, findBackingTrackTabId, openTab, playbackRange, selectBars, waitForAudioReady, waitForDemoTab } from "./helpers.ts";

// Every audio source available on the demo tab, with the URL param used to
// start on it and the label shown in the audio list.
const demoSources: { key: string; param: string; label: string }[] = [
    { key: "synth", param: "synth", label: "Synth" },
    { key: "audio", param: `audio-${AUDIO_FILENAME}`, label: AUDIO_FILENAME },
    { key: "audio2", param: `audio-${AUDIO_FILENAME2}`, label: AUDIO_FILENAME2 },
    { key: "none", param: "none", label: "No Audio (Mute)" },
];

async function switchSource(page, label: string) {
    await page.click(".audio-selector .button");
    await page.locator(".audio-list .audio.item", { hasText: label }).click();
}

async function assertSourceActive(page, label: string) {
    await page.click(".audio-selector .button");
    await expect(page.locator(".audio-list .audio.item", { hasText: label })).toHaveClass(/active/);
    await page.click(".audio-selector .button");
}

/** The range must survive the switch and the cursor must stay inside it. */
async function assertRangeAndCursor(page, range) {
    // Mode-changing switches briefly clear the range until the new player is
    // ready and restorePlaybackRange re-applies it, so poll for the restore.
    await expect.poll(() => playbackRange(page)).toEqual(range);
    const tick = () => page.evaluate(() => window.api.tickPosition ?? 0);
    await expect.poll(tick).toBeGreaterThanOrEqual(range.startTick);
    await expect.poll(tick).toBeLessThan(range.endTick);
}

async function openFrom(page, from) {
    await openTab(page, from.param);
    if (from.key.startsWith("audio")) {
        await waitForAudioReady(page);
    }
}

for (const from of demoSources) {
    for (const to of demoSources) {
        if (from.key === to.key) {
            continue;
        }
        test(`switching ${from.key} -> ${to.key} keeps the highlighted range and cursor`, async ({ page, request }) => {
            await waitForDemoTab(request);
            await openFrom(page, from);

            const range = await selectBars(page, 5, 6);

            await switchSource(page, to.label);
            await assertSourceActive(page, to.label);
            await assertRangeAndCursor(page, range);
        });
    }
}

test.describe("backing-track tab transitions", () => {
    // The fixture backing track is only ~8.5s long, so select an early range
    // whose start is inside the backing audio (a later bar would clamp the
    // seek to the end of the audio).
    test("synth -> backing track keeps the highlighted range and cursor", async ({ page, request }) => {
        await waitForDemoTab(request);
        await openTab(page, "synth", await findBackingTrackTabId(request));

        const range = await selectBars(page, 1, 2);

        await switchSource(page, "Embedded Backing Track");
        await assertSourceActive(page, "Embedded Backing Track");
        await assertRangeAndCursor(page, range);
    });

    test("backing track -> synth keeps the highlighted range and cursor", async ({ page, request }) => {
        await waitForDemoTab(request);
        await openTab(page, "backingTrack", await findBackingTrackTabId(request));

        const range = await selectBars(page, 1, 2);

        await switchSource(page, "Synth");
        await assertSourceActive(page, "Synth");
        await assertRangeAndCursor(page, range);
    });
});
