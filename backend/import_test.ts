import { assertEquals, assertExists } from "jsr:@std/assert@^1.0.17";
import * as fs from "@std/fs";
import * as path from "@std/path";
import { Hono } from "@hono/hono";

const tempDir = await Deno.makeTempDir();
const dataDir = path.join(tempDir, "data");
Deno.env.set("DATA_DIR", dataDir);
Deno.env.set("MYTABS_PORT", "47780");
Deno.env.set("MYTABS_DEMO_MODE", "false");

const {
    bulkUpdateImportItems,
    cancelImportJob,
    commitImportJob,
    createImportJob,
    getImportJob,
    getImportReport,
    listImportItems,
    listImportReviewGroups,
    patchImportItem,
    scanImportJob,
    startImportJobScan,
} = await import("./import.ts");
const { db, kv } = await import("./db.ts");
const { upsertArtist, upsertLibraryTab, upsertSong, upsertTabFile } = await import("./library.ts");
const { hashReadableStream } = await import("./storage.ts");
const { registerImportRoutes } = await import("./import-routes.ts");

Deno.test("import scanner records supported and unsupported files and transitions to review", async () => {
    const root = await makeImportRoot("scan");
    await Deno.writeTextFile(path.join(root, "Artist One - First Song.gp"), "not a real guitar pro file");
    await Deno.writeTextFile(path.join(root, "notes.txt"), "ignore me");
    Deno.env.set("MYTABS_IMPORT_ROOTS", root);

    const job = await createImportJob({
        sourceType: "server-folder",
        rootPath: root,
        copyMode: "copy",
        groupingMode: "auto",
    });
    assertEquals(job.status, "created");

    const scanned = await scanImportJob(job.id);
    assertEquals(scanned.status, "ready_for_review");
    assertEquals(scanned.totalCount, 2);
    assertEquals(scanned.skippedCount, 1);

    const page = listImportItems(job.id, { limit: 10, offset: 0 });
    assertEquals(page.total, 2);
    assertEquals(page.items.some((item) => item.decision === "skip_unsupported" && item.selected === false), true);
    const supported = page.items.find((item) => item.ext === "gp");
    assertExists(supported);
    assertEquals(supported.suggestedArtist, "Artist One");
    assertEquals(supported.suggestedTitle, "First Song");
    assertEquals(supported.status, "ready");
});

Deno.test("import jobs can be canceled before scan", async () => {
    const root = await makeImportRoot("cancel");
    await Deno.writeTextFile(path.join(root, "Cancel Artist - Cancel Song.gp"), "cancel");
    Deno.env.set("MYTABS_IMPORT_ROOTS", root);

    const job = await createImportJob({
        sourceType: "server-folder",
        rootPath: root,
        copyMode: "copy",
        groupingMode: "auto",
    });
    const canceled = cancelImportJob(job.id);
    assertEquals(canceled.status, "canceled");
    assertEquals(getImportJob(job.id)?.status, "canceled");
});

Deno.test("background import scan returns while job is scanning", async () => {
    const root = await makeImportRoot("background-scan");
    await Deno.writeTextFile(path.join(root, "Background Artist - Background Song.gp"), "background");
    Deno.env.set("MYTABS_IMPORT_ROOTS", root);

    const job = await createImportJob({
        sourceType: "server-folder",
        rootPath: root,
        copyMode: "copy",
        groupingMode: "auto",
    });
    const started = await startImportJobScan(job.id);
    assertEquals(started.status, "scanning");

    const completed = await waitForImportJob(job.id, "ready_for_review");
    assertEquals(completed.totalCount, 1);
});

Deno.test("background import scan rejects concurrent starts for one job", async () => {
    const root = await makeImportRoot("scan-race");
    await Deno.writeTextFile(path.join(root, "Race Artist - Race Song.gp"), "race");
    Deno.env.set("MYTABS_IMPORT_ROOTS", root);

    const job = await createImportJob({
        sourceType: "server-folder",
        rootPath: root,
        copyMode: "copy",
        groupingMode: "auto",
    });

    const results = await Promise.allSettled([
        startImportJobScan(job.id),
        startImportJobScan(job.id),
    ]);
    assertEquals(results.filter((result) => result.status === "fulfilled").length, 1);
    assertEquals(results.filter((result) => result.status === "rejected").length, 1);

    await waitForImportJob(job.id, "ready_for_review");
});

Deno.test("paginated import items and grouped review use suggested metadata", async () => {
    const root = await makeImportRoot("pages");
    await fs.ensureDir(path.join(root, "Album Artist", "Album One"));
    await Deno.writeTextFile(path.join(root, "Album Artist", "Album One", "Album Artist - Alpha.gp"), "alpha");
    await Deno.writeTextFile(path.join(root, "Album Artist", "Album One", "Album Artist - Beta.gp"), "beta");
    await Deno.writeTextFile(path.join(root, "Album Artist", "Album One", "Album Artist - Gamma.gp"), "gamma");
    Deno.env.set("MYTABS_IMPORT_ROOTS", root);

    const job = await createImportJob({
        sourceType: "server-folder",
        rootPath: root,
        copyMode: "copy",
        groupingMode: "artist-album-song",
    });
    await scanImportJob(job.id);

    const firstPage = listImportItems(job.id, { limit: 2, offset: 0 });
    assertEquals(firstPage.total, 3);
    assertEquals(firstPage.items.length, 2);

    const groups = listImportReviewGroups(job.id, { limit: 10, offset: 0 });
    assertEquals(groups.total, 3);
    assertEquals(groups.groups.length, 3);
    assertEquals(groups.groups.every((group) => group.suggestedArtist === "Album Artist"), true);
    assertEquals(groups.groups.every((group) => group.suggestedAlbum === "Album One"), true);
});

Deno.test("exact duplicate import links source path during commit", async () => {
    const root = await makeImportRoot("exact");
    const sourcePath = path.join(root, "Dup Artist - Dup Song.gp");
    await Deno.writeTextFile(sourcePath, "same content");
    Deno.env.set("MYTABS_IMPORT_ROOTS", root);

    const hash = await hashFile(sourcePath);
    const existingFile = upsertTabFile({
        sha256: hash.sha256,
        byteSize: hash.byteSize,
        ext: "gp",
        storedPath: `files/${hash.sha256.slice(0, 2)}/${hash.sha256}.gp`,
    });

    const job = await createImportJob({
        sourceType: "server-folder",
        rootPath: root,
        copyMode: "copy",
        groupingMode: "auto",
    });
    await scanImportJob(job.id);
    const item = listImportItems(job.id, { limit: 10, offset: 0 }).items[0];
    assertEquals(item.duplicateTabFileId, existingFile.id);
    assertEquals(item.decision, "link_duplicate_source");

    const committed = await commitImportJob(job.id);
    assertEquals(committed.status, "completed");

    const source = db.prepare("SELECT * FROM tab_file_sources WHERE tab_file_id = ? AND source_path = ?").get(existingFile.id, sourcePath) as Record<string, unknown> | undefined;
    assertExists(source);
    assertEquals(source.source_type, "server-folder");
});

Deno.test("probable duplicates default to keep_as_version and commit as new version", async () => {
    const root = await makeImportRoot("probable");
    const sourcePath = path.join(root, "Version Artist - Version Song.gp");
    await Deno.writeTextFile(sourcePath, "version content");
    Deno.env.set("MYTABS_IMPORT_ROOTS", root);

    const artist = upsertArtist("Version Artist");
    const song = upsertSong(artist.id, "Version Song");
    const oldHash = "b".repeat(64);
    const oldFile = upsertTabFile({
        sha256: oldHash,
        byteSize: 1,
        ext: "gp",
        storedPath: `files/bb/${oldHash}.gp`,
    });
    const oldTab = upsertLibraryTab({
        songId: song.id,
        tabFileId: oldFile.id,
        originalFilename: "old.gp",
    });

    const job = await createImportJob({
        sourceType: "server-folder",
        rootPath: root,
        copyMode: "copy",
        groupingMode: "artist-song",
    });
    await scanImportJob(job.id);
    const item = listImportItems(job.id, { limit: 10, offset: 0 }).items[0];
    assertEquals(item.probableDuplicateSongId, song.id);
    assertEquals(item.decision, "keep_as_version");
    assertEquals(item.existingTabId, oldTab.id);

    await commitImportJob(job.id);
    const committedItem = listImportItems(job.id, { limit: 10, offset: 0, status: "committed" }).items[0];
    assertExists(committedItem.createdTabId);
    const newTab = db.prepare("SELECT song_id, version FROM tabs WHERE id = ?").get(committedItem.createdTabId) as Record<string, unknown>;
    assertEquals(newTab.song_id, song.id);
    assertEquals(newTab.version, 2);
});

Deno.test("item patch, bulk actions, and report expose review progress", async () => {
    const root = await makeImportRoot("bulk");
    await Deno.writeTextFile(path.join(root, "Bulk Artist - Bulk Song.gp"), "bulk");
    Deno.env.set("MYTABS_IMPORT_ROOTS", root);

    const job = await createImportJob({
        sourceType: "server-folder",
        rootPath: root,
        copyMode: "copy",
        groupingMode: "auto",
    });
    await scanImportJob(job.id);
    const item = listImportItems(job.id, { limit: 10, offset: 0 }).items[0];

    const patched = patchImportItem(job.id, item.id, {
        selected: false,
        decision: "manual_skip",
        reviewRequired: false,
    });
    assertEquals(patched.selected, false);
    assertEquals(patched.decision, "manual_skip");

    const bulk = bulkUpdateImportItems(job.id, {
        itemIds: [item.id],
        action: "select",
    });
    assertEquals(bulk.updated, 1);

    const report = getImportReport(job.id);
    assertEquals(report.totals.imported, 0);
    assertEquals(report.totals.skipped, 0);
});

Deno.test("import routes require login", async () => {
    const app = new Hono();
    registerImportRoutes(app);

    const response = await app.request("/api/import-jobs", {
        method: "GET",
    });
    const body = await response.json();
    assertEquals(response.status, 400);
    assertEquals(body.ok, false);
    assertEquals(body.msg, "Not logged in");
});

Deno.test("server path scan is blocked in demo mode", async () => {
    const root = await makeImportRoot("demo");
    await Deno.writeTextFile(path.join(root, "Demo Artist - Demo Song.gp"), "demo");
    Deno.env.set("MYTABS_IMPORT_ROOTS", root);
    Deno.env.set("MYTABS_DEMO_MODE", "true");
    try {
        let message = "";
        try {
            await createImportJob({
                sourceType: "server-folder",
                rootPath: root,
                copyMode: "copy",
                groupingMode: "auto",
            });
        } catch (error) {
            message = error instanceof Error ? error.message : String(error);
        }
        assertEquals(message, "Server-side import is disabled.");
    } finally {
        Deno.env.set("MYTABS_DEMO_MODE", "false");
    }
});

Deno.test.afterAll(async () => {
    kv.close();
    db.close();
    await fs.emptyDir(tempDir);
    await Deno.remove(tempDir);
});

async function makeImportRoot(name: string): Promise<string> {
    const root = path.join(tempDir, "imports", name);
    await fs.ensureDir(root);
    return await Deno.realPath(root);
}

async function waitForImportJob(jobId: string, status: string) {
    const started = performance.now();
    while (performance.now() - started < 5_000) {
        const job = getImportJob(jobId);
        if (job?.status === status) {
            return job;
        }
        await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error(`Import job did not reach ${status}`);
}

async function hashFile(filePath: string): Promise<{ sha256: string; byteSize: number }> {
    const file = await Deno.open(filePath, { read: true });
    return await hashReadableStream(file.readable);
}
