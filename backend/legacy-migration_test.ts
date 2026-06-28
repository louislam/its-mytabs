import { assertEquals, assertExists } from "jsr:@std/assert@^1.0.17";
import * as fs from "@std/fs";
import * as path from "@std/path";

const tempDir = await Deno.makeTempDir();
Deno.env.set("DATA_DIR", tempDir);
Deno.env.set("MYTABS_PORT", "47781");
Deno.env.set("MYTABS_DEMO_MODE", "false");

const { readLegacyTabConfig, migrateLegacyTabsToLibrary } = await import("./legacy-migration.ts");
const { db, kv } = await import("./db.ts");
const { getLibraryConfigJSON, getLibraryTabInfo } = await import("./library.ts");
const { getConfigJSON } = await import("./tab.ts");
const { tabDir } = await import("./util.ts");

Deno.test("legacy config reader reports valid, missing, malformed, and missing tab file states", async () => {
    await writeLegacyTab("reader-valid", {
        title: "Reader Valid",
        artist: "Reader Artist",
        filename: "tab.gp",
        tabFileContent: "valid tab",
    });
    await fs.ensureDir(path.join(tabDir, "reader-missing-config"));
    await writeMalformedLegacyTab("reader-malformed");
    await writeLegacyTab("reader-missing-tab", {
        title: "Reader Missing Tab",
        artist: "Reader Artist",
        filename: "missing.gp",
        tabFileContent: null,
    });
    await fs.ensureDir(path.join(tabDir, "bad..id"));

    const valid = await readLegacyTabConfig("reader-valid");
    assertEquals(valid.status, "valid");
    assertExists(valid.config);
    assertEquals(valid.config.tab.id, "reader-valid");
    assertEquals(valid.tabFilePath, path.join(tabDir, "reader-valid", "tab.gp"));

    assertEquals((await readLegacyTabConfig("reader-missing-config")).status, "missing_config");
    assertEquals((await readLegacyTabConfig("reader-malformed")).status, "malformed_config");
    assertEquals((await readLegacyTabConfig("reader-missing-tab")).status, "missing_tab_file");

    const migration = await migrateLegacyTabsToLibrary();
    assertEquals(migration.details.some((detail) => detail.id === "bad..id" && detail.status === "failed"), true);
});

Deno.test("legacy migration inserts library rows, preserves ids and visibility, and is idempotent", async () => {
    await writeLegacyTab("migrate-one", {
        title: "Migration Song",
        artist: "Migration Artist",
        filename: "song.gp",
        originalFilename: "Original Song.gp",
        tabFileContent: "migration content",
        public: true,
        fav: true,
    });

    const first = await migrateLegacyTabsToLibrary();
    assertEquals(first.details.some((detail) => detail.id === "migrate-one" && detail.status === "migrated"), true);

    const tab = getLibraryTabInfo("migrate-one");
    assertExists(tab);
    assertEquals(tab.title, "Migration Song");
    assertEquals(tab.artist, "Migration Artist");
    assertEquals(tab.originalFilename, "Original Song.gp");
    assertEquals(tab.public, true);
    assertEquals(tab.fav, true);

    const countAfterFirst = countRows();
    const second = await migrateLegacyTabsToLibrary();
    assertEquals(second.details.some((detail) => detail.id === "migrate-one" && detail.status === "migrated"), true);
    assertEquals(countRows(), countAfterFirst);
});

Deno.test("legacy migration preserves audio and YouTube sync per tab version", async () => {
    await writeLegacyTab("version-a", {
        title: "Shared Song",
        artist: "Shared Artist",
        filename: "version-a.gp",
        tabFileContent: "version a",
        audio: [{ filename: "version-a.mp3", syncMethod: "simple", simpleSync: 1200, advancedSync: "" }],
        youtube: [{ videoID: "video-a", syncMethod: "advanced", simpleSync: 0, advancedSync: "a-sync" }],
        audioFiles: [{ filename: "version-a.mp3", content: "audio a" }],
    });
    await writeLegacyTab("version-b", {
        title: "Shared Song",
        artist: "Shared Artist",
        filename: "version-b.gp",
        tabFileContent: "version b",
        audio: [{ filename: "version-b.mp3", syncMethod: "advanced", simpleSync: 0, advancedSync: "b-audio-sync" }],
        youtube: [{ videoID: "video-b", syncMethod: "simple", simpleSync: 3400, advancedSync: "" }],
        audioFiles: [{ filename: "version-b.mp3", content: "audio b" }],
    });

    await migrateLegacyTabsToLibrary();

    const configA = getLibraryConfigJSON("version-a");
    const configB = getLibraryConfigJSON("version-b");
    assertExists(configA);
    assertExists(configB);
    assertEquals(configA.audio[0].filename, "version-a.mp3");
    assertEquals(configA.audio[0].simpleSync, 1200);
    assertEquals(configA.youtube[0].videoID, "video-a");
    assertEquals(configA.youtube[0].advancedSync, "a-sync");
    assertEquals(configB.audio[0].filename, "version-b.mp3");
    assertEquals(configB.audio[0].advancedSync, "b-audio-sync");
    assertEquals(configB.youtube[0].videoID, "video-b");
    assertEquals(configB.youtube[0].simpleSync, 3400);

    const legacyRouteConfig = await getConfigJSON("version-a");
    assertExists(legacyRouteConfig);
    assertEquals(legacyRouteConfig.audio[0].filename, "version-a.mp3");
});

function countRows() {
    return {
        artists: countTable("artists"),
        songs: countTable("songs"),
        tabFiles: countTable("tab_files"),
        tabFileSources: countTable("tab_file_sources"),
        tabs: countTable("tabs"),
        legacyConfigs: countTable("legacy_tab_configs"),
    };
}

function countTable(tableName: string): number {
    return (db.prepare(`SELECT COUNT(*) AS count FROM ${tableName}`).get() as { count: number }).count;
}

async function writeMalformedLegacyTab(id: string) {
    const dir = path.join(tabDir, id);
    await fs.ensureDir(dir);
    await Deno.writeTextFile(path.join(dir, "config.json"), "{");
}

async function writeLegacyTab(
    id: string,
    input: {
        title: string;
        artist: string;
        filename: string;
        originalFilename?: string;
        tabFileContent: string | null;
        public?: boolean;
        fav?: boolean;
        audio?: Array<{ filename: string; syncMethod: "simple" | "advanced"; simpleSync: number; advancedSync: string }>;
        youtube?: Array<{ videoID: string; syncMethod: "simple" | "advanced"; simpleSync: number; advancedSync: string }>;
        audioFiles?: Array<{ filename: string; content: string }>;
    },
) {
    const dir = path.join(tabDir, id);
    await fs.ensureDir(dir);
    if (input.tabFileContent !== null) {
        await Deno.writeTextFile(path.join(dir, input.filename), input.tabFileContent);
    }
    for (const audioFile of input.audioFiles ?? []) {
        await Deno.writeTextFile(path.join(dir, audioFile.filename), audioFile.content);
    }
    await Deno.writeTextFile(
        path.join(dir, "config.json"),
        JSON.stringify(
            {
                tab: {
                    id,
                    title: input.title,
                    artist: input.artist,
                    filename: input.filename,
                    originalFilename: input.originalFilename ?? input.filename,
                    createdAt: "2026-01-01T00:00:00.000Z",
                    public: input.public ?? false,
                    fav: input.fav ?? false,
                },
                audio: input.audio ?? [],
                youtube: input.youtube ?? [],
            },
            null,
            2,
        ),
    );
}

globalThis.addEventListener("unload", () => {
    kv.close();
    db.close();
});
