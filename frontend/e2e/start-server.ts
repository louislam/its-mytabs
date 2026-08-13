// Starts the its-mytabs backend for the Playwright E2E tests.
// Run from the project root. The frontend must already be built (dist/).
//
// The server runs WITHOUT demo mode so the real setup flow is exercised:
// an admin account is created via the /register endpoint and the specs log
// in through the UI. Editing APIs (e.g. separating audio) require login.

import * as path from "@std/path";
import * as fs from "@std/fs";
import { createOggEncoder } from "wasm-media-encoders";
import { ADMIN_EMAIL, ADMIN_PASSWORD, AUDIO_FILENAME, AUDIO_FILENAME2, STEM_EXAMPLE_FILENAME } from "./helpers.ts";

Deno.env.set("MYTABS_LAUNCH_BROWSER", "false");
Deno.env.set("MYTABS_PORT", Deno.env.get("MYTABS_E2E_PORT") ?? "47779");

// Fresh data directory for every test run so the demo tab is re-created.
const e2eDataDir = await Deno.makeTempDir({ prefix: "its-mytabs-e2e-" });
Deno.env.set("DATA_DIR", e2eDataDir);
console.log("[e2e] DATA_DIR:", e2eDataDir);

// Copy the Demucs model + the downloaded ONNX Runtime into the e2e data dir if
// they exist in the repo data dir, so the separation feature can actually run
// in e2e tests. The completion test is skipped when they are missing (e.g. CI).
const localModelPath = "./data/htdemucs_6s_fp16weights.onnx";
if (await fs.exists(localModelPath)) {
    await Deno.copyFile(localModelPath, path.join(e2eDataDir, "htdemucs_6s_fp16weights.onnx"));
    console.log("[e2e] Copied Demucs model for separation tests");
} else {
    console.warn("[e2e] Demucs model not found, separation completion test will be skipped");
}
const localOrtDir = "./data/onnxruntime-node";
if (await fs.exists(path.join(localOrtDir, "node_modules", "onnxruntime-node", "dist", "index.js"))) {
    await fs.copy(localOrtDir, path.join(e2eDataDir, "onnxruntime-node"), { overwrite: true });
    console.log("[e2e] Copied ONNX Runtime for separation tests");
} else {
    // Download the runtime from npm (keeps the separation completion test working
    // even when the repo data dir has never run a separation).
    console.log("[e2e] ONNX Runtime not found locally, downloading from npm...");
    const { installOrt } = await import("../../backend/onnxruntime.ts");
    await installOrt();
    console.log("[e2e] ONNX Runtime downloaded");
}

// Import backend modules AFTER env vars are set (they read env at module load).
const { main } = await import("../../backend/main.ts");
const { getTab, addAudio, createTab, addYoutube, getConfigJSON, updateConfigJSON } = await import("../../backend/tab.ts");

await main();

const port = Deno.env.get("MYTABS_E2E_PORT") ?? "47779";
const baseURL = `http://127.0.0.1:${port}`;

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

// Create the admin account through the real setup endpoint.
const registerRes = await fetch(`${baseURL}/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "E2E Admin", email: ADMIN_EMAIL, password: ADMIN_PASSWORD }),
});
console.log("[e2e] register:", registerRes.status);
if (!registerRes.ok) {
    throw new Error(`[e2e] Failed to register admin: ${await registerRes.text()}`);
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

await addAudio(tab, await encodeOgg(makeTone(120, 55)), AUDIO_FILENAME);
await addAudio(tab, await encodeOgg(makeTone(120, 110)), AUDIO_FILENAME2);
// A file that looks like a separated stem (name ends in _<stem>.ogg); its
// Separate button must be hidden (see separate.spec.ts).
await addAudio(tab, await encodeOgg(makeTone(120, 165)), STEM_EXAMPLE_FILENAME);

// Store the sync metadata so the app applies advanced sync points,
// mirroring the repro steps of issue #85 (bar 28 should be at 70000 ms).
// addAudio only writes the file, so scan the directory to get the merged
// audio list first (getConfigJSON without excludeAudio), then persist the
// metadata into config.json via updateConfigJSON.
const configWithAudio = await getConfigJSON("1");
const audioMeta = configWithAudio?.audio.find((a) => a.filename === AUDIO_FILENAME);
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
    // Make the fixture tab public so the unauthenticated e2e specs can open it.
    config.tab.public = true;
    // e2e-silence.ogg uses the advanced sync points (issue #85 repro); the
    // second audio file keeps a clean simple sync for the seek/cursor tests.
    config.audio = config.audio.map((a) => a.filename === AUDIO_FILENAME ? { ...advancedSyncMeta } : a.filename === AUDIO_FILENAME2 ? { ...a, syncMethod: "simple", simpleSync: 0 } : a);
    // addAudio only writes the files; the stored config may not list them yet
    if (!config.audio.some((a) => a.filename === AUDIO_FILENAME)) {
        config.audio.push({ ...advancedSyncMeta });
    }
    const audioMeta2 = configWithAudio?.audio.find((a) => a.filename === AUDIO_FILENAME2);
    if (audioMeta2 && !config.audio.some((a) => a.filename === AUDIO_FILENAME2)) {
        config.audio.push({ ...audioMeta2, syncMethod: "simple", simpleSync: 0 });
    }
});
console.log("[e2e] Added audio fixtures to demo tab");

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
