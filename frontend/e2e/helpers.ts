import type { APIRequestContext } from "@playwright/test";

export const TAB_ID = "1";
export const AUDIO_FILENAME = "e2e-silence.ogg";

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
