/// <reference lib="deno.worker" />
// Worker thread that runs the actual separation job.
//
// onnxruntime's native session.run() is a blocking Node-API call that freezes
// the JavaScript event loop of the thread it runs on. Running the whole job
// (downloads + inference) in this worker keeps the main process (HTTP server,
// sockets, polling) responsive while a long song is being separated.
import * as path from "@std/path";
import { installOrt, isOrtInstalled, ortDownloadSizeMB, ortVersionLabel } from "./onnxruntime.ts";
import { isModelInstalled, modelPath, split } from "./converter.ts";
import { tabDir } from "./util.ts";

export type SeparatePhase = "download" | "decode" | "separate" | "encode" | "done" | "error";

export interface SeparateWorkerRequest {
    /** Absolute path to the source audio file. */
    sourcePath: string;
    /** Tab id (folder name); outputs are written into the tab folder. */
    tabID: string;
    /** Allow downloading the AI model + runtime if they are missing. */
    downloadModel: boolean;
}

interface SeparateWorkerProgressBase {
    type: "progress";
    phase: SeparatePhase;
    current: number;
    total: number;
    etaMs: number;
    message: string;
}

export type SeparateWorkerMessage =
    | { type: "ready" }
    | (SeparateWorkerProgressBase & { elapsedMs: number })
    | { type: "result"; result: Record<string, string>; elapsedMs: number }
    | { type: "error"; error: string; elapsedMs: number };

self.onmessage = async (e: MessageEvent<SeparateWorkerRequest>): Promise<void> => {
    const { sourcePath, tabID, downloadModel } = e.data;
    const startedAt = performance.now();
    const post = (msg: SeparateWorkerProgressBase) => {
        self.postMessage({ ...msg, elapsedMs: performance.now() - startedAt });
    };
    const postResult = (result: Record<string, string>) => {
        self.postMessage({ type: "result", result, elapsedMs: performance.now() - startedAt });
    };

    try {
        if (!isOrtInstalled()) {
            const message = `Downloading ${ortVersionLabel} (~${ortDownloadSizeMB} MB)...`;
            post({ type: "progress", phase: "download", current: 0, total: 0, etaMs: 0, message });
            await installOrt((p) => {
                post({ type: "progress", phase: "download", current: p.current, total: p.total, etaMs: 0, message });
            });
        }

        if (!isModelInstalled()) {
            const message = `Downloading ${path.basename(modelPath)} (~136 MB)...`;
            post({ type: "progress", phase: "download", current: 0, total: 0, etaMs: 0, message });
            await downloadDemucsModel((p) => {
                post({ type: "progress", phase: "download", current: p.current, total: p.total, etaMs: 0, message });
            });
        }

        const outputDir = path.join(tabDir, tabID);
        let result: Record<string, string> | null = null;
        for await (const p of split(sourcePath, outputDir, ["bass", "drums", "guitar"])) {
            if (p.phase === "done" && p.result) {
                result = p.result;
            } else {
                post({ type: "progress", phase: p.phase, current: p.current, total: p.total, etaMs: p.etaMs, message: "" });
            }
        }
        if (result) {
            postResult(result);
        }
    } catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        console.error(`[separate] Job failed in worker: ${error}`);
        self.postMessage({ type: "error", error, elapsedMs: performance.now() - startedAt });
    }
};

// Posting a request from the main thread before this handler is registered is
// silently dropped (module workers evaluate top-level awaits before the
// handler exists). Signal readiness so the main thread knows it is safe to
// send the job request.
self.postMessage({ type: "ready" });

interface DownloadProgress {
    current: number;
    total: number;
}

/** Download the Demucs model to the data dir, reporting byte progress. */
async function downloadDemucsModel(onProgress: (p: DownloadProgress) => void): Promise<void> {
    const url = `https://huggingface.co/StemSplitio/htdemucs-6s-onnx/resolve/main/${path.basename(modelPath)}`;
    const res = await fetch(url);
    if (!res.ok || !res.body) {
        throw new Error(`Failed to download the AI model: HTTP ${res.status}`);
    }
    const total = Number(res.headers.get("content-length")) || 0;
    let downloaded = 0;

    const partPath = `${modelPath}.part`;
    const file = await Deno.open(partPath, { write: true, create: true, truncate: true });
    try {
        const reader = res.body.getReader();
        while (true) {
            const { done, value } = await reader.read();
            if (done) {
                break;
            }
            if (value) {
                await file.write(value);
                downloaded += value.length;
                onProgress({ current: downloaded, total });
            }
        }
    } finally {
        file.close();
    }
    await Deno.rename(partPath, modelPath);
    onProgress({ current: total || downloaded, total });
}
