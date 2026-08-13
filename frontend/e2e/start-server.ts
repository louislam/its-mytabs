// Starts the its-mytabs backend (demo mode) for the Playwright E2E tests.
// Run from the project root. The frontend must already be built (dist/).

import { createOggEncoder } from "wasm-media-encoders";

Deno.env.set("MYTABS_DEMO_MODE", "true");
Deno.env.set("MYTABS_LAUNCH_BROWSER", "false");
Deno.env.set("MYTABS_PORT", Deno.env.get("MYTABS_E2E_PORT") ?? "47779");

// Fresh data directory for every test run so the demo tab is re-created.
const e2eDataDir = await Deno.makeTempDir({ prefix: "its-mytabs-e2e-" });
Deno.env.set("DATA_DIR", e2eDataDir);
console.log("[e2e] DATA_DIR:", e2eDataDir);

// Import backend modules AFTER env vars are set (they read env at module load).
const { main } = await import("../../backend/main.ts");
const { getTab, addAudio, createTab, addYoutube, getConfigJSON, updateConfigJSON } = await import("../../backend/tab.ts");

await main();

// The demo tab is created when the database is initialized, wait until it exists.
let tab = null;
for (let i = 0; i < 100; i++) {
    tab = await getTab("1").catch(() => null);
    if (tab) {
        break;
    }
    await new Promise((r) => setTimeout(r, 200));
}
if (!tab) {
    throw new Error("[e2e] Demo tab not found");
}

// Generate long "silence" OGG files and add them to the demo tab so the tests
// can switch between audio sources (including audio -> audio). They must be
// long enough to cover the whole score (bar positions map to seconds via the
// tempo), otherwise seeking fails. A faint low tone is used instead of pure
// digital silence because the wasm encoder produces an unseekable file from
// all-zero samples, which would break the seek/position tests. The audio list
// is built by scanning the tab folder, so writing the files is enough to make
// them appear in the app.
function makeTone(seconds: number, freq: number): Float32Array {
    const n = 44100 * seconds;
    const data = new Float32Array(n);
    for (let i = 0; i < n; i++) {
        data[i] = Math.sin((2 * Math.PI * freq * i) / 44100) * 0.001;
    }
    return data;
}

async function encodeOgg(samples: Float32Array): Promise<Uint8Array> {
    const encoder = await createOggEncoder();
    encoder.configure({ sampleRate: 44100, channels: 1, vbrQuality: 8 });
    const chunks: Uint8Array[] = [];
    const encoded = encoder.encode([samples]);
    if (encoded.length > 0) {
        chunks.push(new Uint8Array(encoded));
    }
    const finalChunk = encoder.finalize();
    if (finalChunk.length > 0) {
        chunks.push(new Uint8Array(finalChunk));
    }
    const totalLength = chunks.reduce((sum, c) => sum + c.length, 0);
    const ogg = new Uint8Array(totalLength);
    let offset = 0;
    for (const c of chunks) {
        ogg.set(c, offset);
        offset += c.length;
    }
    return ogg;
}

await addAudio(tab, await encodeOgg(makeTone(120, 55)), "e2e-silence.ogg");
await addAudio(tab, await encodeOgg(makeTone(120, 110)), "e2e-silence-2.ogg");

// Store the sync metadata so the app applies advanced sync points,
// mirroring the repro steps of issue #85 (bar 28 should be at 70000 ms).
// addAudio only writes the file, so scan the directory to get the merged
// audio list first (getConfigJSON without excludeAudio), then persist the
// metadata into config.json via updateConfigJSON.
const configWithAudio = await getConfigJSON("1");
const audioMeta = configWithAudio?.audio.find((a) => a.filename === "e2e-silence.ogg");
if (!audioMeta) {
    throw new Error("[e2e] e2e-silence.ogg metadata not found");
}
const advancedSyncMeta = {
    ...audioMeta,
    syncMethod: "advanced" as const,
    simpleSync: 0,
    advancedSync: "\\sync 0 0 0\n\\sync 28 0 70000\n\\sync 93 0 272000",
};
await updateConfigJSON("1", async (config) => {
    // e2e-silence.ogg uses the advanced sync points (issue #85 repro); the
    // second audio file keeps a clean simple sync for the seek/cursor tests.
    config.audio = config.audio.map((a) => a.filename === "e2e-silence.ogg" ? { ...advancedSyncMeta } : a.filename === "e2e-silence-2.ogg" ? { ...a, syncMethod: "simple", simpleSync: 0 } : a);
    // addAudio only writes the files; the stored config may not list them yet
    if (!config.audio.some((a) => a.filename === "e2e-silence.ogg")) {
        config.audio.push({ ...advancedSyncMeta });
    }
    const audioMeta2 = configWithAudio?.audio.find((a) => a.filename === "e2e-silence-2.ogg");
    if (audioMeta2 && !config.audio.some((a) => a.filename === "e2e-silence-2.ogg")) {
        config.audio.push({ ...audioMeta2, syncMethod: "simple", simpleSync: 0 });
    }
});
console.log("[e2e] Added e2e-silence.ogg and e2e-silence-2.ogg to demo tab");

// A reliably embeddable YouTube video for the youtube e2e tests. The demo tab's
// original video (VuKSlOT__9s) is not embeddable and silently fails to cue, so
// it cannot be used to exercise playback.
await addYoutube("1", "M7lc1UVf-VE");
console.log("[e2e] Added youtube fixture video M7lc1UVf-VE to demo tab");

// Backing-track fixture tab: a GP7 with an embedded OGG backing track.
// Used to test the "Embedded Backing Track" audio source. Make it public so
// the unauthenticated e2e tests can open it.
const backingTabId = await createTab(
    await Deno.readFile("./extra/backing-track-tab.gp"),
    "gp",
    "Backing Track Test",
    "e2e",
    "backing-track-tab.gp",
);
await updateConfigJSON(backingTabId, async (config) => {
    config.tab.public = true;
});
console.log("[e2e] Created backing-track fixture tab", backingTabId);
