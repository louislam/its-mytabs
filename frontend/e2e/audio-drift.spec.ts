import { expect, test } from "@playwright/test";
import { AUDIO_FILENAME, openTab, playbackRange, selectBars, waitForDemoTab } from "./helpers.ts";

test("synth -> audio: cursor stays inside the range (watched for 10s)", async ({ page, request }) => {
    await waitForDemoTab(request);
    await openTab(page, "synth");

    const range = await selectBars(page, 5, 6);
    await expect(page.getByRole("button", { name: "Restart" })).toBeVisible();

    // Switch to the audio file
    await page.click(".audio-selector .button");
    await page.locator(".audio-list .audio.item", { hasText: AUDIO_FILENAME }).click();

    // Watch the cursor for 10s to catch any late drift out of the range
    const samples: { t: number; tick: number; audioTime: number }[] = [];
    for (let i = 0; i < 20; i++) {
        await page.waitForTimeout(500);
        samples.push(
            await page.evaluate((ms) => {
                const a = document.querySelector("audio");
                return {
                    t: ms,
                    tick: window.api.tickPosition ?? 0,
                    audioTime: a ? a.currentTime : -1,
                };
            }, (i + 1) * 500),
        );
    }
    console.log("DRIFT SAMPLES:", JSON.stringify(samples));

    // The range must survive and the cursor must still be inside it
    expect(await playbackRange(page)).toEqual(range);
    const final = samples[samples.length - 1];
    expect(final.tick).toBeGreaterThanOrEqual(range.startTick);
    expect(final.tick).toBeLessThan(range.endTick);
});
