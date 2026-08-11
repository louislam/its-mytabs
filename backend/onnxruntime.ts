// ONNX Runtime is downloaded from npm at runtime (instead of being a static
// dependency) so that `deno compile` does not bundle ~270 MB of native
// binaries. It is installed into DATA_DIR/onnxruntime-node and loaded via a
// dynamic `await import()` when the first separation starts.
import { UntarStream } from "@std/tar";
import * as path from "@std/path";
import { dataDir } from "./util.ts";
import { pathToFileURL } from "node:url";

const ortVersion = "1.27.0";

export const ortVersionLabel = "onnxruntime-node v" + ortVersion;
/** Approximate size of the onnxruntime-node npm tarball, for the download consent dialog. */
export const ortDownloadSizeMB = 96;

export const ortDir = path.join(dataDir, "onnxruntime-node");
const pkgDir = path.join(ortDir, "node_modules", "onnxruntime-node");
const commonDir = path.join(ortDir, "node_modules", "onnxruntime-common");
const mainJS = path.join(pkgDir, "dist", "index.js");

// Deno does not apply the package.json "type": "commonjs" rule to plain
// file:// imports, so the CJS entry is loaded through this ESM wrapper using
// createRequire() (require() always follows Node's CJS semantics).
const loaderFile = "loader.mjs";
const loaderContent = `import { createRequire } from "node:module";\n` +
    `const require = createRequire(import.meta.url);\n` +
    `const ort = require("./dist/index.js");\n` +
    `export default ort;\n`;

const ortTarballURL = `https://registry.npmjs.org/onnxruntime-node/-/onnxruntime-node-${ortVersion}.tgz`;
const commonTarballURL = `https://registry.npmjs.org/onnxruntime-common/-/onnxruntime-common-${ortVersion}.tgz`;

/** Whether the ONNX Runtime package is installed in the data dir. */
export function isOrtInstalled(): boolean {
    return fsExists(mainJS);
}

function fsExists(p: string): boolean {
    try {
        Deno.statSync(p);
        return true;
    } catch {
        return false;
    }
}

// Minimal type surface for the parts of onnxruntime-node used by converter.ts.
// (The real package is downloaded at runtime, so its full type definitions are
// not available at compile time.)
export interface OrtTensor {
    data: ArrayBufferView;
    type: string;
    dims: number[];
}

export interface OrtSessionOptions {
    executionProviders?: string[];
    enableCpuMemArena?: boolean;
}

export interface OrtInferenceSession {
    inputNames: string[];
    outputNames: string[];
    run(feeds: Record<string, OrtTensor>): Promise<Record<string, OrtTensor>>;
}

export interface OrtModule {
    InferenceSession: {
        create(path: string, options?: OrtSessionOptions): Promise<OrtInferenceSession>;
    };
    Tensor: new (type: string, data: ArrayBufferView, dims: number[]) => OrtTensor;
    env: { versions: { node: string } };
}

/** Shared state so the runtime package is only loaded once. */
let ortModule: unknown = null;

/**
 * Dynamically import the locally installed onnxruntime-node package.
 * Throws if it is not installed yet.
 */
export async function loadOrt(): Promise<OrtModule> {
    if (!ortModule) {
        if (!isOrtInstalled()) {
            throw new Error(
                `ONNX Runtime is not installed yet. Download it first (${ortVersionLabel}, ~${ortDownloadSizeMB} MB).`,
            );
        }
        const loaderPath = path.join(pkgDir, loaderFile);
        if (!fsExists(loaderPath)) {
            Deno.writeTextFileSync(loaderPath, loaderContent);
        }
        const m = await import(pathToFileURL(loaderPath).href) as { default: OrtModule };
        ortModule = m.default;
    }
    return ortModule as OrtModule;
}

interface DownloadProgress {
    /** Bytes downloaded so far. */
    current: number;
    /** Total bytes, 0 if unknown. */
    total: number;
}

/**
 * Download + extract the onnxruntime-node and onnxruntime-common npm packages
 * into DATA_DIR/onnxruntime-node. Reports download progress via onProgress.
 *
 * The tarballs are extracted as-is (package/ -> node_modules/onnxruntime-node),
 * then a loader.mjs wrapper is written so the CommonJS entry can be imported
 * via createRequire() (Deno ignores package.json "type" for file:// imports).
 */
export async function installOrt(onProgress?: (p: DownloadProgress) => void): Promise<void> {
    await downloadAndExtract(ortTarballURL, ortDir, "onnxruntime-node", onProgress);
    await downloadAndExtract(commonTarballURL, ortDir, "onnxruntime-common", onProgress);
    Deno.writeTextFileSync(path.join(pkgDir, loaderFile), loaderContent);
}

async function downloadAndExtract(
    url: string,
    targetDir: string,
    pkgName: string,
    onProgress?: (p: DownloadProgress) => void,
): Promise<void> {
    const res = await fetch(url);
    if (!res.ok || !res.body) {
        throw new Error(`Failed to download ${pkgName}: HTTP ${res.status}`);
    }
    const total = parseInt(res.headers.get("content-length") || "0", 10) || 0;
    let downloaded = 0;

    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
            chunks.push(value);
            downloaded += value.length;
            onProgress?.({ current: downloaded, total });
        }
    }
    const bytes = new Uint8Array(downloaded);
    let offset = 0;
    for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.length;
    }

    // Extract (npm tarballs prefix every entry with "package/")
    const outDir = path.join(targetDir, "node_modules", pkgName);
    const stream = new Blob([bytes]).stream()
        .pipeThrough(new DecompressionStream("gzip"))
        .pipeThrough(new UntarStream());
    for await (const entry of stream) {
        if (!entry.readable) {
            // Directories / symlinks; only regular files are needed
            continue;
        }
        const rel = entry.path.replace(/^package\//, "");
        const out = path.join(outDir, rel);
        await Deno.mkdir(path.dirname(out), { recursive: true });
        await entry.readable.pipeTo((await Deno.create(out)).writable);
    }
}
