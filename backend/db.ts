import * as fs from "@std/fs";
import { DatabaseSync } from "node:sqlite";
import * as path from "@std/path";
import { dataDir, getSourceDir, isDemoMode, tabDir } from "./util.ts";
import { getNextTabID } from "./tab.ts";
import { AudioDataSchema, ConfigJSONSchema, TabInfoSchema, YoutubeSchema } from "./zod.ts";

let dbPath = path.join(dataDir, "config.db");

let isInitDatabase = false;

if (!await fs.exists(dbPath)) {
    isInitDatabase = true;
    await Deno.copyFile(path.join(getSourceDir(), "./extra/config-template.db"), dbPath);
}

export const db = new DatabaseSync(dbPath);
export const kv = await Deno.openKv(dbPath);

await migrateLibrarySchema();

if (isInitDatabase) {
    await addDemoTab();
}

export function isInitDB() {
    return isInitDatabase;
}

export function hasUser() {
    // For demo mode, always return true
    if (isDemoMode) {
        return true;
    }

    const row = db.prepare("SELECT COUNT(*) as count FROM user").get();
    if (!row) {
        throw new Error("User table not found");
    }
    if (typeof row.count !== "number") {
        throw new Error("Invalid count value");
    }
    return row.count > 0;
}

export async function migrateLibrarySchema() {
    const migrationId = "2026-06-28-library-schema";
    const appliedAt = new Date().toISOString();

    db.exec(`
        CREATE TABLE IF NOT EXISTS library_migrations (
            id TEXT PRIMARY KEY,
            applied_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS artists (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            normalized_name TEXT NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            UNIQUE(normalized_name)
        );

        CREATE TABLE IF NOT EXISTS artist_aliases (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            artist_id INTEGER NOT NULL,
            alias TEXT NOT NULL,
            normalized_alias TEXT NOT NULL,
            created_at TEXT NOT NULL,
            UNIQUE(normalized_alias),
            UNIQUE(artist_id, normalized_alias),
            FOREIGN KEY (artist_id) REFERENCES artists(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS albums (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            artist_id INTEGER NOT NULL,
            title TEXT NOT NULL,
            normalized_title TEXT NOT NULL,
            release_year INTEGER,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            UNIQUE(artist_id, normalized_title),
            FOREIGN KEY (artist_id) REFERENCES artists(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS songs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            artist_id INTEGER NOT NULL,
            album_id INTEGER,
            preferred_tab_id TEXT,
            title TEXT NOT NULL,
            normalized_title TEXT NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            FOREIGN KEY (artist_id) REFERENCES artists(id) ON DELETE CASCADE,
            FOREIGN KEY (album_id) REFERENCES albums(id) ON DELETE SET NULL,
            FOREIGN KEY (preferred_tab_id) REFERENCES tabs(id) ON DELETE SET NULL
        );

        CREATE TABLE IF NOT EXISTS tab_files (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            sha256 TEXT NOT NULL,
            byte_size INTEGER NOT NULL CHECK(byte_size >= 0),
            ext TEXT NOT NULL,
            stored_path TEXT NOT NULL,
            created_at TEXT NOT NULL,
            UNIQUE(sha256),
            UNIQUE(stored_path),
            CHECK(length(sha256) = 64)
        );

        CREATE TABLE IF NOT EXISTS tabs (
            id TEXT PRIMARY KEY,
            song_id INTEGER NOT NULL,
            tab_file_id INTEGER,
            version INTEGER NOT NULL DEFAULT 1 CHECK(version > 0),
            version_label TEXT,
            title TEXT NOT NULL,
            artist TEXT NOT NULL DEFAULT '',
            album TEXT NOT NULL DEFAULT '',
            filename TEXT NOT NULL DEFAULT 'tab.gp',
            original_filename TEXT NOT NULL DEFAULT 'Unknown',
            public INTEGER NOT NULL DEFAULT 0 CHECK(public IN (0, 1)),
            fav INTEGER NOT NULL DEFAULT 0 CHECK(fav IN (0, 1)),
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            deleted_at TEXT,
            UNIQUE(song_id, version),
            FOREIGN KEY (song_id) REFERENCES songs(id) ON DELETE CASCADE,
            FOREIGN KEY (tab_file_id) REFERENCES tab_files(id) ON DELETE SET NULL
        );

        CREATE TABLE IF NOT EXISTS tab_file_sources (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            tab_file_id INTEGER NOT NULL,
            source_type TEXT NOT NULL,
            source_path TEXT NOT NULL,
            original_filename TEXT NOT NULL DEFAULT '',
            imported_at TEXT NOT NULL,
            metadata_json TEXT NOT NULL DEFAULT '{}',
            UNIQUE(tab_file_id, source_type, source_path),
            FOREIGN KEY (tab_file_id) REFERENCES tab_files(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS import_jobs (
            id TEXT PRIMARY KEY,
            source_type TEXT NOT NULL,
            root_path TEXT,
            copy_mode TEXT NOT NULL DEFAULT 'copy',
            grouping_mode TEXT NOT NULL DEFAULT 'auto',
            status TEXT NOT NULL CHECK(status IN ('created', 'scanning', 'ready_for_review', 'committing', 'completed', 'failed', 'canceled')),
            total_count INTEGER NOT NULL DEFAULT 0 CHECK(total_count >= 0),
            imported_count INTEGER NOT NULL DEFAULT 0 CHECK(imported_count >= 0),
            skipped_count INTEGER NOT NULL DEFAULT 0 CHECK(skipped_count >= 0),
            failed_count INTEGER NOT NULL DEFAULT 0 CHECK(failed_count >= 0),
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            started_at TEXT,
            finished_at TEXT,
            error_message TEXT
        );

        CREATE TABLE IF NOT EXISTS import_items (
            id TEXT PRIMARY KEY,
            job_id TEXT NOT NULL,
            source_path TEXT NOT NULL,
            relative_path TEXT NOT NULL DEFAULT '',
            ext TEXT NOT NULL DEFAULT '',
            byte_size INTEGER CHECK(byte_size IS NULL OR byte_size >= 0),
            sha256 TEXT,
            status TEXT NOT NULL CHECK(status IN ('pending', 'parsing', 'ready', 'committed', 'skipped', 'failed')),
            status_message TEXT,
            parsed_artist TEXT,
            parsed_title TEXT,
            parsed_album TEXT,
            suggested_artist TEXT,
            suggested_title TEXT,
            suggested_album TEXT,
            suggested_version_label TEXT,
            confidence REAL NOT NULL DEFAULT 0 CHECK(confidence >= 0 AND confidence <= 1),
            duplicate_tab_file_id INTEGER,
            probable_duplicate_song_id INTEGER,
            decision TEXT NOT NULL DEFAULT 'import' CHECK(decision IN ('import', 'skip_unsupported', 'skip_exact_duplicate', 'link_duplicate_source', 'keep_as_version', 'split_song', 'manual_skip')),
            selected INTEGER NOT NULL DEFAULT 1 CHECK(selected IN (0, 1)),
            created_tab_id TEXT,
            existing_tab_id TEXT,
            committed_at TEXT,
            commit_error TEXT,
            review_required INTEGER NOT NULL DEFAULT 0 CHECK(review_required IN (0, 1)),
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            UNIQUE(job_id, source_path),
            FOREIGN KEY (job_id) REFERENCES import_jobs(id) ON DELETE CASCADE,
            FOREIGN KEY (duplicate_tab_file_id) REFERENCES tab_files(id) ON DELETE SET NULL,
            FOREIGN KEY (probable_duplicate_song_id) REFERENCES songs(id) ON DELETE SET NULL,
            FOREIGN KEY (created_tab_id) REFERENCES tabs(id) ON DELETE SET NULL,
            FOREIGN KEY (existing_tab_id) REFERENCES tabs(id) ON DELETE SET NULL
        );

        CREATE INDEX IF NOT EXISTS idx_artists_normalized_name ON artists(normalized_name);
        CREATE INDEX IF NOT EXISTS idx_artist_aliases_artist_id ON artist_aliases(artist_id);
        CREATE INDEX IF NOT EXISTS idx_artist_aliases_normalized_alias ON artist_aliases(normalized_alias);
        CREATE INDEX IF NOT EXISTS idx_albums_artist_title ON albums(artist_id, normalized_title);
        CREATE INDEX IF NOT EXISTS idx_songs_artist_title ON songs(artist_id, normalized_title);
        CREATE UNIQUE INDEX IF NOT EXISTS idx_songs_artist_title_no_album ON songs(artist_id, normalized_title) WHERE album_id IS NULL;
        CREATE UNIQUE INDEX IF NOT EXISTS idx_songs_artist_title_album ON songs(artist_id, normalized_title, album_id) WHERE album_id IS NOT NULL;
        CREATE INDEX IF NOT EXISTS idx_songs_album_id ON songs(album_id);
        CREATE INDEX IF NOT EXISTS idx_tabs_song_version ON tabs(song_id, version DESC);
        CREATE INDEX IF NOT EXISTS idx_tabs_public_fav ON tabs(public, fav);
        CREATE INDEX IF NOT EXISTS idx_tabs_tab_file_id ON tabs(tab_file_id);
        CREATE INDEX IF NOT EXISTS idx_tab_files_sha256 ON tab_files(sha256);
        CREATE INDEX IF NOT EXISTS idx_tab_file_sources_source_path ON tab_file_sources(source_path);
        CREATE INDEX IF NOT EXISTS idx_import_items_job_status_selected ON import_items(job_id, status, selected);
        CREATE INDEX IF NOT EXISTS idx_import_items_job_selected ON import_items(job_id, selected);
        CREATE INDEX IF NOT EXISTS idx_import_items_probable_duplicate_song_id ON import_items(job_id, probable_duplicate_song_id);
        CREATE INDEX IF NOT EXISTS idx_import_items_source_path ON import_items(source_path);
        CREATE INDEX IF NOT EXISTS idx_import_items_status_selection ON import_items(status, selected);
    `);

    db.prepare("INSERT OR IGNORE INTO library_migrations (id, applied_at) VALUES (?, ?)").run(migrationId, appliedAt);
}

export async function addDemoTab() {
    try {
        const demoTabPath = path.join(getSourceDir(), "./extra/demo-tab.gp");
        const id = await getNextTabID();
        const dir = path.join(tabDir, id.toString());
        await Deno.mkdir(dir);

        // Copy demo tab file
        await Deno.copyFile(demoTabPath, path.join(dir, "tab.gp"));

        // Create config.json with the new structure
        const configJson = ConfigJSONSchema.parse({
            tab: {
                id: id.toString(),
                title: "Hare no Hi ni (Bass Only)",
                artist: "Reira Ushio",
                filename: "tab.gp",
                originalFilename: "汐れいら-ハレの日に (Bass Only)-09-18-2025.gp",
                createdAt: "2025-09-26T07:29:56.450Z",
                public: isDemoMode,
                fav: false,
            },
            audio: [],
            youtube: [
                {
                    videoID: "VuKSlOT__9s",
                    syncMethod: "simple",
                    simpleSync: 2900,
                    advancedSync: "",
                },
            ],
        });

        const configPath = path.join(dir, "config.json");
        await Deno.writeTextFile(configPath, JSON.stringify(configJson, null, 2));
    } catch (e) {
        console.log("Skip: Failed to add demo tab:", e);
    }
}

export async function migrate() {
    let migratedCount = 0;
    let skippedCount = 0;
    let hasRecord = false;

    const tabIter = kv.list({ prefix: ["tab"] });

    for await (const entry of tabIter) {
        if (!hasRecord) {
            hasRecord = true;
            console.log("Starting migration from KV to config.json...");
        }

        try {
            const key = entry.key;
            // Key format: ["tab", id] where id is a number
            if (key.length !== 2 || key[0] !== "tab") {
                continue;
            }

            const oldId = key[1];
            const id = String(oldId);
            const tabDirPath = path.join(tabDir, id);
            const configPath = path.join(tabDirPath, "config.json");

            // Skip if config.json already exists
            if (await fs.exists(configPath)) {
                console.log(`Skipping tab ${id}: config.json already exists`);
                skippedCount++;
                continue;
            }

            // Skip if directory doesn't exist
            if (!await fs.exists(tabDirPath)) {
                console.log(`Skipping tab ${id}: directory doesn't exist`);
                skippedCount++;
                continue;
            }

            // Parse old tab info
            const oldTabData = entry.value as Record<string, unknown>;
            const tab = TabInfoSchema.parse({
                ...oldTabData,
                id: id, // Convert to string
            });

            // Get youtube entries for this tab
            const youtubeList: ReturnType<typeof YoutubeSchema.parse>[] = [];
            const youtubeIter = kv.list({ prefix: ["youtube", oldId] });
            for await (const ytEntry of youtubeIter) {
                try {
                    const ytData = ytEntry.value as Record<string, unknown>;
                    youtubeList.push(YoutubeSchema.parse(ytData));
                } catch (e) {
                    console.warn(`Failed to parse youtube entry for tab ${id}:`, ytEntry.key, e);
                }
            }

            // Get audio entries for this tab
            const audioList: ReturnType<typeof AudioDataSchema.parse>[] = [];
            const audioIter = kv.list({ prefix: ["audio", oldId] });
            for await (const audioEntry of audioIter) {
                try {
                    const audioData = audioEntry.value as Record<string, unknown>;
                    audioList.push(AudioDataSchema.parse(audioData));
                } catch (e) {
                    console.warn(`Failed to parse audio entry for tab ${id}:`, audioEntry.key, e);
                }
            }

            // Create config.json
            const configJson = ConfigJSONSchema.parse({
                tab,
                audio: audioList,
                youtube: youtubeList,
            });

            await Deno.writeTextFile(configPath, JSON.stringify(configJson, null, 2));
            console.log(`Migrated tab ${id}: ${tab.title} (${youtubeList.length} youtube, ${audioList.length} audio)`);

            // Delete old KV records
            await kv.delete(["tab", oldId]);
            for await (const ytEntry of kv.list({ prefix: ["youtube", oldId] })) {
                await kv.delete(ytEntry.key);
            }
            for await (const audioEntry of kv.list({ prefix: ["audio", oldId] })) {
                await kv.delete(audioEntry.key);
            }

            migratedCount++;
        } catch (e) {
            console.error(`Failed to migrate tab entry:`, entry.key, e);
        }
    }

    if (!hasRecord) {
        return;
    }

    console.log(`Migration complete: ${migratedCount} migrated, ${skippedCount} skipped`);
}
