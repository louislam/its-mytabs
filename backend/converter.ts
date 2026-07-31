import * as fs from "@std/fs";
import * as path from "@std/path";
import { dataDir } from "./util.ts";
import { FLACDecoder } from "@wasm-audio-decoders/flac";
import { OggVorbisDecoder } from "@wasm-audio-decoders/ogg-vorbis";
import { createOggEncoder } from "wasm-media-encoders";
import * as ort from "onnxruntime-node";
import type * as AT from "@coderline/alphatab";

// alphaTab's ESM bundle executes browser-only setup at import time (it reads
// `window.devicePixelRatio` and touches Element/Document prototypes). Deno has
// no DOM, so we shim the minimal globals it probes before loading the module.
const _g = globalThis as unknown as Record<string, unknown>;
_g.window = globalThis;
(_g.window as Record<string, unknown>).devicePixelRatio = 1;
_g.Element = class {};
_g.Document = class {};
_g.DocumentFragment = class {};
_g.Node = class {};

const alphaTab = await import("@coderline/alphatab");

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const SR = 44100;
const N_SAMPLES = Math.round(7.8 * SR); // 343980 – fixed Demucs-ONNX window
const OVERLAP = Math.floor(N_SAMPLES / 4);
const STRIDE = N_SAMPLES - OVERLAP;

/** Stem row order for htdemucs_6s (from demucs-onnx docs). */
const STEM_ROWS = { drums: 0, bass: 1, other: 2, vocals: 3, guitar: 4, piano: 5 };

const MODEL_FILE = "htdemucs_6s_fp16weights.onnx";
const BPM = 120; // fixed tempo for stage 1 (quantization grid)
const BEATS_PER_BAR_GRID = 8;
const GRID_DUR = (60 / BPM) / 2; // seconds per eighth note

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
interface NoteSeg {
    start: number;
    end: number;
    freq: number;
}

export type { NoteSeg };

export type StemKind = "bass" | "guitar" | "drums";

export interface SplitResult {
    original: string;
    stems: Partial<Record<StemKind, string>>;
    tab: string;
}

// ---------------------------------------------------------------------------
// Audio decoding
// ---------------------------------------------------------------------------
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

    if (ext === "wav" || ext === "wave") {
        return parseWav(bytes);
    }

    throw new Error(`Unsupported audio format: .${ext} (mp3 not yet supported)`);
}

function parseWav(buf: Uint8Array): { channelData: Float32Array[]; sampleRate: number } {
    const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    if (dv.getUint32(0, true) !== 0x46464952) throw new Error("Not a WAV file");

    let sampleRate = 44100;
    let numCh = 1;
    let bits = 16;
    let dataOff = -1;
    let dataLen = 0;
    let off = 12;

    while (off + 8 <= buf.length) {
        const id = dv.getUint32(off, true);
        const size = dv.getUint32(off + 4, true);
        if (id === 0x20746D66) {
            // "fmt " (LE fourCC)
            numCh = dv.getUint16(off + 10, true);
            sampleRate = dv.getUint32(off + 12, true);
            bits = dv.getUint16(off + 22, true);
        } else if (id === 0x61746164) {
            // "data"
            dataOff = off + 8;
            dataLen = size;
            break;
        }
        off += 8 + size + (size & 1);
    }

    if (dataOff < 0) throw new Error("WAV has no data chunk");

    const bytesPerSample = bits / 8;
    const frames = Math.floor(dataLen / (numCh * bytesPerSample));
    const channelData: Float32Array[] = [];
    for (let c = 0; c < numCh; c++) channelData.push(new Float32Array(frames));

    for (let i = 0; i < frames; i++) {
        for (let c = 0; c < numCh; c++) {
            const idx = dataOff + (i * numCh + c) * bytesPerSample;
            if (bits === 16) channelData[c][i] = dv.getInt16(idx, true) / 32768;
            else if (bits === 32) channelData[c][i] = dv.getFloat32(idx, true);
            else if (bits === 8) channelData[c][i] = (buf[idx] - 128) / 128;
        }
    }
    return { channelData, sampleRate };
}

// ---------------------------------------------------------------------------
// Resample + encode
// ---------------------------------------------------------------------------
function resample(input: Float32Array, fromSr: number, toSr: number): Float32Array {
    if (fromSr === toSr) return input;
    const ratio = toSr / fromSr;
    const outLen = Math.floor(input.length * ratio);
    const out = new Float32Array(outLen);
    for (let i = 0; i < outLen; i++) {
        const pos = i / ratio;
        const i0 = Math.floor(pos);
        const i1 = Math.min(i0 + 1, input.length - 1);
        const t = pos - i0;
        out[i] = input[i0] * (1 - t) + input[i1] * t;
    }
    return out;
}

async function encodeOgg(channelData: Float32Array[], sampleRate: number): Promise<Uint8Array> {
    const channels: 1 | 2 = channelData.length >= 2 ? 2 : 1;
    const encoder = await createOggEncoder();
    encoder.configure({ sampleRate, channels, vbrQuality: 8 });

    const chunks: Uint8Array[] = [];
    const encoded = encoder.encode(channelData);
    if (encoded.length > 0) chunks.push(new Uint8Array(encoded));
    const tail = encoder.finalize();
    if (tail.length > 0) chunks.push(new Uint8Array(tail));

    const total = chunks.reduce((s, c) => s + c.length, 0);
    const out = new Uint8Array(total);
    let offset = 0;
    for (const c of chunks) {
        out.set(c, offset);
        offset += c.length;
    }
    return out;
}

function monoMix(L: Float32Array, R: Float32Array): Float32Array {
    if (L === R) return L;
    const out = new Float32Array(L.length);
    for (let i = 0; i < L.length; i++) out[i] = (L[i] + R[i]) * 0.5;
    return out;
}

// ---------------------------------------------------------------------------
// Source separation (Demucs-ONNX via onnxruntime-node)
// ---------------------------------------------------------------------------
type _INF_SESSION = ort.InferenceSession;
type StemLR = [Float32Array, Float32Array];
let sessionCache: { path: string; session: _INF_SESSION } | null = null;

async function getSession(modelPath: string): Promise<_INF_SESSION> {
    if (sessionCache && sessionCache.path === modelPath) return sessionCache.session;
    const sess = await ort.InferenceSession.create(modelPath, {
        executionProviders: ["cpu"],
        graphOptimizationLevel: "disabled",
        enableCpuMemArena: false,
    });
    sessionCache = { path: modelPath, session: sess };
    return sess;
}

function modelPath(): string {
    return Deno.env.get("DEMUCS_MODEL_PATH") ?? path.join(dataDir, "models", MODEL_FILE);
}

function makeTransitionWindow(seg: number, overlap: number): Float32Array {
    const w = new Float32Array(seg).fill(1);
    for (let i = 0; i < overlap; i++) {
        w[i] = i / overlap;
        w[seg - 1 - i] = i / overlap;
    }
    return w;
}

async function separate(
    L: Float32Array,
    R: Float32Array,
    modelFilePath: string,
): Promise<{ bass: StemLR; guitar: StemLR; drums: StemLR }> {
    const session = await getSession(modelFilePath);
    const total = L.length;
    const nChunks = Math.ceil(total / STRIDE);

    const needed = [STEM_ROWS.drums, STEM_ROWS.bass, STEM_ROWS.guitar];
    const acc: Record<number, StemLR> = {};
    for (const row of needed) {
        acc[row] = [new Float32Array(total), new Float32Array(total)];
    }
    const weight = new Float32Array(total);
    const win = makeTransitionWindow(N_SAMPLES, OVERLAP);
    const chunkBuf = new Float32Array(2 * N_SAMPLES);

    for (let i = 0; i < nChunks; i++) {
        const start = i * STRIDE;
        const end = Math.min(start + N_SAMPLES, total);
        const clen = end - start;

        chunkBuf.fill(0);
        chunkBuf.subarray(0, clen).set(L.subarray(start, end));
        chunkBuf.subarray(N_SAMPLES, N_SAMPLES + clen).set(R.subarray(start, end));

        const result = await session.run({
            mix: new ort.Tensor("float32", chunkBuf, [1, 2, N_SAMPLES]),
        });
        const stems = result.stems.data as Float32Array; // (1, 6, 2, N) flat

        for (const row of needed) {
            const rowOffset = row * 2 * N_SAMPLES;
            for (let c = 0; c < 2; c++) {
                const base = rowOffset + c * N_SAMPLES;
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
        drums: acc[STEM_ROWS.drums],
        bass: acc[STEM_ROWS.bass],
        guitar: acc[STEM_ROWS.guitar],
    };
}

// ---------------------------------------------------------------------------
// In-place radix-2 FFT
// ---------------------------------------------------------------------------
function fft(re: Float32Array, im: Float32Array): void {
    const n = re.length;

    // bit-reversal permutation
    for (let i = 1, j = 0; i < n; i++) {
        let bit = n >> 1;
        for (; j & bit; bit >>= 1) j ^= bit;
        j ^= bit;
        if (i < j) {
            const tr = re[i];
            re[i] = re[j];
            re[j] = tr;
            const ti = im[i];
            im[i] = im[j];
            im[j] = ti;
        }
    }

    // Cooley-Tukey loops
    for (let len = 2; len <= n; len <<= 1) {
        const ang = (-2 * Math.PI) / len;
        const wr = Math.cos(ang);
        const wi = Math.sin(ang);
        for (let i = 0; i < n; i += len) {
            let cwr = 1;
            let cwi = 0;
            for (let k = 0; k < len / 2; k++) {
                const a = i + k;
                const b = i + k + len / 2;
                const tr = re[b] * cwr - im[b] * cwi;
                const ti = re[b] * cwi + im[b] * cwr;
                re[b] = re[a] - tr;
                im[b] = im[a] - ti;
                re[a] = re[a] + tr;
                im[a] = im[a] + ti;
                const ncwr = cwr * wr - cwi * wi;
                cwi = cwr * wi + cwi * wr;
                cwr = ncwr;
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Monophonic transcription (port of bass-split notes.py idea)
// ---------------------------------------------------------------------------
const FMIN = 32.7;
const FMAX = 2000.0;
const BINS_PER_OCTAVE = 36;

function computeStft(y: Float32Array, nFft: number, hop: number, sr: number) {
    const nBins = nFft / 2 + 1;
    const nFrames = Math.max(1, Math.floor((y.length - nFft) / hop) + 1);
    const mag = new Float32Array(nBins * nFrames);
    const times = new Float32Array(nFrames);

    const re = new Float32Array(nFft);
    const im = new Float32Array(nFft);
    const win = new Float32Array(nFft);
    for (let i = 0; i < nFft; i++) win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (nFft - 1));

    for (let f = 0; f < nFrames; f++) {
        const start = f * hop;
        for (let i = 0; i < nFft; i++) {
            re[i] = y[start + i] * win[i];
            im[i] = 0;
        }
        fft(re, im);
        for (let k = 0; k < nBins; k++) mag[k * nFrames + f] = Math.hypot(re[k], im[k]);
        times[f] = start / sr;
    }
    return { mag, nBins, times, nFrames };
}

export function transcribe(y: Float32Array, sr: number): NoteSeg[] {
    const nFft = 2048;
    const hop = 512;
    const { mag, nBins, times, nFrames } = computeStft(y, nFft, hop, sr);
    if (nFrames < 2) return [];

    const nLog = BINS_PER_OCTAVE * Math.ceil(Math.log2(FMAX / FMIN));
    const logFreqs = new Float32Array(nLog);
    for (let i = 0; i < nLog; i++) logFreqs[i] = FMIN * Math.pow(2, i / BINS_PER_OCTAVE);

    const magLog = new Float32Array(nLog * nFrames);
    const linFreqs = new Float32Array(nBins);
    for (let k = 0; k < nBins; k++) linFreqs[k] = (k * sr) / nFft;

    for (let f = 0; f < nFrames; f++) {
        for (let i = 0; i < nLog; i++) {
            const lf = logFreqs[i];
            let j = 0;
            while (j < nBins - 1 && linFreqs[j + 1] < lf) j++;
            const f0 = linFreqs[j];
            const f1 = linFreqs[Math.min(j + 1, nBins - 1)];
            const t = f1 > f0 ? (lf - f0) / (f1 - f0) : 0;
            magLog[i * nFrames + f] = mag[j * nFrames + f] * (1 - t) + mag[Math.min(j + 1, nBins - 1) * nFrames + f] * t;
        }
    }

    const flux = new Float32Array(nFrames);
    for (let f = 1; f < nFrames; f++) {
        let s = 0;
        for (let i = 0; i < nLog; i++) {
            const d = magLog[i * nFrames + f] - magLog[i * nFrames + f - 1];
            if (d > 0) s += d;
        }
        flux[f] = s;
    }

    let maxFlux = 0;
    for (let f = 0; f < nFrames; f++) maxFlux = Math.max(maxFlux, flux[f]);
    const threshold = 0.1 * maxFlux;

    const onsets: number[] = [];
    for (let f = 1; f < nFrames - 1; f++) {
        if (flux[f] > flux[f - 1] && flux[f] >= flux[f + 1] && flux[f] > threshold) onsets.push(f);
    }
    const boundaries = [0, ...onsets, nFrames - 1];

    const notes: NoteSeg[] = [];
    for (let i = 0; i < boundaries.length - 1; i++) {
        const s = boundaries[i];
        const e = boundaries[i + 1];
        if (e <= s) continue;

        const mean = new Float32Array(nLog);
        for (let f = s; f <= e; f++) {
            for (let b = 0; b < nLog; b++) mean[b] += magLog[b * nFrames + f];
        }

        let best = 0;
        let bestv = -1;
        for (let b = 0; b < nLog; b++) {
            const v = mean[b] / (e - s + 1);
            if (v > bestv) {
                bestv = v;
                best = b;
            }
        }
        if (bestv <= 0) continue;

        notes.push({ start: times[s], end: times[e], freq: logFreqs[best] });
    }
    return notes;
}

function midiFromFreq(freq: number): number {
    return Math.round(69 + 12 * Math.log2(freq / 440));
}

function midiToFret(strings: number[], midi: number): { fret: number; string: number } {
    let best: { fret: number; string: number } | null = null;
    for (let i = 0; i < strings.length; i++) {
        const fret = midi - strings[i];
        if (fret >= 0 && fret <= 24) {
            if (best === null || fret < best.fret) best = { fret, string: i + 1 };
        }
    }
    if (best) return best;
    const lastIdx = strings.length - 1;
    return { fret: Math.max(0, midi - strings[lastIdx]), string: lastIdx + 1 };
}

function drumKeyFromFreq(freq: number): number {
    if (freq < 60) return 36; // kick
    if (freq < 200) return 38; // snare
    if (freq < 2000) return 42; // hi-hat / tom
    return 49; // crash
}

// ---------------------------------------------------------------------------
// Guitar Pro 7 building (alphaTab)
// ---------------------------------------------------------------------------
function gridToDuration(g: number) {
    if (g <= 1) return alphaTab.model.Duration.Eighth;
    if (g <= 2) return alphaTab.model.Duration.Quarter;
    if (g <= 4) return alphaTab.model.Duration.Half;
    if (g <= 8) return alphaTab.model.Duration.Whole;
    return alphaTab.model.Duration.DoubleWhole;
}

function buildTrack(name: string, shortName: string, stringCount: number, program: number): AT.model.Track {
    const t = new alphaTab.model.Track() as AT.model.Track & { strings: number[] };
    t.name = name;
    t.shortName = shortName;
    if (stringCount > 0) {
        t.strings = alphaTab.model.Tuning.getDefaultTuningFor(stringCount)!.tunings.slice();
    } else {
        t.strings = [];
    }
    const pi = new alphaTab.model.PlaybackInformation();
    pi.program = program;
    t.playbackInfo = pi;
    return t;
}

export interface TrackSpec {
    name: string;
    shortName: string;
    type: "bass" | "guitar" | "drums";
    notes: NoteSeg[];
}

function addNotesToTrack(
    track: AT.model.Track,
    notes: NoteSeg[],
    masterBars: AT.model.MasterBar[],
): void {
    const staff = new alphaTab.model.Staff();
    track.addStaff(staff);

    const isPerc = track.playbackInfo.program === 0;
    const strings = (track as AT.model.Track & { strings: number[] }).strings;

    for (let b = 0; b < masterBars.length; b++) {
        const bar = new alphaTab.model.Bar();
        bar.index = b;
        const voice = new alphaTab.model.Voice();
        bar.addVoice(voice);

        const barNotes = notes
            .filter((n) => {
                const gs = Math.floor(n.start / GRID_DUR);
                return gs >= b * BEATS_PER_BAR_GRID && gs < (b + 1) * BEATS_PER_BAR_GRID;
            })
            .sort((a, c) => a.start - c.start);

        let cursor = 0;
        for (const n of barNotes) {
            const gridStart = Math.floor(n.start / GRID_DUR);
            const local = gridStart - b * BEATS_PER_BAR_GRID;
            const durGrid = Math.max(1, Math.round((n.end - n.start) / GRID_DUR));
            if (local > cursor) {
                const rest = new alphaTab.model.Beat();
                rest.duration = gridToDuration(local - cursor);
                voice.addBeat(rest);
                cursor = local;
            }
            const beat = new alphaTab.model.Beat();
            beat.duration = gridToDuration(durGrid);
            const note = new alphaTab.model.Note();
            if (isPerc) {
                note.string = -1;
                note.percussionArticulation = 0;
                note.fret = drumKeyFromFreq(n.freq);
            } else {
                const { fret, string } = midiToFret(strings, midiFromFreq(n.freq));
                note.fret = fret;
                note.string = string;
            }
            beat.addNote(note);
            voice.addBeat(beat);
            cursor = local + durGrid;
        }
        if (cursor < BEATS_PER_BAR_GRID) {
            const rest = new alphaTab.model.Beat();
            rest.duration = gridToDuration(BEATS_PER_BAR_GRID - cursor);
            voice.addBeat(rest);
        }
        staff.addBar(bar);
    }
}

function buildGuitarPro(title: string, artist: string, specs: TrackSpec[]): Uint8Array {
    const score = new alphaTab.model.Score();
    score.title = title;
    score.artist = artist;

    let maxGrid = BEATS_PER_BAR_GRID;
    for (const spec of specs) {
        for (const n of spec.notes) {
            const g = Math.floor(n.start / GRID_DUR) + Math.max(1, Math.round((n.end - n.start) / GRID_DUR));
            maxGrid = Math.max(maxGrid, g);
        }
    }
    const barCount = Math.ceil(maxGrid / BEATS_PER_BAR_GRID);

    for (let i = 0; i < barCount; i++) {
        const mb = new alphaTab.model.MasterBar();
        mb.timeSignatureNumerator = 4;
        mb.timeSignatureDenominator = 4;
        if (i === 0) {
            mb.tempoAutomations = [
                alphaTab.model.Automation.buildTempoAutomation(false, 0, BPM, 0, true),
            ];
        }
        score.addMasterBar(mb);
    }

    const programFor = { bass: 33, guitar: 27, drums: 0 } as const;
    for (const spec of specs) {
        const track = buildTrack(
            spec.name,
            spec.shortName,
            spec.type === "drums" ? 0 : spec.type === "bass" ? 4 : 6,
            programFor[spec.type],
        );
        if (spec.type === "drums") {
            track.playbackInfo.program = 0;
            track.playbackInfo.primaryChannel = 9;
        }
        addNotesToTrack(track, spec.notes, score.masterBars);
        score.addTrack(track);
    }

    score.finish(new alphaTab.Settings());
    for (const track of score.tracks) track.finish(new alphaTab.Settings());

    const exporter = new alphaTab.exporter.Gp7Exporter();
    return exporter.export(score, new alphaTab.Settings());
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------
/**
 * Split an audio file into separated stems (bass / guitar / drums) and
 * generate a Guitar Pro 7 tab from the detected pitches.
 *
 * Writes into `outputDir`:
 * - `original.ogg`                         – the source re-encoded to OGG
 * - `bass.ogg`, `guitar.ogg`, `drums.ogg`  – separated stems
 * - `tab.gp`                               – generated Guitar Pro 7 file
 *
 * @param filename Path to the source audio file (flac / ogg / wav).
 * @param outputDir Directory where outputs are written (created if missing).
 * @param stems Which stems to extract (default: all three).
 */
export async function split(
    filename: string,
    outputDir: string,
    stems: StemKind[] = ["bass", "guitar", "drums"],
): Promise<SplitResult> {
    await fs.ensureDir(outputDir);

    const wantBass = stems.includes("bass");
    const wantGuitar = stems.includes("guitar");
    const wantDrums = stems.includes("drums");

    // 1. decode + resample to 44.1 kHz
    const decoded = await decodeFile(filename);
    const L = resample(decoded.channelData[0], decoded.sampleRate, SR);
    const R = resample(decoded.channelData[Math.min(1, decoded.channelData.length - 1)], decoded.sampleRate, SR);

    // 2. write original.ogg
    const originalPath = path.join(outputDir, "original.ogg");
    await Deno.writeFile(originalPath, await encodeOgg([L, R], SR));

    // 3. separate stems
    const mp = modelPath();
    if (!(await fs.exists(mp))) {
        throw new Error(
            `Demucs model not found at ${mp}. Set DEMUCS_MODEL_PATH or download ${MODEL_FILE}.`,
        );
    }
    const separated = await separate(L, R, mp);

    // 4. write stem oggs
    const stemPaths: Partial<Record<StemKind, string>> = {};
    if (wantBass) {
        stemPaths.bass = path.join(outputDir, "bass.ogg");
        await Deno.writeFile(stemPaths.bass, await encodeOgg(separated.bass, SR));
    }
    if (wantGuitar) {
        stemPaths.guitar = path.join(outputDir, "guitar.ogg");
        await Deno.writeFile(stemPaths.guitar, await encodeOgg(separated.guitar, SR));
    }
    if (wantDrums) {
        stemPaths.drums = path.join(outputDir, "drums.ogg");
        await Deno.writeFile(stemPaths.drums, await encodeOgg(separated.drums, SR));
    }

    // 5. transcribe stems (mono) and collect track specs
    const specs: TrackSpec[] = [];

    if (wantBass) {
        specs.push({ name: "Bass", shortName: "B", type: "bass", notes: transcribe(monoMix(separated.bass[0], separated.bass[1]), SR) });
    }
    if (wantGuitar) {
        specs.push({ name: "Guitar", shortName: "G", type: "guitar", notes: transcribe(monoMix(separated.guitar[0], separated.guitar[1]), SR) });
    }
    if (wantDrums) {
        specs.push({ name: "Drums", shortName: "D", type: "drums", notes: transcribe(monoMix(separated.drums[0], separated.drums[1]), SR) });
    }

    const tabPath = path.join(outputDir, "tab.gp");
    await audioToGuitarPro(tabPath, specs);

    return {
        original: originalPath,
        stems: stemPaths,
        tab: tabPath,
    };
}

export async function audioToGuitarPro(outputFilename: string, specs: TrackSpec[]): Promise<void> {
    const gp = buildGuitarPro("", "", specs);
    await Deno.writeFile(outputFilename, gp);
}
