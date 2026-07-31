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
export type StemType = "bass" | "guitar" | "drums";
type StemLR = [Float32Array, Float32Array];

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

    const modelPath = path.join(dataDir, "models", "htdemucs_6s_fp16weights.onnx");

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

async function separate(leftChannel: Float32Array, rightChannel: Float32Array): Promise<{ bass: StemLR; guitar: StemLR; drums: StemLR }> {
    const session = await getSession();
    const total = leftChannel.length;
    const nChunks = Math.ceil(total / STRIDE);

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
 * Split an audio file into separated files.
 * @param filename Path to the source audio file (flac / ogg / wav).
 * @param outputDir Directory where outputs are written (created if missing).
 * @param stems Which stems to extract.
 */
export async function split(filename: string, outputDir: string, stems: StemType[]): Promise<Record<string, string>> {
    await fs.ensureDir(outputDir);
    const decoded = await decodeFile(filename);

    const L = resampleToFloat32Array(decoded.channelData[0], decoded.sampleRate, sampleRate);
    const R = resampleToFloat32Array(decoded.channelData[Math.min(1, decoded.channelData.length - 1)], decoded.sampleRate, sampleRate);

    const separated = await separate(L, R);
    let result: Record<string, string> = {};
    for (const stem of stems) {
        let p = path.join(outputDir, `${stem}.ogg`);

        // Avoid overwriting, add a "_new" if the file already exists
        while (await fs.exists(p)) {
            const parsed = path.parse(p);
            p = path.join(parsed.dir, `${parsed.name}_new${parsed.ext}`);
        }

        await Deno.writeFile(p, await encodeOgg(separated.bass, sampleRate));
        result[stem] = p;
    }
    return result;
}
