import * as fs from "@std/fs";
import * as path from "@std/path";
import { createHash } from "node:crypto";
import { db } from "./db.ts";
import { dataDir } from "./util.ts";

type SqlValue = string | number | bigint | null;
type SqlRow = Record<string, SqlValue>;

export interface StoredLibraryFile {
    sha256: string;
    byteSize: number;
    ext: string;
    storedPath: string;
    absolutePath: string;
}

export interface StorageIntegrityReport {
    missingFiles: Array<{
        tabFileId: number;
        sha256: string;
        storedPath: string;
    }>;
    orphanedFiles: Array<{
        storedPath: string;
        absolutePath: string;
    }>;
}

export interface CleanupTempFilesResult {
    removed: string[];
    skipped: string[];
}

const libraryDir = path.join(dataDir, "library");
const libraryFilesDir = path.join(libraryDir, "files");
const libraryTmpDir = path.join(libraryDir, "tmp");

export function getLibraryStorageDir(): string {
    return libraryDir;
}

export function getLibraryFilesDir(): string {
    return libraryFilesDir;
}

export function getLibraryTmpDir(): string {
    return libraryTmpDir;
}

export async function storeLibraryFile(data: Uint8Array | ReadableStream<Uint8Array>, ext: string): Promise<StoredLibraryFile> {
    await fs.ensureDir(libraryTmpDir);

    const normalizedExt = normalizeStorageExt(ext);
    const tmpPath = path.join(libraryTmpDir, `${crypto.randomUUID()}.tmp`);
    const hash = createHash("sha256");
    let byteSize = 0;

    const file = await Deno.open(tmpPath, { createNew: true, write: true });
    const writer = file.writable.getWriter();

    try {
        const stream = data instanceof Uint8Array ? readableFromBytes(data) : data;
        const reader = stream.getReader();
        while (true) {
            const { done, value } = await reader.read();
            if (done) {
                break;
            }
            hash.update(value);
            byteSize += value.byteLength;
            await writer.write(value);
        }
        await writer.close();
    } catch (error) {
        try {
            await writer.abort(error);
        } catch {
            // ignore abort failures and remove the temp file below
        }
        await removeIfExists(tmpPath);
        throw error;
    }

    const sha256 = hash.digest("hex");
    const storedPath = getStoredPathForHash(sha256, normalizedExt);
    const absolutePath = resolveStoredPath(storedPath);
    await fs.ensureDir(path.dirname(absolutePath));

    if (await fs.exists(absolutePath)) {
        await removeIfExists(tmpPath);
    } else {
        try {
            await Deno.rename(tmpPath, absolutePath);
        } catch (error) {
            if (error instanceof Deno.errors.AlreadyExists) {
                await removeIfExists(tmpPath);
            } else {
                await removeIfExists(tmpPath);
                throw error;
            }
        }
    }

    return {
        sha256,
        byteSize,
        ext: normalizedExt,
        storedPath,
        absolutePath,
    };
}

export async function hashReadableStream(readable: ReadableStream<Uint8Array>): Promise<{ sha256: string; byteSize: number }> {
    const hash = createHash("sha256");
    let byteSize = 0;
    const reader = readable.getReader();

    while (true) {
        const { done, value } = await reader.read();
        if (done) {
            break;
        }
        hash.update(value);
        byteSize += value.byteLength;
    }

    return {
        sha256: hash.digest("hex"),
        byteSize,
    };
}

export function getStoredPathForHash(sha256: string, ext: string): string {
    const normalizedHash = sha256.toLowerCase();
    if (!/^[a-f0-9]{64}$/.test(normalizedHash)) {
        throw new Error("Invalid SHA-256 hash");
    }

    const normalizedExt = normalizeStorageExt(ext);
    return path.join("files", normalizedHash.slice(0, 2), `${normalizedHash}.${normalizedExt}`).replaceAll(path.SEPARATOR, "/");
}

export function resolveStoredPath(storedPath: string): string {
    if (path.isAbsolute(storedPath) || storedPath.includes("\\") || storedPath.trim() === "") {
        throw new Error("Invalid stored path");
    }

    const root = path.resolve(libraryDir);
    const resolved = path.resolve(root, storedPath);
    if (resolved !== root && !resolved.startsWith(root + path.SEPARATOR)) {
        throw new Error("Stored path escapes library storage");
    }

    return resolved;
}

export async function checkStorageIntegrity(): Promise<StorageIntegrityReport> {
    const rows = db.prepare("SELECT id, sha256, stored_path FROM tab_files").all() as SqlRow[];
    const storedPaths = new Set<string>();
    const missingFiles: StorageIntegrityReport["missingFiles"] = [];

    for (const row of rows) {
        const storedPath = readString(row, "stored_path");
        storedPaths.add(storedPath);
        if (!await fs.exists(resolveStoredPath(storedPath))) {
            missingFiles.push({
                tabFileId: readNumber(row, "id"),
                sha256: readString(row, "sha256"),
                storedPath,
            });
        }
    }

    const orphanedFiles: StorageIntegrityReport["orphanedFiles"] = [];
    if (await fs.exists(libraryFilesDir)) {
        for await (const entry of fs.walk(libraryFilesDir, { includeDirs: false })) {
            if (!entry.isFile) {
                continue;
            }
            const storedPath = toStoredPath(entry.path);
            if (!storedPaths.has(storedPath)) {
                orphanedFiles.push({
                    storedPath,
                    absolutePath: entry.path,
                });
            }
        }
    }

    return {
        missingFiles,
        orphanedFiles,
    };
}

export async function cleanupAbandonedTempFiles(olderThanMs = 24 * 60 * 60 * 1000): Promise<CleanupTempFilesResult> {
    const removed: string[] = [];
    const skipped: string[] = [];
    const cutoff = Date.now() - olderThanMs;

    if (!await fs.exists(libraryTmpDir)) {
        return { removed, skipped };
    }

    for await (const entry of Deno.readDir(libraryTmpDir)) {
        const candidate = path.join(libraryTmpDir, entry.name);
        if (!entry.isFile || !isPathInside(candidate, libraryTmpDir)) {
            skipped.push(candidate);
            continue;
        }

        const stat = await Deno.stat(candidate);
        const modifiedAt = stat.mtime?.getTime() ?? Date.now();
        if (modifiedAt > cutoff) {
            skipped.push(candidate);
            continue;
        }

        await Deno.remove(candidate);
        removed.push(candidate);
    }

    return { removed, skipped };
}

function normalizeStorageExt(ext: string): string {
    const normalizedExt = ext.toLowerCase().trim().replace(/^\./, "");
    if (!/^[a-z0-9]+$/.test(normalizedExt)) {
        throw new Error("Invalid file extension");
    }
    return normalizedExt;
}

function toStoredPath(absolutePath: string): string {
    const relativePath = path.relative(libraryDir, absolutePath);
    return relativePath.split(path.SEPARATOR).join("/");
}

function isPathInside(candidate: string, root: string): boolean {
    const resolvedRoot = path.resolve(root);
    const resolvedCandidate = path.resolve(candidate);
    return resolvedCandidate !== resolvedRoot && resolvedCandidate.startsWith(resolvedRoot + path.SEPARATOR);
}

async function removeIfExists(filePath: string): Promise<void> {
    try {
        await Deno.remove(filePath);
    } catch (error) {
        if (!(error instanceof Deno.errors.NotFound)) {
            throw error;
        }
    }
}

function readableFromBytes(data: Uint8Array): ReadableStream<Uint8Array> {
    return new ReadableStream({
        start(controller) {
            controller.enqueue(data);
            controller.close();
        },
    });
}

function readString(row: SqlRow, key: string): string {
    const value = row[key];
    if (typeof value !== "string") {
        throw new Error(`Expected ${key} to be a string`);
    }
    return value;
}

function readNumber(row: SqlRow, key: string): number {
    const value = row[key];
    if (typeof value === "number") {
        return value;
    }
    if (typeof value === "bigint") {
        return Number(value);
    }
    throw new Error(`Expected ${key} to be a number`);
}
