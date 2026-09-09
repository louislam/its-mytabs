import { expect, test } from "./fixtures.ts";
import { openTab, waitForDemoTab } from "./helpers.ts";

async function useScoreStyle(page, scoreStyle: string) {
    await page.addInitScript((style) => {
        localStorage.setItem("userSetting", JSON.stringify({ scoreStyle: style }));
    }, scoreStyle);
}

/**
 * alphaTab splits the rendered sheet into partials and, with lazy loading on,
 * only fills the ones it thinks are on screen. An empty partial is a blank gap
 * in the tab, so every partial must carry rendered content.
 */
async function emptyPartialCount(page): Promise<number> {
    return page.evaluate(() => {
        const surface = document.querySelector(".at-surface");
        return [...surface.children].filter((child) => child.innerHTML.length === 0).length;
    });
}

async function partialCount(page): Promise<number> {
    return page.evaluate(() => document.querySelector(".at-surface").children.length);
}

test.describe("horizontal layout", () => {
    test.beforeEach(async ({ request }) => {
        await waitForDemoTab(request);
    });

    test("renders every partial, so the tab is not cut off at the end", async ({ page }) => {
        await useScoreStyle(page, "horizontal-tab");
        await openTab(page, "synth");

        expect(await partialCount(page)).toBeGreaterThan(1);
        await expect.poll(() => emptyPartialCount(page)).toBe(0);
        expect(await page.evaluate(() => window.api.settings.core.enableLazyLoading)).toBe(false);
    });

    test("the whole sheet stays rendered after scrolling to the end", async ({ page }) => {
        await useScoreStyle(page, "horizontal-tab");
        await openTab(page, "synth");

        await page.evaluate(() => window.scrollTo(document.documentElement.scrollWidth, 0));
        await expect.poll(() => emptyPartialCount(page)).toBe(0);
    });

    test("page layout keeps alphaTab's default lazy loading", async ({ page }) => {
        await useScoreStyle(page, "tab");
        await openTab(page, "synth");

        expect(await page.evaluate(() => window.api.settings.core.enableLazyLoading)).toBe(true);
    });
});
