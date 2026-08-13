import { expect, test } from "@playwright/test";
import { createHash } from "node:crypto";
import { AUDIO_FILENAME, openTab, playbackRange, selectBars, TAB_ID, waitForAudioReady, waitForDemoTab } from "./helpers.ts";

test.describe("audio source switching", () => {
    test("audio files are served with HTTP range support (seekable)", async ({ request }) => {
        await waitForDemoTab(request);

        const res = await request.get(`/api/tab/${TAB_ID}/audio/${AUDIO_FILENAME}`, {
            headers: { "Range": "bytes=0-99" },
        });
        expect(res.status()).toBe(206);
        const headers = res.headers();
        expect(headers["accept-ranges"]).toBe("bytes");
        expect(headers["content-range"]).toMatch(/^bytes 0-99\//);
        expect((await res.body()).length).toBe(100);

        // An unsatisfiable range must return 416
        const bad = await request.get(`/api/tab/${TAB_ID}/audio/${AUDIO_FILENAME}`, {
            headers: { "Range": "bytes=999999999-" },
        });
        expect(bad.status()).toBe(416);
    });

    test("range requests reassemble the audio file correctly", async ({ request }) => {
        await waitForDemoTab(request);
        const url = `/api/tab/${TAB_ID}/audio/${AUDIO_FILENAME}`;

        // Reference: the full file
        const full = await (await request.get(url)).body();
        const size = full.length;
        expect(size).toBeGreaterThan(0);

        // Fetch it in 50 parts and glue them back together
        const PARTS = 50;
        const partSize = Math.ceil(size / PARTS);
        const chunks: Buffer[] = [];
        for (let i = 0; i < PARTS; i++) {
            const start = i * partSize;
            if (start >= size) {
                break;
            }
            const end = Math.min(start + partSize - 1, size - 1);
            const res = await request.get(url, { headers: { "Range": `bytes=${start}-${end}` } });
            expect(res.status()).toBe(206);
            expect(res.headers()["content-range"]).toBe(`bytes ${start}-${end}/${size}`);
            expect(res.headers()["content-length"]).toBe(String(end - start + 1));
            chunks.push(await res.body());
        }

        const rebuilt = Buffer.concat(chunks);
        expect(rebuilt.length).toBe(size);

        // Checksum the rebuilt file against the original to prove no part was
        // lost, duplicated, or corrupted.
        const checksum = (buf: Buffer) => createHash("sha256").update(buf).digest("hex");
        expect(checksum(rebuilt)).toBe(checksum(full));
    });

    test("switches to an audio file and back", async ({ page, request }) => {
        await waitForDemoTab(request);
        await openTab(page, "synth");

        // The audio element is set up with the file once it becomes the source
        await page.click(".audio-selector .button");
        await page.locator(".audio-list .audio.item", { hasText: AUDIO_FILENAME }).click();
        await expect
            .poll(() => page.evaluate(() => document.querySelector("audio")?.getAttribute("src") ?? ""))
            .toContain(AUDIO_FILENAME);

        // External media player mode is engaged (PlayerMode.EnabledExternalMedia = 4)
        await expect
            .poll(() => page.evaluate(() => window.api.settings.player.playerMode))
            .toBe(4);

        // The item is marked active
        await page.click(".audio-selector .button");
        await expect(page.locator(".audio-list .audio.item", { hasText: AUDIO_FILENAME })).toHaveClass(/active/);

        // Back to synth (PlayerMode.EnabledSynthesizer = 2)
        await page.locator(".audio-list .audio.item", { hasText: "Synth" }).click();
        await expect
            .poll(() => page.evaluate(() => window.api.settings.player.playerMode))
            .toBe(2);
    });

    test("no audio source mutes the player and synth restores volume", async ({ page, request }) => {
        await waitForDemoTab(request);
        await openTab(page, "synth");

        await page.click(".audio-selector .button");
        await page.locator(".audio-list .audio.item", { hasText: "No Audio" }).click();
        await expect.poll(() => page.evaluate(() => window.api.player.masterVolume)).toBe(0);

        await page.click(".audio-selector .button");
        await page.locator(".audio-list .audio.item", { hasText: "Synth" }).click();
        await expect.poll(() => page.evaluate(() => window.api.player.masterVolume)).toBe(1);
    });

    test("plays an audio file source", async ({ page, request }) => {
        await waitForDemoTab(request);
        await openTab(page, `audio-${AUDIO_FILENAME}`);
        await waitForAudioReady(page);

        await page.getByRole("button", { name: "Play" }).click();
        await expect
            .poll(() =>
                page.evaluate(() => {
                    const audio = document.querySelector("audio");
                    return audio ? !audio.paused : false;
                })
            )
            .toBe(true);
        await page.getByRole("button", { name: "Pause" }).click();
        await expect
            .poll(() => page.evaluate(() => document.querySelector("audio")?.paused ?? true))
            .toBe(true);
    });

    test("cursor stays at the highlighted range start after switching to audio", async ({ page, request }) => {
        await waitForDemoTab(request);
        await openTab(page, "synth");

        const range = await selectBars(page, 5, 6);

        await page.click(".audio-selector .button");
        await page.locator(".audio-list .audio.item", { hasText: AUDIO_FILENAME }).click();

        // The range is preserved and the cursor sits at its start, not bar 0
        await expect
            .poll(() => page.evaluate(() => window.api.tickPosition ?? 0))
            .toBeGreaterThanOrEqual(range.startTick);
        await expect
            .poll(() => page.evaluate(() => window.api.tickPosition ?? 0))
            .toBeLessThan(range.startTick + 100);
        expect(await playbackRange(page)).toEqual(range);
    });

    test("backing track item reflects whether the score has one", async ({ page, request }) => {
        await waitForDemoTab(request);
        await openTab(page, "synth");

        const hasBackingTrack = await page.evaluate(() => !!window.api.score.backingTrack);
        await page.click(".audio-selector .button");

        const item = page.locator(".audio-list .audio.item", { hasText: "Embedded Backing Track" });

        if (hasBackingTrack) {
            await expect(item).toBeVisible();
            await item.click();
            await expect(page.locator(".audio-list .audio.item", { hasText: "Embedded Backing Track" })).toHaveClass(
                /active/,
            );
        } else {
            await expect(item).toHaveCount(0);
        }
    });
});
