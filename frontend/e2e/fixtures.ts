import { APIRequestContext, expect, Page, test as base } from "@playwright/test";

// Console errors that are expected and should not fail the test.
const IGNORED_CONSOLE_ERRORS: RegExp[] = [
    // YouTube embed fires errors when the iframe fails to cue the video;
    // the youtube.spec tests assert playback state themselves.
    /youtube|ytplayer|playerError/i,
    // Socket.IO reconnection noise on server restarts.
    /websocket|socket\.io|websocket error/i,
    // Failed media loads are surfaced by the browser, not the app.
    /media element.*(error|fail)|notallowed|networkerror/i,
];

// Uncaught exceptions that are expected and should not fail the test.
const IGNORED_PAGE_ERRORS: RegExp[] = [
    // alphaTab's metronome click stops before starting on rapid play/pause.
    /cannot call stop without calling start first/i,
];

export { expect };
export type { APIRequestContext, Page };

export const test = base.extend({
    page: async ({ page }, use, testInfo) => {
        const errors: string[] = [];
        page.on("pageerror", (error) => {
            const text = error.stack ?? error.message;
            if (IGNORED_PAGE_ERRORS.some((re) => re.test(text))) return;
            errors.push(`Uncaught: ${text}`);
        });
        page.on("console", (msg) => {
            if (msg.type() !== "error") return;
            const text = msg.text();
            if (IGNORED_CONSOLE_ERRORS.some((re) => re.test(text))) return;
            errors.push(`Console error: ${text}`);
        });
        await use(page);
        if (errors.length > 0) {
            throw new Error(`Unexpected browser errors:\n${errors.join("\n")}`);
        }
    },
});
