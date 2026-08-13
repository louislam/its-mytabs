import { expect, test } from "./fixtures.ts";
import { AUDIO_FILENAME, AUDIO_FILENAME2, openTab, selectBars, waitForDemoTab } from "./helpers.ts";

const SOURCES: string[] = [
    AUDIO_FILENAME,
    AUDIO_FILENAME2,
    "Synth",
    "No Audio (Mute)",
    AUDIO_FILENAME,
    "Synth",
    AUDIO_FILENAME2,
    AUDIO_FILENAME,
    "No Audio (Mute)",
    AUDIO_FILENAME2,
];

async function readState(page) {
    return page.evaluate(() => {
        const a = document.querySelector("audio");
        return {
            playerState: window.api.playerState,
            audioPaused: a ? a.paused : null,
            buttonPause: !!document.querySelector("button .btn-primary"),
        };
    });
}

test("normal-paced audio source switching stays paused", async ({ page, request }) => {
    await waitForDemoTab(request);
    await openTab(page, "synth");
    await selectBars(page, 5, 6); // highlighted range, pause state

    const events: string[] = [];
    for (let i = 0; i < SOURCES.length; i++) {
        await page.click(".audio-selector .button");
        await page.locator(".audio-list .audio.item", { hasText: SOURCES[i] }).click();
        // normal pace: let the switch settle
        await page.waitForTimeout(800);
        const state = await readState(page);
        if (state.playerState === 1 || state.audioPaused === false) {
            events.push(`after switch #${i + 1} (${SOURCES[i]}): ${JSON.stringify(state)}`);
        }
        console.log(`switch #${i + 1} (${SOURCES[i]}):`, JSON.stringify(state));
    }

    await page.waitForTimeout(2000);
    const final = await readState(page);
    if (final.playerState === 1 || final.audioPaused === false) {
        events.push(`final: ${JSON.stringify(final)}`);
    }

    console.log("UNEXPECTED PLAYBACK EVENTS:", JSON.stringify(events));
    expect(events).toEqual([]);
});
