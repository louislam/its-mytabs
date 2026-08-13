import * as path from "@std/path";
import { Piscina } from "piscina";
import { isModelInstalled } from "./converter.ts";
import { isOrtInstalled } from "./onnxruntime.ts";
import { updateConfigJSON } from "./tab.ts";
import type { SeparateWorkerMessage, SeparateWorkerRequest } from "./separate_worker.ts";

export { isModelInstalled, isOrtInstalled };

export type SeparatePhase = "download" | "decode" | "separate" | "encode" | "done" | "error";

export interface SeparateJob {
    /** Tab id the job belongs to. */
    tabID: string;
    /** Source audio filename. */
    filename: string;
    phase: SeparatePhase;
    current: number;
    total: number;
    elapsedMs: number;
    etaMs: number;
    message: string;
    /** Set when phase === "done": stem name -> output file path. */
    result?: Record<string, string>;
    /** Set when phase === "error". */
    error?: string;
    startedAt: number;
}

let currentJob: SeparateJob | null = null;

// piscina manages a pool of node:worker_threads; each task runs the default
// export of separate_worker.ts in a worker thread so the blocking ONNX Runtime
// inference does not freeze the HTTP server. Only one separation runs at a
// time (see isSeparateBusy), so a single-thread pool is enough.
const pool = new Piscina({
    filename: new URL("./separate_worker.ts", import.meta.url).href,
    minThreads: 1,
    maxThreads: 1,
    idleTimeout: 60_000,
});

// Progress messages posted by the worker are surfaced here.
pool.on("message", (msg: SeparateWorkerMessage) => {
    if (msg.type === "progress") {
        handleProgress(msg);
    }
});

/** Whether a separation job is currently running (not done/error). */
export function isSeparateBusy(): boolean {
    return currentJob !== null && currentJob.phase !== "done" && currentJob.phase !== "error";
}

/** Current job snapshot (also returned after the job finished, until a new job starts). */
export function getSeparateJob(): SeparateJob | null {
    return currentJob;
}

/**
 * Start separating `filename` (in the tab's folder) into bass/drums/guitar stems.
 *
 * The actual work runs in a piscina worker thread (see separate_worker.ts) so
 * the blocking ONNX Runtime inference does not freeze the HTTP server. Poll
 * getSeparateJob() for progress; worker messages update it.
 *
 * If the ONNX Runtime package and/or the Demucs model are missing and
 * `downloadModel` is true, they are downloaded first (reported as the
 * "download" phase).
 *
 * @param tabID Tab id (folder name).
 * @param filename Source audio filename in the tab folder.
 * @param sourcePath Absolute path to the source audio file.
 * @param downloadModel Allow downloading the AI model + runtime if they are missing.
 */
export function startSeparate(tabID: string, filename: string, sourcePath: string, downloadModel: boolean): void {
    if (isSeparateBusy()) {
        throw new Error("A separation task is already in progress. Please wait for it to finish.");
    }
    if (!downloadModel && (!isModelInstalled() || !isOrtInstalled())) {
        throw new Error("AI model / runtime is not downloaded yet");
    }

    currentJob = {
        tabID,
        filename,
        phase: isModelInstalled() && isOrtInstalled() ? "decode" : "download",
        current: 0,
        total: 0,
        elapsedMs: 0,
        etaMs: 0,
        message: "",
        startedAt: performance.now(),
    };

    console.log(`[separate] Job started: ${filename} (source: ${sourcePath})`);

    const request: SeparateWorkerRequest = { sourcePath, tabID, downloadModel };
    pool.run(request)
        .then((result) => {
            const job = currentJob;
            if (!job) {
                return;
            }
            job.phase = "done";
            job.result = result;
            job.elapsedMs = performance.now() - job.startedAt;
            logJobProgress(job, true);
            console.log(`[separate] Job done: ${Object.values(result).join(", ")}`);
            // The separated tracks should play in sync with the source, so
            // inherit its sync metadata. Run in the background; the result is
            // already in the job for the UI.
            inheritSyncMetadata(job.tabID, job.filename, result).catch((e) => {
                console.error("[separate] Failed to inherit sync metadata:", e);
            });
        })
        .catch((err) => {
            const job = currentJob;
            if (!job) {
                return;
            }
            job.phase = "error";
            job.error = err instanceof Error ? err.message : String(err);
            job.elapsedMs = performance.now() - job.startedAt;
            console.error(`[separate] Job failed: ${job.error}`);
        });
}

// Log throttling for console progress output
let lastProgressLog = 0;
let lastLogPhase = "";

/**
 * Print job progress to the console, throttled to ~once per 10 seconds
 * (always prints on phase changes).
 */
function logJobProgress(job: SeparateJob, force = false): void {
    const now = performance.now();
    if (!force && now - lastProgressLog < 10_000 && job.phase === lastLogPhase) {
        return;
    }
    lastProgressLog = now;
    lastLogPhase = job.phase;
    const pct = job.total > 0 ? ` (${((job.current / job.total) * 100).toFixed(0)}%)` : "";
    const eta = job.etaMs > 0 ? ` ~${(job.etaMs / 1000).toFixed(0)}s left` : "";
    console.log(`[separate] ${job.filename}: ${job.phase} ${job.current}/${job.total}${pct}${eta} (${(job.elapsedMs / 1000).toFixed(0)}s)`);
}

function handleProgress(msg: Extract<SeparateWorkerMessage, { type: "progress" }>): void {
    const job = currentJob;
    if (!job) {
        return;
    }
    job.phase = msg.phase;
    job.current = msg.current;
    job.total = msg.total;
    job.elapsedMs = msg.elapsedMs;
    job.etaMs = msg.etaMs;
    job.message = msg.message;
    logJobProgress(job);
}

/**
 * Copy the sync metadata (syncMethod / simpleSync / advancedSync) of the
 * source audio file onto the newly separated stem files, so the stems line up
 * with the same playback offset as the original song.
 */
async function inheritSyncMetadata(tabID: string, sourceFilename: string, result: Record<string, string>): Promise<void> {
    await updateConfigJSON(tabID, async (config) => {
        const source = config.audio.find((a) => a.filename === sourceFilename);
        if (!source) {
            return;
        }
        const meta = {
            syncMethod: source.syncMethod,
            simpleSync: source.simpleSync,
            advancedSync: source.advancedSync,
        };
        for (const outputPath of Object.values(result)) {
            const filename = path.basename(outputPath);
            const existing = config.audio.find((a) => a.filename === filename);
            if (existing) {
                Object.assign(existing, meta);
            } else {
                config.audio.push({ filename, ...meta });
            }
        }
    });
}
