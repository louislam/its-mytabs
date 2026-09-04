import { expect, test } from "./fixtures.ts";
import { findBackingTrackTabId, openTab, waitForDemoTab } from "./helpers.ts";

test.describe("track names", () => {
    test("uses GP long names, falls back for short/no name", async ({ page, request }) => {
        await waitForDemoTab(request);
        const tabId = await findBackingTrackTabId(request);
        await openTab(page, "synth", tabId);

        await page.click(".track-selector .button");
        const names = (
            await page.locator(".track-list .track .name").allTextContents()
        ).map((n) => n.trim());

        expect(names).toHaveLength(3);
        // Track 0: long name from the GP file wins
        expect(names[0]).toBe("Clean Guitar");
        // Track 1: no long name -> falls back to the GP short name
        expect(names[1]).toBe("el.guit.");
        // Track 2: no long or short name -> falls back to the instrument name
        expect(names[2]).toBe("Electric Guitar (clean)");
    });
});
