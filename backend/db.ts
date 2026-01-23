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
    console.log("Starting migration from KV to config.json...");

    let migratedCount = 0;
    let skippedCount = 0;

    // Iterate over all tab entries in KV
    const tabIter = kv.list({ prefix: ["tab"] });

    for await (const entry of tabIter) {
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

    console.log(`Migration complete: ${migratedCount} migrated, ${skippedCount} skipped`);
}
