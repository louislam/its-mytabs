import { expect, test } from "./fixtures.ts";
import { AUDIO_FILENAME, TAB_ID, waitForDemoTab } from "./helpers.ts";

test.describe("advanced sync", () => {
    test("advanced sync points stay applied after switching to an audio source", async ({ page, request }) => {
        await waitForDemoTab(request);

        // The demo fixture configures e2e-silence.ogg with advanced sync:
        // \sync 0 0 0
        // \sync 28 0 70000
        // \sync 93 0 272000
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

        // The audio init applies the advanced sync points, but then triggers Vue
        // watchers (audio.simpleSync -> simpleSyncSecond) that overwrite them
        // with a single simple sync point shortly after load. Wait for the
        // watchers to settle, then verify the advanced sync points are still there.
        await page.waitForTimeout(2000);

        const syncPoints = await page.evaluate(() => {
            const api = window.api;
            return api.score.exportFlatSyncPoints();
        });

        // Bar 28 must keep its sync point at 70000 ms (1'10), as set in the fixture
        expect(syncPoints).toContainEqual(
            expect.objectContaining({ barIndex: 28, millisecondOffset: 70000 }),
        );
    });
});
