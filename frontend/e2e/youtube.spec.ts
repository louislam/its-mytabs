import { expect, test } from "@playwright/test";
import { TAB_ID, waitForDemoTab } from "./helpers.ts";

// "Me at the zoo" - the official, reliably embeddable YouTube test video added
// to the demo tab by the e2e server helper. The demo tab's original video
// (VuKSlOT__9s) is not embeddable and silently fails to cue, so it cannot be
// used to exercise playback.
const YOUTUBE_VIDEO_ID = "M7lc1UVf-VE";

// YouTube tests depend on external network + YouTube's player. Set
// MYTABS_SKIP_YOUTUBE=1 to skip them (e.g. CI without internet). They are NOT
// skipped by default.
const skipYoutube = ["1", "true"].includes(process.env.MYTABS_SKIP_YOUTUBE ?? "");

test.describe("youtube source", () => {
    test.skip(skipYoutube, "YouTube tests skipped via MYTABS_SKIP_YOUTUBE=1");

    test("loads the embed, is selectable and plays", async ({ page, request }) => {
        await waitForDemoTab(request);
        await page.goto(`/tab/${TAB_ID}?audio=youtube-${YOUTUBE_VIDEO_ID}`);

        // Wait until the embed is created and the video is actually cued (the
        // iframe src carries the video id once cueVideoById took effect) with
        // the player switched to external media mode.
        await page.waitForFunction(
            (id) => {
                const api = window.api;
                const iframe = document.querySelector(".player iframe");
                return (
                    !!iframe &&
                    (iframe.getAttribute("src") ?? "").includes(id) &&
                    api?.settings?.player?.playerMode === 4
                );
            },
            YOUTUBE_VIDEO_ID,
            { timeout: 60_000 },
        );

        // The youtube source is the active one in the audio list
        await page.click(".audio-selector .button");
        await expect(
            page.locator(".audio-list .audio.item", { hasText: `Youtube: ${YOUTUBE_VIDEO_ID}` }),
        ).toHaveClass(/active/);
        await page.click(".audio-selector .button");

        // Playback actually starts and advances through the video
        await page.getByRole("button", { name: "Play" }).click();
        await expect
            .poll(() => page.evaluate(() => window.api.playerState), { timeout: 30_000 })
            .toBe(1);
        await expect
            .poll(() => page.evaluate(() => window.api.timePosition ?? 0), { timeout: 30_000 })
            .toBeGreaterThan(200);
    });
});
