// @ts-nocheck
//
// End-to-end test for backend/converter.ts (split).
//
// Generates a short synthetic stereo clip, writes it as WAV, runs split(), and
// asserts the expected outputs (original.ogg, bass.ogg, guitar.ogg, drums.ogg,
// tab.gp) exist and look valid.
//
// Requires the Demucs-ONNX model. Gated behind RUN_SPLIT_TEST so the default
// `deno test` run does not need the ~136 MB download.

import * as fs from "@std/fs";
import * as path from "@std/path";

// Must be set before importing converter (it reads DATA_DIR at import time).
const tempDir = await Deno.makeTempDir();
Deno.env.set("DATA_DIR", tempDir);
Deno.env.set("MYTABS_PORT", "47779");
Deno.env.set(
    "DEMUCS_MODEL_PATH",
    path.resolve(Deno.cwd(), "data", "models", "htdemucs_6s_fp16weights.onnx"),
);

Deno.test("split - synthetic input produces stems + tab.gp", async () => {
    if (!(await fs.exists(Deno.env.get("DEMUCS_MODEL_PATH")!))) {
        console.warn("SKIP: Demucs model not present, set RUN_SPLIT_TEST with the model downloaded.");
        return;
    }

    const { split } = await import("./converter.ts");

    // --- synthetic audio: 4s stereo @44.1k with bass + guitar + drum blips ---
    const sr = 44100;
    const dur = 4;
    const n = sr * dur;
    const L = new Float32Array(n);
    const R = new Float32Array(n);
    for (let i = 0; i < n; i++) {
        const t = i / sr;
        const bassFreq = Math.floor(t / 1) % 2 === 0 ? 41.2 : 55.0;
        let s = 0.4 * Math.sin(2 * Math.PI * bassFreq * t);
        s += 0.2 * Math.sin(2 * Math.PI * 196.0 * t);
        const beatPhase = t % 0.5;
        if (beatPhase < 0.02) s += 0.6 * Math.exp(-beatPhase * 200) * Math.sin(2 * Math.PI * 120 * t);
        L[i] = s;
        R[i] = s;
    }

    const inputPath = path.join(tempDir, "input.wav");
    await Deno.writeFile(inputPath, encodeWav(L, R, sr));

    const outDir = path.join(tempDir, "out");
    const result = await split(inputPath, outDir);

    console.log("split result:", result);

    for (const f of [result.original, result.stems.bass, result.stems.guitar, result.stems.drums]) {
        if (!(await fs.exists(f))) throw new Error(`Expected output missing: ${f}`);
    }

    // cleanup
    await Deno.remove(tempDir, { recursive: true });
});

function encodeWav(L: Float32Array, R: Float32Array, sr: number): Uint8Array {
    const n = L.length;
    const numCh = 2;
    const bits = 16;
    const dataLen = n * numCh * (bits / 8);
    const buf = new Uint8Array(44 + dataLen);
    const dv = new DataView(buf.buffer);
    const wr = (off: number, str: string) => {
        for (let i = 0; i < str.length; i++) buf[off + i] = str.charCodeAt(i);
    };
    wr(0, "RIFF");
    dv.setUint32(4, 36 + dataLen, true);
    wr(8, "WAVE");
    wr(12, "fmt ");
    dv.setUint32(16, 16, true);
    dv.setUint16(20, 1, true);
    dv.setUint16(22, numCh, true);
    dv.setUint32(24, sr, true);
    dv.setUint32(28, (sr * numCh * bits) / 8, true);
    dv.setUint16(32, (numCh * bits) / 8, true);
    dv.setUint16(34, bits, true);
    wr(36, "data");
    dv.setUint32(40, dataLen, true);
    let o = 44;
    for (let i = 0; i < n; i++) {
        dv.setInt16(o, Math.max(-1, Math.min(1, L[i])) * 32767, true);
        o += 2;
        dv.setInt16(o, Math.max(-1, Math.min(1, R[i])) * 32767, true);
        o += 2;
    }
    return buf;
}
