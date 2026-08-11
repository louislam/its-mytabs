// Starts the its-mytabs backend for the Playwright E2E tests.
// Run from the project root. The frontend must already be built (dist/).
//
// The server runs WITHOUT demo mode so the real setup flow is exercised:
// an admin account is created via the /register endpoint and the specs log
// in through the UI. Editing APIs (e.g. separating audio) require login.

import * as path from "@std/path";
import * as fs from "@std/fs";
import { createOggEncoder } from "wasm-media-encoders";
import { ADMIN_EMAIL, ADMIN_PASSWORD, AUDIO_FILENAME, SECOND_AUDIO_FILENAME, STEM_EXAMPLE_FILENAME } from "./helpers.ts";

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
const { getTab, addAudio, updateConfigJSON } = await import("../../backend/tab.ts");

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

// Generate a short silence OGG and reuse it for all audio fixtures. The audio
// list is built by scanning the tab folder, so writing the files is enough to
// make them appear in the app.
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
await addAudio(tab, ogg, AUDIO_FILENAME);
await addAudio(tab, ogg, SECOND_AUDIO_FILENAME);
await addAudio(tab, ogg, STEM_EXAMPLE_FILENAME);

// Make the fixture tab public (the existing specs access it without login) and
// store clean sync metadata so the app applies a simple sync (offset 0).
await updateConfigJSON("1", async (config) => {
    config.tab.public = true;
    config.audio = config.audio.map((a) => a.filename === AUDIO_FILENAME ? { ...a, syncMethod: "simple", simpleSync: 0 } : a);
});
console.log("[e2e] Added audio fixtures to demo tab");
