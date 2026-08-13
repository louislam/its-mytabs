import * as path from "@std/path";
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
let currentWorker: Worker | null = null;
/** Request waiting to be sent once the worker signals it is ready. */
let pendingRequest: SeparateWorkerRequest | null = null;

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
 * The actual work runs in a worker thread (see separate_worker.ts) so the
 * blocking ONNX Runtime inference does not freeze the HTTP server. Poll
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

    const worker = new Worker(new URL("./separate_worker.ts", import.meta.url), { type: "module" });
    currentWorker = worker;
    worker.onmessage = (e: MessageEvent<SeparateWorkerMessage>) => {
        // The worker signals readiness after its module (with all its
        // top-level awaits) has been evaluated. Messages posted to a module
        // worker before that point are silently dropped, so hold the request
        // until the "ready" handshake completes.
        if (e.data.type === "ready") {
            if (pendingRequest) {
                worker.postMessage(pendingRequest);
                pendingRequest = null;
            }
            return;
        }
        handleWorkerMessage(e.data).catch((err) => {
            console.error("[separate] Failed to handle worker message:", err);
        });
    };
    worker.onerror = (e) => {
        const job = currentJob;
        if (job && !isSeparateBusy()) {
            return;
        }
        if (job) {
            job.phase = "error";
            job.error = e.message || "Separation worker failed";
        }
        console.error("[separate] Worker error:", e.message || e);
        cleanupWorker();
    };

    pendingRequest = { sourcePath, tabID, downloadModel };
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

async function handleWorkerMessage(msg: SeparateWorkerMessage): Promise<void> {
    const job = currentJob;
    if (!job) {
        return;
    }
    switch (msg.type) {
        case "progress":
            job.phase = msg.phase;
            job.current = msg.current;
            job.total = msg.total;
            job.elapsedMs = msg.elapsedMs;
            job.etaMs = msg.etaMs;
            job.message = msg.message;
            logJobProgress(job);
            break;
        case "result":
            job.phase = "done";
            job.result = msg.result;
            job.elapsedMs = msg.elapsedMs;
            logJobProgress(job, true);
            console.log(`[separate] Job done: ${Object.values(msg.result).join(", ")}`);
            cleanupWorker();
            // The separated tracks should play in sync with the source, so
            // inherit its sync metadata. Run in the background; the result
            // message already told the UI the job finished.
            inheritSyncMetadata(job.tabID, job.filename, msg.result).catch((e) => {
                console.error("[separate] Failed to inherit sync metadata:", e);
            });
            break;
        case "error":
            job.phase = "error";
            job.error = msg.error;
            job.elapsedMs = msg.elapsedMs;
            console.error(`[separate] Job failed: ${msg.error}`);
            cleanupWorker();
            break;
    }
}

function cleanupWorker(): void {
    currentWorker?.terminate();
    currentWorker = null;
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
