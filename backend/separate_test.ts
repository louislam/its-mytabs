// Tests for backend/separate.ts: the worker-based separation orchestration.
//
// Covers:
//   - guard: refuses to start when the model/runtime are missing
//   - worker spawn: a job goes busy, a second job is refused, and a worker
//     failure lands in the job and clears the busy lock
//   - full success path (skipped unless the model + ONNX Runtime are present
//     in ./data, mirroring container_test.ts): a real job reaches "done" and
//     writes bass/drums/guitar stems

import { assertEquals, assertExists, assertThrows } from "jsr:@std/assert@^1.0.17";
import * as fs from "@std/fs";
import * as path from "@std/path";

// Must be set before importing separate.ts (it reads DATA_DIR at import time).
const tempDir = await Deno.makeTempDir();
Deno.env.set("DATA_DIR", tempDir);
Deno.env.set("MYTABS_PORT", "47778");

const { startSeparate, isSeparateBusy, getSeparateJob } = await import("./separate.ts");

const modelPath = path.join(tempDir, "htdemucs_6s_fp16weights.onnx");
const ortIndex = path.join(tempDir, "onnxruntime-node", "node_modules", "onnxruntime-node", "dist", "index.js");

async function fakeInstalled(): Promise<void> {
    await fs.ensureFile(modelPath);
    await fs.ensureFile(ortIndex);
}

/** Poll until the job leaves the busy state (done/error), then return it. */
async function waitForJobSettle(timeoutMs = 20_000): Promise<ReturnType<typeof getSeparateJob>> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        const job = getSeparateJob();
        if (job && (job.phase === "done" || job.phase === "error")) {
            return job;
        }
        await new Promise((r) => setTimeout(r, 100));
    }
    return getSeparateJob();
}

Deno.test("separate - refuses to start when the model/runtime is missing", () => {
    assertEquals(isSeparateBusy(), false);
    assertEquals(getSeparateJob(), null);

    assertThrows(
        () => startSeparate("1", "song.wav", path.join(tempDir, "song.wav"), false),
        Error,
        "AI model / runtime is not downloaded yet",
    );

    // The failed start must not leave a job behind.
    assertEquals(isSeparateBusy(), false);
    assertEquals(getSeparateJob(), null);
});

Deno.test("separate - spawns a worker; busy lock held and worker errors are surfaced", async () => {
    // Pretend the model + runtime are installed so the guard passes and a real
    // worker thread is spawned. The source file does not exist, so the worker
    // fails at decode time and posts an "error" message.
    await fakeInstalled();

    const sourcePath = path.join(tempDir, "song.wav");
    startSeparate("1", "song.wav", sourcePath, false);

    // A job is immediately active and refuses a concurrent one.
    assertEquals(isSeparateBusy(), true);
    assertThrows(
        () => startSeparate("1", "song.wav", sourcePath, false),
        Error,
        "already in progress",
    );

    // The worker failure must land in the job and release the busy lock.
    const job = await waitForJobSettle();
    assertExists(job);
    assertEquals(job.phase, "error");
    assertEquals(isSeparateBusy(), false);
    assertExists(job.error);
});

Deno.test("separate - full worker job completes and writes stems", async () => {
    // Only run when the repo data dir actually has the model + runtime
    // (mirrors container_test.ts / the e2e start-server helper).
    const repoModel = "./data/htdemucs_6s_fp16weights.onnx";
    const repoOrt = "./data/onnxruntime-node";
    if (!(await fs.exists(repoModel)) || !(await fs.exists(path.join(repoOrt, "node_modules", "onnxruntime-node", "dist", "index.js")))) {
        console.warn("SKIP: Demucs model / ONNX Runtime not present in ./data");
        return;
    }
    await Deno.copyFile(repoModel, modelPath);
    await fs.copy(repoOrt, path.join(tempDir, "onnxruntime-node"), { overwrite: true });

    // Synthetic stereo clip: 2s @44.1k with alternating bass + guitar tones.
    const sr = 44100;
    const dur = 2;
    const n = sr * dur;
    const L = new Float32Array(n);
    const R = new Float32Array(n);
    for (let i = 0; i < n; i++) {
        const t = i / sr;
        const s = 0.4 * Math.sin(2 * Math.PI * 110 * t) + 0.2 * Math.sin(2 * Math.PI * 220 * t);
        L[i] = s;
        R[i] = s;
    }
    const sourcePath = path.join(tempDir, "song.wav");
    await Deno.writeFile(sourcePath, encodeWav(L, R, sr));

    startSeparate("1", "song.wav", sourcePath, false);

    const job = await waitForJobSettle(180_000);
    assertExists(job);
    assertEquals(job.phase, "done", `job failed: ${job.error ?? "no error"}`);
    assertEquals(isSeparateBusy(), false);

    // Every stem (bass/drums/guitar) has a written output file.
    assertExists(job.result);
    for (const stem of ["bass", "drums", "guitar"]) {
        const outPath: string = job.result[stem];
        assertExists(outPath, `missing ${stem} output`);
        assertEquals(await fs.exists(outPath), true);
        assertEquals(path.basename(outPath), `song_${stem}.ogg`);
    }
});

function encodeWav(L: Float32Array, R: Float32Array, sr: number): Uint8Array {
    const n = L.length;
    const numCh = 2;
    const bits = 16;
    const dataLen = n * numCh * (bits / 8);
    const buf = new Uint8Array(44 + dataLen);
    const dv = new DataView(buf.buffer);
    const wr = (off: number, str: string) => {
        for (let i = 0; i < str.length; i++) {
            buf[off + i] = str.charCodeAt(i);
        }
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
