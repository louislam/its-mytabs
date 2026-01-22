import * as fs from "@std/fs";
import * as path from "@std/path";
import { fileURLToPath } from "node:url";
import childProcess from "node:child_process";
import * as jsonc from "@std/jsonc";
import { FLACDecoder } from "@wasm-audio-decoders/flac";
import { createOggEncoder } from "wasm-media-encoders";
import { supportedAudioFormatList } from "./common.ts";

const denoJSONCPath = path.join(getSourceDir(), "./deno.jsonc");
export const denoJSONC = jsonc.parse(await Deno.readTextFile(denoJSONCPath));
export const isDemoMode = Deno.env.get("MYTABS_DEMO_MODE") === "true";

let version = "unknown";
if (denoJSONC && typeof denoJSONC === "object" && !Array.isArray(denoJSONC) && typeof denoJSONC.version === "string") {
    version = denoJSONC.version;
}

// Parse deno.jsonc
export const appVersion: string = version;

export const host = Deno.env.get("MYTABS_HOST");
export const port = Deno.env.get("MYTABS_PORT") ? parseInt(Deno.env.get("MYTABS_PORT")!) : 47777;

export async function getDataDir() {
    let dataDir = Deno.env.get("DATA_DIR") || "./data";
    await fs.ensureDir(dataDir);
    return dataDir;
}

export const dataDir = await getDataDir();

export async function getTabDir() {
    let dir = path.join(dataDir, "tabs");
    await fs.ensureDir(dir);
    return dir;
}

export const tabDir = await getTabDir();

export function isDev() {
    return process.env.NODE_ENV === "development";
}

export const devOriginList = [
    "http://127.0.0.1:5173",
    "http://127.0.0.1:5174",
    "http://127.0.0.1:5175",
    "http://localhost:5173",
    "http://localhost:5174",
    "http://localhost:5175",
];

export function getFrontendDir(): string {
    return path.join(getSourceDir(), "./dist");
}

/**
 * After compiled, some files are inside the executable, so the path is different
 */
export function getSourceDir(): string {
    if (Deno.build.standalone) {
        // `..` go up one leve is the root. In case this file moved to another folder in the future, be careful
        return path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
    } else {
        return "./";
    }
}

/**
 * For cmd.exe's start command, escape the string
 * @param str
 */
export function escapeString(str: string) {
    return `"${str.replace(/"/g, '""')}"`;
}

export function start(path: string) {
    if (Deno.build.os === "windows") {
        const escapedPath = escapeString(path);
        childProcess.exec(`start "" ${escapedPath}`);
    }
}

export async function flacToOgg(audioFileData: Uint8Array) {
    const decoder = new FLACDecoder();
    try {
        await decoder.ready;

        // Decode the entire FLAC file
        const decoded = await decoder.decodeFile(audioFileData);

        if (!decoded || !decoded.channelData || decoded.channelData.length === 0) {
            throw new Error("Failed to decode FLAC: no audio data");
        }

        const { channelData, sampleRate } = decoded;
        const channels: 1 | 2 = channelData.length === 2 ? 2 : 1;

        // Create OGG encoder (Note: encoder doesn't require explicit cleanup, managed by GC)
        const encoder = await createOggEncoder();
        encoder.configure({
            sampleRate: sampleRate,
            channels: channels,
            // OGG Vorbis quality setting: 8 ≈ 256kbps for stereo
            vbrQuality: 8,
        });

        // Collect all encoded OGG data
        const oggChunks: Uint8Array[] = [];

        // Encode the PCM data
        const encoded = encoder.encode(channelData);
        if (encoded.length > 0) {
            // Copy the data as it's owned by the encoder
            oggChunks.push(new Uint8Array(encoded));
        }

        // Finalize encoding
        const finalChunk = encoder.finalize();
        if (finalChunk.length > 0) {
            oggChunks.push(new Uint8Array(finalChunk));
        }

        // Combine all chunks into single buffer
        const totalLength = oggChunks.reduce((sum, chunk) => sum + chunk.length, 0);
        const oggData = new Uint8Array(totalLength);
        let offset = 0;
        for (const chunk of oggChunks) {
            oggData.set(chunk, offset);
            offset += chunk.length;
        }

        return oggData;
    } catch (error) {
        console.error("FLAC to OGG conversion failed:", error);
        throw new Error(`Failed to convert FLAC to OGG: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
        // Always free decoder resources
        decoder.free();
    }
}

/**
 * Check if filename has supported audio format, throw error if not
 */
export function checkAudioFormat(filename: string): void {
    const ext = path.extname(filename).slice(1).toLowerCase();
    if (!supportedAudioFormatList.includes(ext)) {
        throw new Error("Unsupported audio format");
    }
}

export function checkFilename(filename: string): void {
    // No path traversal
    if (filename.includes("..") || filename.includes("/") || filename.includes("\\")) {
        throw new Error("Invalid filename");
    }
}
