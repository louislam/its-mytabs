import { assert, assertEquals, assertExists } from "jsr:@std/assert@^1.0.17";
import * as fs from "@std/fs";
import * as path from "@std/path";

const tempDir = await Deno.makeTempDir();
const dataDir = path.join(tempDir, "data");
Deno.env.set("DATA_DIR", dataDir);
Deno.env.set("MYTABS_PORT", "47781");
Deno.env.set("MYTABS_DEMO_MODE", "false");
Deno.env.set("MYTABS_IMPORT_ROOTS", tempDir);

const {
    bulkUpdateImportItems,
    commitImportJob,
    createImportJob,
    getImportJob,
    getImportReport,
    listImportItems,
    listImportReviewGroups,
    patchImportItem,
    scanImportJob,
} = await import("./import.ts");
const {
    addAudio,
    addYoutube,
    createTab,
    getConfigJSON,
    updateAudio,
    updateYoutube,
} = await import("./tab.ts");
const {
    getAllLibraryTabInfos,
    getLibraryConfigJSON,
    getLibraryTab,
    getLibraryTabInfo,
    getSong,
    setPreferredSongTab,
    upsertAlbum,
    upsertArtist,
    upsertLibraryTab,
    upsertSong,
    upsertTabFile,
} = await import("./library.ts");
const { db, kv, migrateLibrarySchema } = await import("./db.ts");

Deno.test("large synthetic import stays bounded across review, grouping, report, and dashboard queries", () => {
    const jobId = seedLargeSyntheticImport(50_000);
    seedDashboardLibrary(2_000);

    const firstPage = listImportItems(jobId, { limit: 100, offset: 0, sort: "artist-title" });
    assertEquals(firstPage.total, 50_000);
    assertEquals(firstPage.items.length, 100);

    const deepPage = listImportItems(jobId, { limit: 100, offset: 49_900, sort: "source-path" });
    assertEquals(deepPage.items.length, 100);
    assert(deepPage.items.every((item) => item.relativePath.endsWith(".gp") || item.relativePath.endsWith(".txt")));

    const searchPage = listImportItems(jobId, { limit: 50, offset: 0, search: "song-0424", sort: "confidence-desc" });
    assertEquals(searchPage.total, 10);
    assert(searchPage.items.every((item) => item.relativePath.includes("song-0424")));

    const probablePage = listImportItems(jobId, { limit: 50, offset: 0, duplicate: "probable" });
    assertEquals(probablePage.total, 1_000);
    assert(probablePage.items.every((item) => item.probableDuplicateSongId !== null));

    const groups = listImportReviewGroups(jobId, { limit: 200, offset: 0, sort: "album-title" });
    assertEquals(groups.total, 50_000);
    assert(groups.groups.length > 0);
    assert(groups.groups.every((group) => group.items.length > 0));

    const bulk = bulkUpdateImportItems(jobId, {
        allMatching: true,
        filters: { duplicate: "probable" },
        action: "set-decision",
        decision: "manual_skip",
    });
    assertEquals(bulk.updated, 1_000);

    const report = getImportReport(jobId);
    assertEquals(report.totals.imported, 1_250);
    assertEquals(report.totals.skipped, 5_500);
    assertEquals(report.totals.failed, 750);
    assertEquals(report.failedItems.length, 750);

    const allTabs = getAllLibraryTabInfos({ includePrivate: true });
    assert(allTabs.length >= 2_000);
    const publicTabs = getAllLibraryTabInfos({ publicOnly: true });
    assert(publicTabs.every((tab) => tab.public));
    const favTabs = getAllLibraryTabInfos({ favOnly: true });
    assert(favTabs.every((tab) => tab.fav));
});

Deno.test("end-to-end import, migration, version, and sync regression workflow", async () => {
    await migrateLibrarySchema();

    const root = await makeImportRoot("e2e");
    const firstPath = path.join(root, "Workflow Artist", "Workflow Album", "Workflow Artist - Workflow Song.gp");
    const secondPath = path.join(root, "Workflow Artist", "Workflow Album", "Workflow Artist - Workflow Song v2.gp");
    await fs.ensureDir(path.dirname(firstPath));
    await Deno.writeTextFile(firstPath, "workflow first");
    await Deno.writeTextFile(secondPath, "workflow second");
    Deno.env.set("MYTABS_IMPORT_ROOTS", root);

    const existingArtist = upsertArtist("Workflow Artist");
    const existingAlbum = upsertAlbum(existingArtist.id, "Workflow Album");
    const existingSong = upsertSong(existingArtist.id, "Workflow Song", existingAlbum.id);
    const oldFile = upsertTabFile({
        sha256: "c".repeat(64),
        byteSize: 1,
        ext: "gp",
        storedPath: `files/cc/${"c".repeat(64)}.gp`,
    });
    const oldTab = upsertLibraryTab({
        id: "workflow-existing",
        songId: existingSong.id,
        tabFileId: oldFile.id,
        versionLabel: "original",
        public: true,
    });

    const job = await createImportJob({
        sourceType: "server-folder",
        rootPath: root,
        copyMode: "copy",
        groupingMode: "artist-album-song",
    });
    const scanned = await scanImportJob(job.id);
    assertEquals(scanned.status, "ready_for_review");
    assertEquals(scanned.totalCount, 2);

    const firstItem = listImportItems(job.id, { limit: 10, offset: 0, search: "Workflow Song.gp" }).items[0];
    assertExists(firstItem);
    assertEquals(firstItem.probableDuplicateSongId, existingSong.id);
    assertEquals(firstItem.existingTabId, oldTab.id);

    const secondItem = listImportItems(job.id, { limit: 10, offset: 0, search: "v2" }).items[0];
    assertExists(secondItem);
    patchImportItem(job.id, secondItem.id, {
        suggestedArtist: "Workflow Artist",
        suggestedTitle: "Workflow Song",
        suggestedAlbum: "Workflow Album",
        suggestedVersionLabel: "alternate",
        decision: "keep_as_version",
    });

    const committed = await commitImportJob(job.id);
    assertEquals(committed.status, "completed");
    const report = getImportReport(job.id);
    assertEquals(report.totals.imported, 2);
    assertEquals(report.totals.failed, 0);

    const committedItems = listImportItems(job.id, { limit: 10, offset: 0, status: "committed" }).items;
    assertEquals(committedItems.length, 2);
    const createdIds = committedItems.map((item) => item.createdTabId).filter((id): id is string => id !== null);
    assertEquals(createdIds.length, 2);

    const versionedTabs = [oldTab, ...createdIds.map((id) => getLibraryTab(id))].filter((tab) => tab !== null);
    assertEquals(versionedTabs.length, 3);
    assertEquals(versionedTabs.map((tab) => tab.version).sort((a, b) => a - b), [1, 2, 3]);

    const preferred = setPreferredSongTab(existingSong.id, createdIds[1]);
    assertEquals(preferred.preferredTabId, createdIds[1]);
    assertEquals(getSong(existingSong.id)?.preferredTabId, createdIds[1]);

    const config = getLibraryConfigJSON(createdIds[1]);
    assertExists(config);
    assertEquals(config.tab.title, "Workflow Song");
    assertEquals(config.audio, []);
    assertEquals(config.youtube, []);
    assertEquals(getLibraryTabInfo(createdIds[1])?.public, false);

    const legacyId = await createTab(new Uint8Array([1, 2, 3]), "gp", "Legacy Sync", "Workflow Artist", "legacy-sync.gp");
    const legacyConfig = await getConfigJSON(legacyId);
    assertExists(legacyConfig);
    assertEquals(legacyConfig.tab.public, false);

    await addAudio(legacyConfig.tab, new Uint8Array([4, 5, 6]), "sync.mp3");
    await updateAudio(legacyConfig.tab, "sync.mp3", {
        syncMethod: "advanced",
        simpleSync: 1250,
        advancedSync: "0 0\n1000 960",
    });
    await addYoutube(legacyId, "video-123");
    await updateYoutube(legacyId, "video-123", {
        syncMethod: "simple",
        simpleSync: -250,
        advancedSync: "",
    });

    const syncedConfig = await getConfigJSON(legacyId);
    assertExists(syncedConfig);
    assertEquals(syncedConfig.audio[0], {
        filename: "sync.mp3",
        syncMethod: "advanced",
        simpleSync: 1250,
        advancedSync: "0 0\n1000 960",
    });
    assertEquals(syncedConfig.youtube[0], {
        videoID: "video-123",
        syncMethod: "simple",
        simpleSync: -250,
        advancedSync: "",
    });
});

Deno.test.afterAll(async () => {
    kv.close();
    db.close();
    await fs.emptyDir(tempDir);
    await Deno.remove(tempDir);
});

function seedLargeSyntheticImport(total: number): string {
    const now = "2026-06-28T00:00:00.000Z";
    const jobId = "synthetic-large-import";
    const duplicateFile = upsertTabFile({
        sha256: "d".repeat(64),
        byteSize: 32,
        ext: "gp",
        storedPath: `files/dd/${"d".repeat(64)}.gp`,
    });
    const duplicateArtist = upsertArtist("Synthetic Duplicate Artist");
    const duplicateSong = upsertSong(duplicateArtist.id, "Synthetic Duplicate Song");
    const duplicateTab = upsertLibraryTab({
        id: "synthetic-duplicate-tab",
        songId: duplicateSong.id,
        tabFileId: duplicateFile.id,
        public: true,
        fav: true,
    });

    db.prepare(`
        INSERT INTO import_jobs (id, source_type, root_path, copy_mode, grouping_mode, status, total_count, imported_count, skipped_count, failed_count, created_at, updated_at, started_at, finished_at)
        VALUES (?, 'server-folder', ?, 'copy', 'artist-album-song', 'ready_for_review', ?, 1250, 5500, 750, ?, ?, ?, ?)
    `).run(jobId, "/synthetic/import-root", total, now, now, now, now);

    const insert = db.prepare(`
        INSERT INTO import_items (
            id, job_id, source_path, relative_path, ext, byte_size, sha256, status, status_message,
            parsed_artist, parsed_title, parsed_album, suggested_artist, suggested_title, suggested_album, suggested_version_label,
            confidence, duplicate_tab_file_id, probable_duplicate_song_id, decision, selected, created_tab_id, existing_tab_id, committed_at, commit_error, review_required, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    db.exec("BEGIN");
    try {
        for (let index = 0; index < total; index++) {
            const artist = `Artist ${String(index % 250).padStart(3, "0")}`;
            const album = `Album ${String(index % 50).padStart(3, "0")}`;
            const title = `Song ${String(index).padStart(5, "0")}`;
            const relativePath = `artist-${String(index % 250).padStart(3, "0")}/album-${String(index % 50).padStart(3, "0")}/song-${String(index).padStart(5, "0")}.gp`;
            const exactDuplicate = index % 100 === 0;
            const probableDuplicate = index % 50 === 1;
            const committed = index < 1_250;
            const skipped = index >= 1_250 && index < 6_750;
            const failed = index >= 6_750 && index < 7_500;
            const unsupported = skipped && index % 2 === 0;
            const status = committed ? "committed" : skipped ? "skipped" : failed ? "failed" : "ready";
            const decision = unsupported ? "skip_unsupported" : exactDuplicate ? "link_duplicate_source" : probableDuplicate ? "keep_as_version" : "import";
            insert.run(
                `synthetic-item-${String(index).padStart(5, "0")}`,
                jobId,
                `/synthetic/import-root/${relativePath}`,
                relativePath,
                unsupported ? "txt" : "gp",
                128 + (index % 4096),
                unsupported ? null : deterministicHash(index),
                status,
                failed ? "Parser metadata unavailable: synthetic parse failure" : unsupported ? 'Unsupported import format ".txt".' : null,
                null,
                null,
                null,
                artist,
                title,
                album,
                index % 17 === 0 ? `version ${index % 5 + 1}` : null,
                index % 7 === 0 ? 0.6 : 0.92,
                exactDuplicate ? duplicateFile.id : null,
                probableDuplicate ? duplicateSong.id : null,
                decision,
                skipped ? 0 : 1,
                committed ? duplicateTab.id : null,
                probableDuplicate ? duplicateTab.id : null,
                committed || skipped ? now : null,
                failed ? "Synthetic commit failure" : null,
                index % 7 === 0 || probableDuplicate ? 1 : 0,
                now,
                now,
            );
        }
        db.exec("COMMIT");
    } catch (error) {
        db.exec("ROLLBACK");
        throw error;
    }

    return jobId;
}

function seedDashboardLibrary(total: number): void {
    const now = "2026-06-28T00:00:00.000Z";
    const artistInsert = db.prepare(`
        INSERT INTO artists (id, name, normalized_name, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
    `);
    const songInsert = db.prepare(`
        INSERT INTO songs (id, artist_id, album_id, preferred_tab_id, title, normalized_title, created_at, updated_at)
        VALUES (?, ?, NULL, NULL, ?, ?, ?, ?)
    `);
    const tabInsert = db.prepare(`
        INSERT INTO tabs (id, song_id, tab_file_id, version, version_label, title, artist, album, filename, original_filename, public, fav, created_at, updated_at)
        VALUES (?, ?, NULL, 1, NULL, ?, ?, '', 'tab.gp', ?, ?, ?, ?, ?)
    `);

    db.exec("BEGIN");
    try {
        for (let index = 0; index < total; index++) {
            const idBase = 100_000 + index;
            const artist = `Dashboard Artist ${String(index).padStart(4, "0")}`;
            const title = `Dashboard Song ${String(index).padStart(4, "0")}`;
            artistInsert.run(idBase, artist, artist.toLowerCase(), now, now);
            songInsert.run(idBase, idBase, title, title.toLowerCase(), now, now);
            tabInsert.run(`dashboard-tab-${String(index).padStart(4, "0")}`, idBase, title, artist, `dashboard-${index}.gp`, index % 3 === 0 ? 1 : 0, index % 5 === 0 ? 1 : 0, now, now);
        }
        db.exec("COMMIT");
    } catch (error) {
        db.exec("ROLLBACK");
        throw error;
    }
}

function deterministicHash(index: number): string {
    return index.toString(16).padStart(64, "0").slice(-64);
}

async function makeImportRoot(name: string): Promise<string> {
    const root = path.join(tempDir, "imports", name);
    await fs.ensureDir(root);
    return await Deno.realPath(root);
}
