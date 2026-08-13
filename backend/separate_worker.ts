import { parentPort } from "node:worker_threads";
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
    | (SeparateWorkerProgressBase & { elapsedMs: number })
    | { type: "result"; result: Record<string, string>; elapsedMs: number }
    | { type: "error"; error: string; elapsedMs: number };

/** Post a progress/message back to the piscina pool (null when not a worker). */
function post(msg: SeparateWorkerMessage): void {
    parentPort?.postMessage(msg);
}

export default async function separate(request: SeparateWorkerRequest): Promise<Record<string, string>> {
    const { sourcePath, tabID, downloadModel } = request;
    const startedAt = performance.now();
    const postProgress = (msg: SeparateWorkerProgressBase) => {
        post({ ...msg, elapsedMs: performance.now() - startedAt });
    };

    try {
        if (!isOrtInstalled()) {
            const message = `Downloading ${ortVersionLabel} (~${ortDownloadSizeMB} MB)...`;
            postProgress({ type: "progress", phase: "download", current: 0, total: 0, etaMs: 0, message });
            await installOrt((p) => {
                postProgress({ type: "progress", phase: "download", current: p.current, total: p.total, etaMs: 0, message });
            });
        }

        if (!isModelInstalled()) {
            const message = `Downloading ${path.basename(modelPath)} (~136 MB)...`;
            postProgress({ type: "progress", phase: "download", current: 0, total: 0, etaMs: 0, message });
            await downloadDemucsModel((p) => {
                postProgress({ type: "progress", phase: "download", current: p.current, total: p.total, etaMs: 0, message });
            });
        }

        const outputDir = path.join(tabDir, tabID);
        let result: Record<string, string> | null = null;
        for await (const p of split(sourcePath, outputDir, ["bass", "drums", "guitar"])) {
            if (p.phase === "done" && p.result) {
                result = p.result;
            } else {
                postProgress({ type: "progress", phase: p.phase, current: p.current, total: p.total, etaMs: p.etaMs, message: "" });
            }
        }
        if (!result) {
            throw new Error("Separation finished without producing a result");
        }
        return result;
    } catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        console.error(`[separate] Job failed in worker: ${error}`);
        post({ type: "error", error, elapsedMs: performance.now() - startedAt });
        throw err;
    }
}

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
