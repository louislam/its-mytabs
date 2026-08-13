import { type APIRequestContext, expect, type Page } from "@playwright/test";

export const TAB_ID = "1";
export const AUDIO_FILENAME = "e2e-silence.ogg";
/** Second non-stem audio file, used to assert buttons are disabled during a job. */
export const AUDIO_FILENAME2 = "e2e-silence-2.ogg";
/** Filename that looks like a separated stem; its Separate button must be hidden. */
export const STEM_EXAMPLE_FILENAME = "e2e-stem-example_guitar.ogg";

/** Admin account created by the e2e server bootstrap via the /register endpoint. */
export const ADMIN_EMAIL = "e2e@its-mytabs.test";
export const ADMIN_PASSWORD = "e2e-admin-password";

/**
 * Log in as the e2e admin account through the real login UI.
 */
export async function login(page: Page): Promise<void> {
    await page.goto("/login");
    await page.fill("#floatingInput", ADMIN_EMAIL);
    await page.fill("#floatingPassword", ADMIN_PASSWORD);
    await page.click('button[type="submit"]');
    await page.waitForURL("/");
    // Wait for the home page fetches to finish so a later goto() does not
    // abort them (aborted fetches surface as console errors on webkit/firefox).
    await expect(page.locator(".home-col-tablist")).toBeVisible();
}

/**
 * Wait until the demo tab is ready and the e2e audio file is registered.
 * The server helper adds the audio file after the backend starts, so it may
 * not be there on the very first request.
 */
export async function waitForDemoTab(request: APIRequestContext): Promise<void> {
    const deadline = Date.now() + 60_000;
    while (Date.now() < deadline) {
        const res = await request.get(`/api/tab/${TAB_ID}`);
        if (res.ok()) {
            const data = await res.json();
            if (data.audioList?.some((a: { filename: string }) => a.filename === AUDIO_FILENAME)) {
                return;
            }
        }
        await new Promise((r) => setTimeout(r, 500));
    }
    throw new Error(`Demo tab with ${AUDIO_FILENAME} not ready`);
}

/**
 * Open a tab and wait until the score is rendered and the player can play
 * back. Pass an `audio` param to force a specific audio source (e.g. `synth`
 * or `audio-e2e-silence.ogg`).
 */
export async function openTab(page: Page, audio?: string, tabId: string = TAB_ID): Promise<void> {
    const query = audio ? `?audio=${audio}` : "";
    await page.goto(`/tab/${tabId}${query}`);
    await page.waitForFunction(() => {
        const api = window.api;
        return (
            api &&
            api.score &&
            api.score.masterBars &&
            api.score.masterBars.length > 0 &&
            api.player?.isReadyForPlayback &&
            api.boundsLookup &&
            api.boundsLookup.isFinished
        );
    });
}

/**
 * Find the id of the backing-track fixture tab created by the e2e server
 * helper (title "Backing Track Test").
 */
export async function findBackingTrackTabId(request: APIRequestContext): Promise<string> {
    for (let id = 2; id <= 20; id++) {
        const res = await request.get(`/api/tab/${id}`);
        if (res.ok()) {
            const data = await res.json();
            if (data.tab?.title === "Backing Track Test") {
                return String(id);
            }
        }
    }
    throw new Error("Backing-track fixture tab not found");
}

export async function tickPosition(page: Page): Promise<number> {
    return page.evaluate(() => window.api?.tickPosition ?? 0);
}

export async function playerState(page: Page): Promise<number> {
    return page.evaluate(() => window.api?.playerState ?? -1);
}

export async function barStartTick(page: Page, bar: number): Promise<number> {
    return page.evaluate((b) => window.api.score.masterBars[b].start, bar);
}

/** Index of the bar containing the current cursor position. */
export async function currentBarIndex(page: Page): Promise<number> {
    return page.evaluate(() => {
        const api = window.api;
        const starts = api.score.masterBars.map((m) => m.start);
        const cur = api.tickPosition ?? 0;
        let idx = 0;
        for (let i = 0; i < starts.length; i++) {
            if (starts[i] <= cur) {
                idx = i;
            } else {
                break;
            }
        }
        return idx;
    });
}

/** Select a full-bar range (first beat of startBar .. last beat of endBar). */
export async function selectBars(page: Page, startBar: number, endBar: number) {
    return page.evaluate(
        ({ startBar, endBar }) => {
            const api = window.api;
            const bars = api.score.tracks[0].staves[0].bars;
            const firstBar = bars[startBar];
            const lastBar = bars[Math.min(endBar, bars.length - 1)];
            const firstBeat = firstBar.voices[0].beats[0];
            const lastBeat = lastBar.voices[0].beats[lastBar.voices[0].beats.length - 1];
            const startTick = firstBeat.absolutePlaybackStart;
            // Match alphaTab's own end-tick convention (duration - 50) so the
            // end snap stays inside the selected bar instead of the next bar.
            const endTick = lastBeat.absolutePlaybackStart + lastBeat.playbackDuration - 50;
            api.playbackRange = { startTick, endTick };
            return { startTick, endTick };
        },
        { startBar, endBar },
    );
}

/** Screen coordinates of a beat (for real mouse events on the score). */
export async function beatPosition(page: Page, bar: number, beat: number) {
    return page.evaluate(
        ({ bar, beat }) => {
            const api = window.api;
            const beats = api.score.tracks[0].staves[0].bars[bar].voices[0].beats;
            const target = beats[Math.min(beat, beats.length - 1)];
            const bounds = api.boundsLookup.findBeat(target);
            const element = (api.canvasElement as unknown as { element: HTMLElement }).element;
            const rect = element.getBoundingClientRect();
            return {
                x: rect.left + bounds.realBounds.x + bounds.realBounds.w / 2,
                y: rect.top + bounds.realBounds.y + bounds.realBounds.h / 2,
            };
        },
        { bar, beat },
    );
}

/** Current playback range, or null. */
export async function playbackRange(page: Page) {
    return page.evaluate(() => {
        const r = window.api?.playbackRange;
        if (!r) {
            return null;
        }
        return { startTick: r.startTick, endTick: r.endTick };
    });
}

/**
 * Wait until the external audio element is actually playable. `playerReady`
 * (and thus `openTab`) resolves before the element finishes loading, and
 * clicking Play on an unloaded element is racy (especially on Firefox).
 * HAVE_FUTURE_DATA (readyState 3) means there is enough data to start playing.
 */
export async function waitForAudioReady(page: Page): Promise<void> {
    await page.waitForFunction(() => {
        const a = document.querySelector("audio");
        return !!a && a.readyState >= 3 && a.duration > 0;
    });
}
