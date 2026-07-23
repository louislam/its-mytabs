import * as fs from "@std/fs";
import * as path from "jsr:@std/path";
import { supportedAudioFormatList } from "./common.ts";

/**
 * The library dir is intentionally NOT defaulted to a fixed path (e.g. "/app/library").
 * If LIBRARY_DIR isn't set, the feature is considered "not configured" rather than pointing
 * at a path that happens not to exist - this lets the frontend tell the two cases apart.
 */
export function getLibraryDir(): string | undefined {
    const dir = Deno.env.get("LIBRARY_DIR");
    return dir && dir.trim() !== "" ? dir : undefined;
}

export const libraryDir = getLibraryDir();

export interface LibraryStatus {
    configured: boolean;
    path: string | null;
    exists: boolean;
}

/**
 * Used by the frontend to decide what to show in the Tree's empty slot:
 * - not configured at all
 * - configured, but the path doesn't exist (e.g. drive not mounted)
 * - configured and exists (browsing proceeds as normal, possibly landing on an empty dir)
 */
export async function getLibraryStatus(): Promise<LibraryStatus> {
    if (!libraryDir) {
        return { configured: false, path: null, exists: false };
    }

    let exists = false;
    try {
        const stat = await Deno.stat(libraryDir);
        exists = stat.isDirectory;
    } catch {
        exists = false;
    }

    return { configured: true, path: libraryDir, exists };
}

/**
 * Resolve a path relative to the library root, guarding against escaping it (e.g. "../../etc").
 */
export function resolveLibraryPath(relativePath: string): string {
    const libraryRoot = getLibraryDir();
    if (!libraryRoot) {
        throw new Error("Library not configured");
    }
    const root = path.resolve(libraryRoot);
    const resolved = path.resolve(root, path.normalize(relativePath || "."));
    if (resolved !== root && !resolved.startsWith(root + path.SEPARATOR)) {
        throw new Error("Invalid path");
    }
    return resolved;
}

/**
 * Validate that an already-absolute path (e.g. one stored in config.json) actually lives
 * inside the configured library root.
 */
export function isLibraryPath(filename: string): boolean {
    if (!libraryDir || !path.isAbsolute(filename)) {
        return false;
    }
    const root = path.resolve(libraryDir);
    const resolved = path.resolve(filename);
    return resolved === root || resolved.startsWith(root + path.SEPARATOR);
}

export interface LibraryEntry {
    name: string;
    type: "dir" | "file";
}

/**
 * List the immediate contents of a library directory: subfolders, and only files with a
 * supported audio extension (.mp3, .ogg, .flac).
 */
export async function listLibraryDir(relativePath: string): Promise<LibraryEntry[]> {
    const dirPath = resolveLibraryPath(relativePath);
    const entries: LibraryEntry[] = [];

    for await (const entry of Deno.readDir(dirPath)) {
	if (entry.name.startsWith(".")) {
	    continue; // Keep hidden files hidden.
	}
        if (entry.isDirectory) {
            entries.push({ name: entry.name, type: "dir" });
        } else {
            const ext = entry.name.split(".").pop()?.toLowerCase();
            if (ext && supportedAudioFormatList.includes(ext)) {
                entries.push({ name: entry.name, type: "file" });
            }
        }
    }

    entries.sort((a, b) => a.type === b.type ? a.name.localeCompare(b.name) : a.type === "dir" ? -1 : 1);
    return entries;
}

export async function fileExists(absPath: string): Promise<boolean> {
    return await fs.exists(absPath);
}
