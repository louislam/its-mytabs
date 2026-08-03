import * as fs from "@std/fs";
import * as path from "@std/path";
import { dataDir, encodeOgg } from "./util.ts";
import { FLACDecoder } from "@wasm-audio-decoders/flac";
import { OggVorbisDecoder } from "@wasm-audio-decoders/ogg-vorbis";
import { MPEGDecoder } from "mpg123-decoder";
import WavDecoder from "wav-decoder";
import waveResampler from "wave-resampler";
import * as ort from "onnxruntime-node";
import type { InferenceSession } from "onnxruntime-node";

// Not sure why directly importing {resample} doesn't work, need to do this ugly workaround
const resample = waveResampler.resample;

// Types
// Available models in data/models/:
//   htdemucs_6s_fp16weights.onnx  (~130 MB, half-precision weights; same speed as fp32 per demucs-onnx)
//   htdemucs_6s.onnx              (~246 MB, fp32)
const modelFilename = "htdemucs_6s_fp16weights.onnx";
export const modelPath = path.join(dataDir, "models", modelFilename);
export type StemType = "bass" | "guitar" | "drums";
type StemLR = [Float32Array, Float32Array];
type Separated = { bass: StemLR; guitar: StemLR; drums: StemLR };

export type ConverterPhase = "decode" | "separate" | "encode" | "done";

interface ConverterProgressBase {
    phase: ConverterPhase;
    /** Current step within the phase (0-based when total > 0). */
    current: number;
    /** Total steps in the phase. */
    total: number;
    /** Milliseconds elapsed since the operation started. */
    elapsedMs: number;
    /** Estimated milliseconds remaining in the current phase (0 when done/unknown). */
    etaMs: number;
}

export interface SplitProgress extends ConverterProgressBase {
    /** Set on the final "done" emission. */
    result?: Record<string, string>;
}

export interface MuteProgress extends ConverterProgressBase {
    /** Set on the final "done" emission. */
    result?: string;
}

// Some constants for Demucs-ONNX

/**
 * Demucs-ONNX expects 44100 Hz audio, so we resample everything to that.
 */
const sampleRate = 44100;

/**
 *  foixed Demucs-ONNX windw (7.8s @ 44100 Hz)
 *  Also expected by the model to be 343980 samples, so we use that as a constant.
 */
const samplesNum = 343980;

/** */
const OVERLAP = Math.floor(samplesNum / 4);

/** */
const STRIDE = samplesNum - OVERLAP;

/**
 * Stem row order for htdemucs_6s (from demucs-onnx docs).
 */
const stemMapping = {
    drums: 0,
    bass: 1,
    other: 2,
    vocals: 3,
    guitar: 4,
    piano: 5,
};

let session: InferenceSession | null = null;

async function getSession(): Promise<InferenceSession> {
    if (session) {
        return session;
    }

    if (!(await fs.exists(modelPath))) {
        throw new Error(
            `Demucs model not found at ${modelPath}. `,
        );
    }

    session = await ort.InferenceSession.create(modelPath, {
        executionProviders: ["cpu"],
        enableCpuMemArena: false,
    });

    return session;
}

async function decodeFile(filename: string): Promise<{ channelData: Float32Array[]; sampleRate: number }> {
    const ext = path.extname(filename).slice(1).toLowerCase();
    const bytes = await Deno.readFile(filename);

    if (ext === "flac") {
        const decoder = new FLACDecoder();
        try {
            await decoder.ready;
            const r = await decoder.decodeFile(bytes);
            if (!r || !r.channelData || r.channelData.length === 0) {
                throw new Error("FLAC decode returned no data");
            }
            return { channelData: r.channelData, sampleRate: r.sampleRate };
        } finally {
            decoder.free();
        }
    }

    if (ext === "ogg") {
        const decoder = new OggVorbisDecoder();
        try {
            await decoder.ready;
            const r = await decoder.decodeFile(bytes);
            if (!r || !r.channelData || r.channelData.length === 0) {
                throw new Error("OGG decode returned no data");
            }
            return { channelData: r.channelData, sampleRate: r.sampleRate };
        } finally {
            decoder.free();
        }
    }

    if (ext === "mp3" || ext === "mp2" || ext === "mp1" || ext === "mpeg") {
        const decoder = new MPEGDecoder();
        try {
            await decoder.ready;
            const r = decoder.decode(bytes);
            if (!r || !r.channelData || r.channelData.length === 0) {
                throw new Error("MPEG decode returned no data");
            }
            return { channelData: r.channelData, sampleRate: r.sampleRate };
        } finally {
            decoder.free();
        }
    }

    if (ext === "wav" || ext === "wave") {
        return WavDecoder.decode.sync(bytes.buffer);
    }

    throw new Error(`Unsupported audio format: .${ext}`);
}

function resampleToFloat32Array(input: Float32Array, fromSr: number, toSr: number): Float32Array {
    return new Float32Array(resample(input, fromSr, toSr));
}

/**
 * Estimate remaining time for a phase with roughly equal-duration steps,
 * based on the average step time measured so far.
 */
function estimateEta(phaseStartMs: number, stepsDone: number, totalSteps: number): number {
    return (performance.now() - phaseStartMs) / stepsDone * (totalSteps - stepsDone);
}

async function* separate(leftChannel: Float32Array, rightChannel: Float32Array): AsyncGenerator<{ current: number; total: number; etaMs: number }, Separated, void> {
    const session = await getSession();
    const total = leftChannel.length;
    const nChunks = Math.ceil(total / STRIDE);
    const t0 = performance.now();

    const needed = [stemMapping.drums, stemMapping.bass, stemMapping.guitar];
    const acc: Record<number, StemLR> = {};
    for (const row of needed) {
        acc[row] = [new Float32Array(total), new Float32Array(total)];
    }
    const weight = new Float32Array(total);
    const win = new Float32Array(samplesNum).fill(1);
    for (let i = 0; i < OVERLAP; i++) {
        win[i] = i / OVERLAP;
        win[samplesNum - 1 - i] = i / OVERLAP;
    }
    const chunkBuf = new Float32Array(2 * samplesNum);

    for (let i = 0; i < nChunks; i++) {
        const start = i * STRIDE;
        const end = Math.min(start + samplesNum, total);
        const clen = end - start;

        chunkBuf.fill(0);
        chunkBuf.subarray(0, clen).set(leftChannel.subarray(start, end));
        chunkBuf.subarray(samplesNum, samplesNum + clen).set(rightChannel.subarray(start, end));

        const result = await session.run({
            mix: new ort.Tensor("float32", chunkBuf, [1, 2, samplesNum]),
        });
        const stems = result.stems.data as Float32Array; // (1, 6, 2, N) flat

        for (const row of needed) {
            const rowOffset = row * 2 * samplesNum;
            for (let c = 0; c < 2; c++) {
                const base = rowOffset + c * samplesNum;
                for (let s = 0; s < clen; s++) {
                    acc[row][c][start + s] += stems[base + s] * win[s];
                }
            }
        }
        for (let s = 0; s < clen; s++) weight[start + s] += win[s];

        const done = i + 1;
        yield { current: done, total: nChunks, etaMs: estimateEta(t0, done, nChunks) };
    }

    for (const row of needed) {
        for (let c = 0; c < 2; c++) {
            for (let s = 0; s < total; s++) {
                acc[row][c][s] /= Math.max(weight[s], 1e-8);
            }
        }
    }

    return {
        drums: acc[stemMapping.drums],
        bass: acc[stemMapping.bass],
        guitar: acc[stemMapping.guitar],
    };
}

/**
 * Decode + resample the input, then drain the separation generator.
 * Yields "decode" and "separate" progress; returns the stems plus resampled channels.
 */
async function* decodeAndSeparate(filename: string, startMs: number): AsyncGenerator<ConverterProgressBase, { separated: Separated; left: Float32Array; right: Float32Array }, void> {
    yield { phase: "decode", current: 0, total: 1, elapsedMs: 0, etaMs: 0 };
    const decoded = await decodeFile(filename);

    const L = resampleToFloat32Array(decoded.channelData[0], decoded.sampleRate, sampleRate);
    const R = resampleToFloat32Array(decoded.channelData[Math.min(1, decoded.channelData.length - 1)], decoded.sampleRate, sampleRate);

    const it = separate(L, R);
    while (true) {
        const next = await it.next();
        if (next.done) {
            return { separated: next.value, left: L, right: R };
        }
        yield {
            phase: "separate",
            current: next.value.current,
            total: next.value.total,
            elapsedMs: performance.now() - startMs,
            etaMs: next.value.etaMs,
        };
    }
}

/**
 * Split an audio file into separated files.
 *
 * Yields progress updates so callers can show a progress bar, e.g.:
 *   for await (const p of split(filename, outputDir, ["bass"])) {
 *       console.log(p.phase, p.current, "/", p.total, `~${(p.etaMs / 1000).toFixed(0)}s left`);
 *   }
 *
 * @param filename Path to the source audio file (flac / ogg / wav).
 * @param outputDir Directory where outputs are written (created if missing).
 * @param stems Which stems to extract.
 */
export async function* split(filename: string, outputDir: string, stems: StemType[]): AsyncGenerator<SplitProgress, void, void> {
    await fs.ensureDir(outputDir);
    const start = performance.now();

    let separated: Separated;
    const it = decodeAndSeparate(filename, start);
    while (true) {
        const next = await it.next();
        if (next.done) {
            separated = next.value.separated;
            break;
        }
        yield next.value;
    }

    let result: Record<string, string> = {};
    const encodeStart = performance.now();
    let i = 0;
    for (const stem of stems) {
        let p = path.join(outputDir, `${stem}.ogg`);

        // Avoid overwriting, add a "_new" if the file already exists
        while (await fs.exists(p)) {
            const parsed = path.parse(p);
            p = path.join(parsed.dir, `${parsed.name}_new${parsed.ext}`);
        }

        await Deno.writeFile(p, await encodeOgg(separated[stem], sampleRate));
        result[stem] = p;
        i++;
        yield { phase: "encode", current: i, total: stems.length, elapsedMs: performance.now() - start, etaMs: estimateEta(encodeStart, i, stems.length) };
    }
    yield { phase: "done", current: 1, total: 1, elapsedMs: performance.now() - start, etaMs: 0, result };
}

/**
 * Produce a mix with one stem removed (muted).
 *
 * Yields progress updates so callers can show a progress bar, e.g.:
 *   for await (const p of muteTrack(filename, outputPath, "bass")) {
 *       console.log(p.phase, p.current, "/", p.total, `~${(p.etaMs / 1000).toFixed(0)}s left`);
 *   }
 *
 * @param filename Path to the source audio file (flac / ogg / wav).
 * @param outputPath Path where the muted .ogg is written.
 * @param stem Which stem to mute.
 */
export async function* muteTrack(filename: string, outputPath: string, stem: StemType): AsyncGenerator<MuteProgress, void, void> {
    const start = performance.now();

    let res: { separated: Separated; left: Float32Array; right: Float32Array };
    const it = decodeAndSeparate(filename, start);
    while (true) {
        const next = await it.next();
        if (next.done) {
            res = next.value;
            break;
        }
        yield next.value;
    }
    const { separated, left: L, right: R } = res;

    // Demucs stems reconstruct the mix, so subtracting the muted stem
    // removes that instrument from the original.
    const muted = separated[stem];
    const out: StemLR = [new Float32Array(L.length), new Float32Array(R.length)];
    for (let c = 0; c < 2; c++) {
        for (let s = 0; s < L.length; s++) {
            out[c][s] = (c === 0 ? L : R)[s] - muted[c][s];
        }
    }

    yield { phase: "encode", current: 0, total: 1, elapsedMs: performance.now() - start, etaMs: 0 };
    await Deno.writeFile(outputPath, await encodeOgg(out, sampleRate));
    yield { phase: "done", current: 1, total: 1, elapsedMs: performance.now() - start, etaMs: 0, result: outputPath };
}
