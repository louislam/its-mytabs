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
const { getTab, addAudio, getConfigJSON, updateConfigJSON } = await import("../../backend/tab.ts");

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

// Generate a short silence OGG and add it to the demo tab so the tests can
// switch between audio sources. The audio list is built by scanning the tab
// folder, so writing the file is enough to make it appear in the app.
const silence = new Float32Array(44100 * 5); // 5 seconds of silence @ 44.1kHz
const encoder = await createOggEncoder();
encoder.configure({ sampleRate: 44100, channels: 1, vbrQuality: 8 });
const chunks: Uint8Array[] = [];
const encoded = encoder.encode([silence]);
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
await addAudio(tab, ogg, "e2e-silence.ogg");

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
    const index = config.audio.findIndex((a) => a.filename === "e2e-silence.ogg");
    if (index >= 0) {
        config.audio[index] = advancedSyncMeta;
    } else {
        config.audio.push(advancedSyncMeta);
    }
});
console.log("[e2e] Added e2e-silence.ogg to demo tab");
