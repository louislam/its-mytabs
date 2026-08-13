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
    /cannot call stop without calling start first|start has not been called/i,
    // WebKit reports navigation-aborted fetches as CORS failures.
    /due to access control checks|fetch api cannot load|xmlhttprequest cannot load/i,
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
        page.on("console", async (msg) => {
            if (msg.type() !== "error") return;
            let text = msg.text();
            if (text === "JSHandle@object") {
                const values = await Promise.all(
                    msg.args().map((a) => a.jsonValue().catch(() => null)),
                );
                text = values.map((v) => (typeof v === "string" ? v : JSON.stringify(v))).join(" ");
            }
            const url = msg.location().url;
            if (IGNORED_CONSOLE_ERRORS.some((re) => re.test(text) || re.test(url))) return;
            errors.push(`Console error: ${text} @ ${url}`);
        });
        page.on("requestfailed", (req) => {
            const url = req.url();
            const errorText = req.failure()?.errorText ?? "";
            // Navigation aborts and media blob cancel events are normal.
            if (url.startsWith("blob:")) return;
            if (/cancelled|aborted|NS_BINDING_ABORTED/i.test(errorText)) return;
            if (IGNORED_CONSOLE_ERRORS.some((re) => re.test(url))) return;
            errors.push(`Request failed: ${url} (${errorText})`);
        });
        await use(page);
        // The test may push an "expect-errors" annotation in its body to
        // tolerate intentionally triggered errors (checked at teardown).
        const expectErrors = testInfo.annotations.some((a) => a.type === "expect-errors");
        if (!expectErrors && errors.length > 0) {
            throw new Error(`Unexpected browser errors:\n${errors.join("\n")}`);
        }
    },
});
