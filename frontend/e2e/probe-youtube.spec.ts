import { expect, test } from "@playwright/test";
import { waitForDemoTab } from "./helpers.ts";

test("probe youtube console", async ({ page, request }) => {
    await waitForDemoTab(request);
    const logs: string[] = [];
    page.on("console", (m) => logs.push(`[${m.type()}] ${m.text().slice(0, 200)}`));
    page.on("pageerror", (e) => logs.push(`[pageerror] ${String(e).slice(0, 300)}`));

    await page.goto("/tab/1?audio=youtube-VuKSlOT__9s");

    // Poll the app state for up to 60s to see if the youtube player ever becomes ready
    const states: string[] = [];
    for (let i = 0; i < 12; i++) {
        await page.waitForTimeout(5000);
        const s = await page.evaluate(() => {
            const iframe = document.querySelector(".player iframe");
            return {
                playerMode: window.api?.settings?.player?.playerMode,
                hasIframe: !!iframe,
                ytSrc: iframe ? (iframe.getAttribute("src") ?? "").slice(0, 60) : null,
                hasYT: !!((window as unknown as { YT?: unknown }).YT),
                playerState: window.api?.playerState,
            };
        });
        states.push(`${(i + 1) * 5}s ${JSON.stringify(s)}`);
    }
    console.log("STATES:\n" + states.join("\n"));
    console.log("LOGS:\n" + logs.join("\n"));
    expect(true).toBe(true);
});
