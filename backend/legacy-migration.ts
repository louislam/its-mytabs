import * as fs from "@std/fs";
import * as path from "@std/path";
import { supportedAudioFormatList, supportedFormatList } from "./common.ts";
import { db } from "./db.ts";
import { upsertArtist, upsertLegacyTabConfig, upsertLibraryTab, upsertSong, upsertTabFile, upsertTabFileSource } from "./library.ts";
import { storeLibraryFile } from "./storage.ts";
import { ConfigJSON, ConfigJSONSchema } from "./zod.ts";
import { checkFilename, tabDir } from "./util.ts";

export type LegacyTabReadStatus = "valid" | "missing_config" | "malformed_config" | "missing_tab_file";

export interface LegacyTabReadResult {
    status: LegacyTabReadStatus;
    id: string;
    folderPath: string;
    config?: ConfigJSON;
    tabFilePath?: string;
    audioFiles: string[];
    error?: string;
}

export interface LegacyLibraryMigrationResult {
    scanned: number;
    migrated: number;
    skipped: number;
    failed: number;
    details: LegacyTabMigrationDetail[];
}

export interface LegacyTabMigrationDetail {
    id: string;
    status: "migrated" | "skipped" | "failed";
    reason?: LegacyTabReadStatus | string;
}

export async function readLegacyTabConfig(id: string, rootTabDir = tabDir): Promise<LegacyTabReadResult> {
    checkFilename(id);

    const folderPath = path.join(rootTabDir, id);
    const configPath = path.join(folderPath, "config.json");
    if (!await fs.exists(configPath)) {
        return {
            status: "missing_config",
            id,
            folderPath,
            audioFiles: [],
        };
    }

    let config: ConfigJSON;
    try {
        config = ConfigJSONSchema.parse(JSON.parse(await Deno.readTextFile(configPath)));
    } catch (error) {
        return {
            status: "malformed_config",
            id,
            folderPath,
            audioFiles: [],
            error: error instanceof Error ? error.message : String(error),
        };
    }

    config.tab.id = id;
    if (!isSupportedTabFilename(config.tab.filename)) {
        return {
            status: "missing_tab_file",
            id,
            folderPath,
            config,
            audioFiles: await findAudioFiles(folderPath),
            error: "Unsupported tab filename",
        };
    }

    const tabFilePath = path.join(folderPath, config.tab.filename);
    if (!await fs.exists(tabFilePath)) {
        const fallback = await findTabFile(folderPath);
        if (!fallback) {
            return {
                status: "missing_tab_file",
                id,
                folderPath,
                config,
                audioFiles: await findAudioFiles(folderPath),
            };
        }
        config.tab.filename = fallback;
        return {
            status: "valid",
            id,
            folderPath,
            config,
            tabFilePath: path.join(folderPath, fallback),
            audioFiles: await findAudioFiles(folderPath),
        };
    }

    return {
        status: "valid",
        id,
        folderPath,
        config,
        tabFilePath,
        audioFiles: await findAudioFiles(folderPath),
    };
}

export async function migrateLegacyTabsToLibrary(rootTabDir = tabDir): Promise<LegacyLibraryMigrationResult> {
    const result: LegacyLibraryMigrationResult = {
        scanned: 0,
        migrated: 0,
        skipped: 0,
        failed: 0,
        details: [],
    };

    if (!await fs.exists(rootTabDir)) {
        return result;
    }

    for await (const entry of Deno.readDir(rootTabDir)) {
        if (!entry.isDirectory || entry.name === "deleted") {
            continue;
        }

        result.scanned++;
        let readResult: LegacyTabReadResult;
        try {
            readResult = await readLegacyTabConfig(entry.name, rootTabDir);
        } catch (error) {
            result.failed++;
            result.details.push({
                id: entry.name,
                status: "failed",
                reason: error instanceof Error ? error.message : String(error),
            });
            continue;
        }
        if (readResult.status !== "valid") {
            result.skipped++;
            result.details.push({ id: entry.name, status: "skipped", reason: readResult.status });
            continue;
        }

        try {
            await migrateLegacyTab(readResult);
            result.migrated++;
            result.details.push({ id: entry.name, status: "migrated" });
        } catch (error) {
            result.failed++;
            result.details.push({
                id: entry.name,
                status: "failed",
                reason: error instanceof Error ? error.message : String(error),
            });
        }
    }

    return result;
}

async function migrateLegacyTab(readResult: LegacyTabReadResult): Promise<void> {
    if (readResult.status !== "valid" || !readResult.config || !readResult.tabFilePath) {
        throw new Error("Legacy tab is not valid");
    }

    const config = readResult.config;
    const ext = path.extname(config.tab.filename).slice(1).toLowerCase();
    const stored = await storeFileFromPath(readResult.tabFilePath, ext);
    const tabFile = upsertTabFile(stored);
    upsertTabFileSource({
        tabFileId: tabFile.id,
        sourceType: "legacy-tab",
        sourcePath: readResult.tabFilePath,
        originalFilename: config.tab.originalFilename,
        metadata: {
            legacyTabId: config.tab.id,
            legacyFilename: config.tab.filename,
            audioFiles: readResult.audioFiles,
            youtubeCount: config.youtube.length,
            audioConfigCount: config.audio.length,
        },
    });

    const artist = upsertArtist(config.tab.artist || "Unknown Artist");
    const song = upsertSong(artist.id, config.tab.title);
    const version = getExistingTabVersion(config.tab.id) ?? getNextVersionForSong(song.id);
    const tab = upsertLibraryTab({
        id: config.tab.id,
        songId: song.id,
        tabFileId: tabFile.id,
        version,
        title: config.tab.title,
        artist: config.tab.artist,
        filename: config.tab.filename,
        originalFilename: config.tab.originalFilename,
        public: config.tab.public,
        fav: config.tab.fav,
        createdAt: config.tab.createdAt,
    });
    upsertLegacyTabConfig(tab.id, config);
}

async function storeFileFromPath(sourcePath: string, ext: string): Promise<{ sha256: string; byteSize: number; ext: string; storedPath: string }> {
    const file = await Deno.open(sourcePath, { read: true });
    const stored = await storeLibraryFile(file.readable, ext);
    return {
        sha256: stored.sha256,
        byteSize: stored.byteSize,
        ext: stored.ext,
        storedPath: stored.storedPath,
    };
}

function getExistingTabVersion(tabId: string): number | null {
    const row = db.prepare("SELECT version FROM tabs WHERE id = ?").get(tabId) as { version: number | bigint } | undefined;
    if (!row) {
        return null;
    }
    return typeof row.version === "bigint" ? Number(row.version) : row.version;
}

function getNextVersionForSong(songId: number): number {
    const row = db.prepare("SELECT COALESCE(MAX(version), 0) + 1 AS version FROM tabs WHERE song_id = ?").get(songId) as { version: number | bigint } | undefined;
    if (!row) {
        return 1;
    }
    return typeof row.version === "bigint" ? Number(row.version) : row.version;
}

async function findTabFile(dirPath: string): Promise<string | null> {
    for await (const entry of Deno.readDir(dirPath)) {
        if (!entry.isFile || !isSupportedTabFilename(entry.name)) {
            continue;
        }
        return entry.name;
    }
    return null;
}

async function findAudioFiles(dirPath: string): Promise<string[]> {
    const audioFiles: string[] = [];
    for await (const entry of Deno.readDir(dirPath)) {
        if (!entry.isFile) {
            continue;
        }
        const ext = path.extname(entry.name).slice(1).toLowerCase();
        if (supportedAudioFormatList.includes(ext)) {
            audioFiles.push(entry.name);
        }
    }
    return audioFiles.sort((a, b) => a.localeCompare(b));
}

function isSupportedTabFilename(filename: string): boolean {
    if (filename.includes("/") || filename.includes("\\") || filename.includes("..") || filename.trim() === "") {
        return false;
    }
    const ext = path.extname(filename).slice(1).toLowerCase();
    return supportedFormatList.includes(ext);
}
