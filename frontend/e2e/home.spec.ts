import { expect, test } from "./fixtures.ts";
import type { Page } from "./fixtures.ts";
import { login, TAB_ID, waitForDemoTab } from "./helpers.ts";

const DEMO_TAB_TITLE = "Hare no Hi ni (Bass Only)";
const BACKING_TRACK_TITLE = "Backing Track Test";

interface MockTab {
    id: string;
    title: string;
    artist: string;
    fav?: boolean;
    lastAccessAt?: string | null;
}

/**
 * Intercept /api/tabs and respond with a controlled tab list, so column
 * visibility (recent / fav) can be asserted deterministically regardless of
 * what other e2e tests did to the shared server state.
 */
async function mockTabs(page: Page, tabs: MockTab[]): Promise<void> {
    await page.route("**/api/tabs", (route) => {
        route.fulfill({
            contentType: "application/json",
            body: JSON.stringify({ ok: true, tabs }),
        });
    });
}

test.describe("home page columns", () => {
    test("handles a tabs API error without crashing", async ({ page, request }) => {
        test.info().annotations.push({ type: "expect-errors" });
        await waitForDemoTab(request);
        await login(page);

        // Simulate the server returning an error body without a `tabs` array
        // (e.g. an expired session). The page must not throw on the
        // computed properties that call tabList.filter().
        await page.route("**/api/tabs", (route) => {
            route.fulfill({
                contentType: "application/json",
                body: JSON.stringify({ ok: false, msg: "Not logged in" }),
            });
        });

        await page.goto("/");
        await expect(page.locator(".home-col-tablist")).toBeVisible();
        await expect(page.locator(".tab-item")).toHaveCount(0);
    });

    test("tab list shows all tabs and search filters them", async ({ page, request }) => {
        await waitForDemoTab(request);
        await login(page);
        await page.goto("/");

        // The tab list column contains every tab
        const tabList = page.locator(".home-col-tablist");
        await expect(tabList.locator(".tab-item", { hasText: DEMO_TAB_TITLE })).toBeVisible();
        await expect(tabList.locator(".tab-item", { hasText: BACKING_TRACK_TITLE })).toBeVisible();

        // Search filters the list
        await page.getByLabel("Search tabs").fill("Hare");
        await expect(tabList.locator(".tab-item", { hasText: DEMO_TAB_TITLE })).toBeVisible();
        await expect(tabList.locator(".tab-item", { hasText: BACKING_TRACK_TITLE })).toHaveCount(0);
    });

    test("empty recent and empty fav -> columns show an empty message", async ({ page, request }) => {
        await waitForDemoTab(request);
        await login(page);
        await mockTabs(page, [
            { id: "1", title: DEMO_TAB_TITLE, artist: "Reira Ushio", fav: false, lastAccessAt: null },
            { id: "2", title: BACKING_TRACK_TITLE, artist: "e2e", fav: false, lastAccessAt: null },
        ]);
        await page.goto("/");

        await expect(page.locator(".home-col-tablist")).toBeVisible();
        await expect(page.locator(".box.box-left")).toHaveText(/No Recent Tabs/);
        await expect(page.locator(".box.box-right")).toHaveText(/No Favorite Tabs/);
    });

    test("recent tabs only -> fav column shows an empty message", async ({ page, request }) => {
        await waitForDemoTab(request);
        await login(page);
        await mockTabs(page, [
            { id: "1", title: DEMO_TAB_TITLE, artist: "Reira Ushio", fav: false, lastAccessAt: "2026-08-01T00:00:00Z" },
            { id: "2", title: BACKING_TRACK_TITLE, artist: "e2e", fav: false, lastAccessAt: null },
        ]);
        await page.goto("/");

        await expect(page.locator(".home-col-tablist")).toBeVisible();
        const recent = page.locator(".box.box-left");
        await expect(recent).toBeVisible();
        await expect(recent.locator(".tab-item", { hasText: DEMO_TAB_TITLE })).toBeVisible();
        await expect(page.locator(".box.box-right")).toHaveText(/No Favorite Tabs/);
    });

    test("fav tabs only -> recent column shows an empty message", async ({ page, request }) => {
        await waitForDemoTab(request);
        await login(page);
        await mockTabs(page, [
            { id: "1", title: DEMO_TAB_TITLE, artist: "Reira Ushio", fav: true, lastAccessAt: null },
            { id: "2", title: BACKING_TRACK_TITLE, artist: "e2e", fav: false, lastAccessAt: null },
        ]);
        await page.goto("/");

        await expect(page.locator(".home-col-tablist")).toBeVisible();
        const fav = page.locator(".box.box-right");
        await expect(fav).toBeVisible();
        await expect(fav.locator(".tab-item", { hasText: DEMO_TAB_TITLE })).toBeVisible();
        await expect(page.locator(".box.box-left")).toHaveText(/No Recent Tabs/);
    });

    test("recent and fav both populated -> all three columns shown", async ({ page, request }) => {
        await waitForDemoTab(request);
        await login(page);
        await mockTabs(page, [
            { id: "1", title: DEMO_TAB_TITLE, artist: "Reira Ushio", fav: true, lastAccessAt: "2026-08-01T00:00:00Z" },
            { id: "2", title: BACKING_TRACK_TITLE, artist: "e2e", fav: false, lastAccessAt: "2026-08-02T00:00:00Z" },
        ]);
        await page.goto("/");

        await expect(page.locator(".home-col-tablist")).toBeVisible();
        const recent = page.locator(".box.box-left");
        await expect(recent).toBeVisible();
        await expect(recent.locator(".tab-item", { hasText: BACKING_TRACK_TITLE })).toBeVisible();
        const fav = page.locator(".box.box-right");
        await expect(fav).toBeVisible();
        await expect(fav.locator(".tab-item", { hasText: DEMO_TAB_TITLE })).toBeVisible();
    });

    test("recent tabs are ordered most-recently-opened first", async ({ page, request }) => {
        await waitForDemoTab(request);
        await login(page);
        await mockTabs(page, [
            { id: "1", title: "Older", artist: "A", fav: false, lastAccessAt: "2026-08-01T00:00:00Z" },
            { id: "2", title: "Newer", artist: "A", fav: false, lastAccessAt: "2026-08-05T00:00:00Z" },
        ]);
        await page.goto("/");

        const titles = page.locator(".box.box-left .tab-item .title");
        await expect(titles).toHaveText(["Newer", "Older"]);
    });

    test("Total Tabs count includes favorited tabs", async ({ page, request }) => {
        await waitForDemoTab(request);
        await login(page);
        await mockTabs(page, [
            { id: "1", title: DEMO_TAB_TITLE, artist: "Reira Ushio", fav: true, lastAccessAt: null },
            { id: "2", title: BACKING_TRACK_TITLE, artist: "e2e", fav: false, lastAccessAt: null },
        ]);
        await page.goto("/");

        // The total count reflects every tab (fav + non-fav), not just the
        // non-fav list shown in the tab list column.
        await expect(page.locator("text=Total Tabs: 2")).toBeVisible();
    });

    test("opening a tab adds it to the recent column", async ({ page, request }) => {
        await waitForDemoTab(request);
        await login(page);
        await page.goto("/");

        // Open the demo tab (records last access), then go back home
        await page.goto(`/tab/${TAB_ID}`);
        await page.goto("/");

        const recent = page.locator(".box.box-left");
        await expect(recent).toBeVisible();
        await expect(recent.locator(".tab-item", { hasText: DEMO_TAB_TITLE })).toBeVisible();
    });

    test("favoriting a tab adds it to the fav column", async ({ page, request }) => {
        await waitForDemoTab(request);
        await login(page);

        // Reset state first: make sure the demo tab is not favorited
        await page.request.post(`/api/tab/${TAB_ID}/fav`, { data: { fav: false } });
        await page.goto("/");

        // Click the star on the demo tab
        const tabList = page.locator(".home-col-tablist");
        const demoItem = tabList.locator(".tab-item", { hasText: DEMO_TAB_TITLE });
        await demoItem.locator(".fav-btn").click();

        // The tab now appears in the fav column too (it stays in the main list)
        const fav = page.locator(".box.box-right");
        await expect(fav).toBeVisible();
        await expect(fav.locator(".tab-item", { hasText: DEMO_TAB_TITLE })).toBeVisible();
        await expect(demoItem).toBeVisible();
    });
});
