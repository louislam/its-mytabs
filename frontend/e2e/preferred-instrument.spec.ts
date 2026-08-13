import { expect, test } from "@playwright/test";
import { openTab, waitForDemoTab } from "./helpers.ts";

async function savedTrackID(page): Promise<string | null> {
    return page.evaluate(() => localStorage.getItem("tab-1-trackID"));
}

async function preferredTrackIndex(page, min: number, max: number): Promise<number> {
    return page.evaluate(
        ({ min, max }) => {
            const tracks = (window as any).api.score.tracks;
            return tracks.findIndex((t) => t.playbackInfo.program >= min && t.playbackInfo.program <= max);
        },
        { min, max },
    );
}

test.describe("preferred instrument", () => {
    test.beforeEach(async ({ request }) => {
        await waitForDemoTab(request);
    });

    test("bass preference selects the first bass track when nothing is saved", async ({ page }) => {
        await page.addInitScript(() => {
            localStorage.setItem("userSetting", JSON.stringify({ preferredInstrument: "bass" }));
        });
        await openTab(page, "synth");

        const bassIndex = await preferredTrackIndex(page, 32, 39);
        expect(bassIndex).toBeGreaterThan(-1);
        expect(await savedTrackID(page)).toBe(String(bassIndex));
        expect((await page.locator(".track-selector .button").innerText()).trim()).toContain("Bass");
    });

    test("guitar preference selects the first guitar track when nothing is saved", async ({ page }) => {
        await page.addInitScript(() => {
            localStorage.setItem("userSetting", JSON.stringify({ preferredInstrument: "guitar" }));
        });
        await openTab(page, "synth");

        const guitarIndex = await preferredTrackIndex(page, 24, 31);
        expect(guitarIndex).toBeGreaterThan(-1);
        expect(await savedTrackID(page)).toBe(String(guitarIndex));
        expect((await page.locator(".track-selector .button").innerText()).trim()).toContain("Guitar");
    });

    test("a saved track is respected even with a bass preference", async ({ page }) => {
        await page.addInitScript(() => {
            localStorage.setItem("userSetting", JSON.stringify({ preferredInstrument: "bass" }));
            localStorage.setItem("tab-1-trackID", "0");
        });
        await openTab(page, "synth");

        expect(await savedTrackID(page)).toBe("0");
        expect((await page.locator(".track-selector .button").innerText()).trim()).toContain("Guitar");
    });

    test("default (none) keeps the first track", async ({ page }) => {
        await openTab(page, "synth");

        expect(await savedTrackID(page)).toBe("0");
        expect((await page.locator(".track-selector .button").innerText()).trim()).toContain("Guitar");
    });
});
