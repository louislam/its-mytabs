import { assert, assertEquals, assertExists } from "jsr:@std/assert@^1.0.17";
import * as fs from "@std/fs";
import * as path from "@std/path";

const tempDir = await Deno.makeTempDir();
const dataDir = path.join(tempDir, "data");
const importRoot = path.join(tempDir, "imports");
Deno.env.set("DATA_DIR", dataDir);
Deno.env.set("MYTABS_PORT", "47784");
Deno.env.set("MYTABS_DEMO_MODE", "false");
Deno.env.set("MYTABS_IMPORT_ROOTS", importRoot);

const distDir = path.join("./", "dist");
const indexPath = path.join(distDir, "index.html");
const hadIndex = await fs.exists(indexPath);
const previousIndex = hadIndex ? await Deno.readTextFile(indexPath) : null;
await fs.ensureDir(distDir);
await Deno.writeTextFile(indexPath, "<html><head></head><body>import e2e</body></html>");
await fs.ensureDir(importRoot);

const { main, closeServer } = await import("./main.ts");

await main();
await new Promise((resolve) => setTimeout(resolve, 500));

const baseURL = "http://127.0.0.1:47784";
type JsonRecord = Record<string, unknown>;
const authEmail = "import-e2e@example.com";
const authPassword = "password123";

Deno.test({
    name: "HTTP import flows create searchable library tabs",
    sanitizeOps: false,
    sanitizeResources: false,
    fn: async () => {
        const cookie = await getAuthCookie();

        const uploadBytes = new TextEncoder().encode("upload e2e content");
        const upload = await uploadTab(cookie, {
            filename: "http-upload.gp",
            bytes: uploadBytes,
            title: "HTTP Upload Song",
            artist: "HTTP Upload Artist",
        });
        assertExists(upload.id);
        await assertLibrarySearch(cookie, "HTTP Upload Song", [upload.id]);

        const empty = await postJson(cookie, "/api/new-tab/template/guitar");
        assertEquals(empty.ok, true, JSON.stringify(empty));
        const emptyId = String(empty.id);
        await assertLibrarySearch(cookie, `Empty Tab #${emptyId}`, [emptyId]);

        const serverRoot = await makeServerImportRoot("mixed-server-import");
        const importSongPath = path.join(serverRoot, "HTTP Import Artist", "HTTP Album", "HTTP Import Artist - HTTP Import Song.gp");
        const importVersionPath = path.join(serverRoot, "HTTP Import Artist", "HTTP Album", "HTTP Import Artist - HTTP Import Song alternate.gp");
        const duplicatePath = path.join(serverRoot, "HTTP Upload Artist - HTTP Upload Song.gp");
        const unsupportedPath = path.join(serverRoot, "notes.txt");
        await fs.ensureDir(path.dirname(importSongPath));
        await Deno.writeTextFile(importSongPath, "server import primary");
        await Deno.writeTextFile(importVersionPath, "server import alternate");
        await Deno.writeFile(duplicatePath, uploadBytes);
        await Deno.writeTextFile(unsupportedPath, "not a tab");
        Deno.env.set("MYTABS_IMPORT_ROOTS", serverRoot);

        const created = await postJson(cookie, "/api/import-jobs", {
            sourceType: "server-folder",
            rootPath: serverRoot,
            copyMode: "copy",
            groupingMode: "artist-album-song",
        });
        assertEquals(created.ok, true, JSON.stringify(created));
        const createdJob = asRecord(created.job, "created job");
        const jobId = String(createdJob.id);

        const scan = await postJson(cookie, `/api/import-jobs/${encodeURIComponent(jobId)}/scan`);
        assertEquals(scan.ok, true, JSON.stringify(scan));
        const readyJob = await waitForJob(cookie, jobId, "ready_for_review");
        assertEquals(readyJob.totalCount, 4);

        const itemsPage = await getJson(cookie, `/api/import-jobs/${encodeURIComponent(jobId)}/items?limit=20&offset=0&sort=source-path`);
        assertEquals(itemsPage.ok, true, JSON.stringify(itemsPage));
        const page = asRecord(itemsPage.page, "items page");
        const items = asRecordArray(page.items, "import items");
        assertEquals(page.total, 4);
        assertEquals(items.filter((item) => item.status === "skipped").length, 1);

        const duplicateItem = findItem(items, "HTTP Upload Song.gp");
        assertEquals(duplicateItem.decision, "link_duplicate_source");
        assertEquals(typeof duplicateItem.duplicateTabFileId, "number");

        const alternateItem = findItem(items, "alternate.gp");
        const patched = await patchJson(cookie, `/api/import-jobs/${encodeURIComponent(jobId)}/items/${encodeURIComponent(String(alternateItem.id))}`, {
            suggestedArtist: "HTTP Import Artist",
            suggestedTitle: "HTTP Import Song",
            suggestedAlbum: "HTTP Album",
            suggestedVersionLabel: "alternate",
            decision: "keep_as_version",
        });
        assertEquals(patched.ok, true, JSON.stringify(patched));
        const patchedItem = asRecord(patched.item, "patched item");
        assertEquals(patchedItem.suggestedVersionLabel, "alternate");

        const commit = await postJson(cookie, `/api/import-jobs/${encodeURIComponent(jobId)}/commit`);
        assertEquals(commit.ok, true, JSON.stringify(commit));
        await waitForJob(cookie, jobId, "completed");

        const report = await getJson(cookie, `/api/import-jobs/${encodeURIComponent(jobId)}/report`);
        assertEquals(report.ok, true, JSON.stringify(report));
        const reportData = asRecord(report.report, "import report");
        const totals = asRecord(reportData.totals, "import report totals");
        const createdTabs = asRecordArray(reportData.createdTabs, "created tabs");
        assertEquals(totals.imported, 3);
        assertEquals(totals.skipped, 1);
        assertEquals(totals.failed, 0);
        assertEquals(createdTabs.length, 2);

        const createdIds = createdTabs.map((tab) => String(tab.id));
        await assertLibrarySearch(cookie, "HTTP Import Song", createdIds);
        await assertLibrarySearch(cookie, "HTTP Upload Song", [upload.id]);
    },
});

Deno.test({
    name: "HTTP import handles probable duplicate versions and stored files",
    sanitizeOps: false,
    sanitizeResources: false,
    fn: async () => {
        const cookie = await getAuthCookie();

        const seed = await uploadTab(cookie, {
            filename: "version-seed.gp",
            bytes: new TextEncoder().encode("version seed"),
            title: "HTTP Version Song",
            artist: "HTTP Version Artist",
        });
        await assertLibrarySearch(cookie, "HTTP Version Song", [seed.id]);

        const serverRoot = await makeServerImportRoot("probable-version-import");
        const versionPath = path.join(serverRoot, "HTTP Version Artist - HTTP Version Song.gp");
        await Deno.writeTextFile(versionPath, "version two");
        Deno.env.set("MYTABS_IMPORT_ROOTS", serverRoot);

        const jobId = await createImportJob(cookie, serverRoot, "auto");
        await postJson(cookie, `/api/import-jobs/${encodeURIComponent(jobId)}/scan`);
        await waitForJob(cookie, jobId, "ready_for_review");

        const items = await listImportItems(cookie, jobId);
        assertEquals(items.length, 1);
        assertEquals(items[0].decision, "keep_as_version");
        assertEquals(typeof items[0].probableDuplicateSongId, "number");
        assertEquals(items[0].existingTabId, seed.id);

        await postJson(cookie, `/api/import-jobs/${encodeURIComponent(jobId)}/commit`);
        await waitForJob(cookie, jobId, "completed");

        const report = await getImportReport(cookie, jobId);
        const createdTabs = asRecordArray(report.createdTabs, "created tabs");
        assertEquals(asRecord(report.totals, "report totals").imported, 1);
        assertEquals(createdTabs.length, 1);
        const createdId = String(createdTabs[0].id);

        await assertLibrarySearch(cookie, "HTTP Version Song", [seed.id, createdId]);

        const versions = await getJson(cookie, `/api/tab/${encodeURIComponent(createdId)}/versions`);
        const song = asRecord(versions.song, "song versions");
        const versionRows = asRecordArray(song.versions, "versions");
        assertEquals(versionRows.length, 2);
        assertEquals(versionRows.map((version) => Number(version.version)).sort((a, b) => a - b), [1, 2]);

        const fileResponse = await fetch(`${baseURL}/api/tab/${encodeURIComponent(createdId)}/file`, {
            headers: { Cookie: cookie },
        });
        assertEquals(fileResponse.status, 200);
        assertEquals(await fileResponse.text(), "version two");
    },
});

Deno.test({
    name: "HTTP import supports bulk manual skip and single-file roots",
    sanitizeOps: false,
    sanitizeResources: false,
    fn: async () => {
        const cookie = await getAuthCookie();

        const singleFileRoot = await makeServerImportRoot("single-file-root");
        const singleFilePath = path.join(singleFileRoot, "Single File Artist - Single File Song.gp");
        await Deno.writeTextFile(singleFilePath, "single file import");
        Deno.env.set("MYTABS_IMPORT_ROOTS", importRoot);

        const jobId = await createImportJob(cookie, await Deno.realPath(singleFilePath), "auto");
        await postJson(cookie, `/api/import-jobs/${encodeURIComponent(jobId)}/scan`);
        const readyJob = await waitForJob(cookie, jobId, "ready_for_review");
        assertEquals(readyJob.totalCount, 1);

        const items = await listImportItems(cookie, jobId);
        assertEquals(items.length, 1);
        assertEquals(items[0].decision, "import");

        const bulk = await postJson(cookie, `/api/import-jobs/${encodeURIComponent(jobId)}/items/bulk`, {
            itemIds: [String(items[0].id)],
            action: "set-decision",
            decision: "manual_skip",
        });
        assertEquals(bulk.ok, true, JSON.stringify(bulk));
        assertEquals(bulk.updated, 1);

        await postJson(cookie, `/api/import-jobs/${encodeURIComponent(jobId)}/commit`);
        await waitForJob(cookie, jobId, "completed");

        const report = await getImportReport(cookie, jobId);
        const totals = asRecord(report.totals, "report totals");
        assertEquals(totals.imported, 0);
        assertEquals(totals.skipped, 1);
        assertEquals(totals.failed, 0);
        assertEquals(asRecordArray(report.createdTabs, "created tabs").length, 0);

        await assertLibrarySearchIds(cookie, "Single File Song", []);
    },
});

Deno.test.afterAll(async () => {
    closeServer();

    if (previousIndex !== null) {
        await Deno.writeTextFile(indexPath, previousIndex);
    } else {
        try {
            await Deno.remove(indexPath);
        } catch {
            // ignore cleanup races
        }
    }

    await fs.emptyDir(tempDir);
    await Deno.remove(tempDir);
});

async function getAuthCookie(): Promise<string> {
    const existing = await trySignIn();
    if (existing) {
        return existing;
    }

    const signup = await fetch(`${baseURL}/api/auth/sign-up/email`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: authEmail, name: "Import E2E", password: authPassword }),
    });
    assertEquals(signup.ok, true, await signup.text());

    const created = await trySignIn();
    assertExists(created, "sign-in failed after successful sign-up");
    return created;
}

async function trySignIn(): Promise<string | null> {
    const signin = await fetch(`${baseURL}/api/auth/sign-in/email`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: authEmail, password: authPassword }),
    });
    if (signin.status !== 200) {
        await signin.body?.cancel();
        return null;
    }
    const setCookie = signin.headers.get("set-cookie");
    assertExists(setCookie);
    return setCookie.split(";", 1)[0];
}

async function uploadTab(cookie: string, input: { filename: string; bytes: Uint8Array; title: string; artist: string }): Promise<{ id: string }> {
    const form = new FormData();
    const bytes = new Uint8Array(input.bytes);
    form.append("file", new File([bytes.buffer], input.filename, { type: "application/octet-stream" }));
    form.append("title", input.title);
    form.append("artist", input.artist);

    const response = await fetch(`${baseURL}/api/new-tab`, {
        method: "POST",
        headers: { Cookie: cookie },
        body: form,
    });
    const json = await response.json();
    assertEquals(response.status, 200, JSON.stringify(json));
    assertEquals(json.ok, true, JSON.stringify(json));
    return { id: String(json.id) };
}

async function makeServerImportRoot(name: string): Promise<string> {
    const root = path.join(importRoot, name);
    await fs.ensureDir(root);
    return await Deno.realPath(root);
}

async function createImportJob(cookie: string, rootPath: string, groupingMode: string): Promise<string> {
    const created = await postJson(cookie, "/api/import-jobs", {
        sourceType: "server-folder",
        rootPath,
        copyMode: "copy",
        groupingMode,
    });
    assertEquals(created.ok, true, JSON.stringify(created));
    return String(asRecord(created.job, "created job").id);
}

async function listImportItems(cookie: string, jobId: string): Promise<JsonRecord[]> {
    const itemsPage = await getJson(cookie, `/api/import-jobs/${encodeURIComponent(jobId)}/items?limit=20&offset=0&sort=source-path`);
    assertEquals(itemsPage.ok, true, JSON.stringify(itemsPage));
    const page = asRecord(itemsPage.page, "items page");
    return asRecordArray(page.items, "import items");
}

async function getImportReport(cookie: string, jobId: string): Promise<JsonRecord> {
    const report = await getJson(cookie, `/api/import-jobs/${encodeURIComponent(jobId)}/report`);
    assertEquals(report.ok, true, JSON.stringify(report));
    return asRecord(report.report, "import report");
}

async function getJson(cookie: string, route: string): Promise<JsonRecord> {
    const response = await fetch(`${baseURL}${route}`, {
        headers: { Cookie: cookie },
    });
    const json = await response.json();
    assert(response.ok, `${route} failed: ${JSON.stringify(json)}`);
    return asRecord(json, route);
}

async function postJson(cookie: string, route: string, body?: unknown): Promise<JsonRecord> {
    const response = await fetch(`${baseURL}${route}`, {
        method: "POST",
        headers: {
            Cookie: cookie,
            ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
    });
    const json = await response.json();
    assert(response.ok, `${route} failed: ${JSON.stringify(json)}`);
    return asRecord(json, route);
}

async function patchJson(cookie: string, route: string, body: unknown): Promise<JsonRecord> {
    const response = await fetch(`${baseURL}${route}`, {
        method: "PATCH",
        headers: {
            Cookie: cookie,
            "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
    });
    const json = await response.json();
    assert(response.ok, `${route} failed: ${JSON.stringify(json)}`);
    return asRecord(json, route);
}

async function waitForJob(cookie: string, jobId: string, status: string): Promise<JsonRecord> {
    const started = performance.now();
    while (performance.now() - started < 5_000) {
        const json = await getJson(cookie, `/api/import-jobs/${encodeURIComponent(jobId)}`);
        const job = asRecord(json.job, "import job");
        if (job.status === status) {
            return job;
        }
        if (job.status === "failed") {
            throw new Error(`Import job failed: ${job.errorMessage ?? "unknown error"}`);
        }
        await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error(`Timed out waiting for import job ${jobId} to reach ${status}`);
}

async function assertLibrarySearch(cookie: string, search: string, expectedIds: string[]): Promise<void> {
    const ids = await getLibrarySearchIds(cookie, search);
    for (const expectedId of expectedIds) {
        assert(ids.includes(expectedId), `Expected library search "${search}" to include ${expectedId}, got ${JSON.stringify(ids)}`);
    }
}

async function assertLibrarySearchIds(cookie: string, search: string, expectedIds: string[]): Promise<void> {
    const ids = await getLibrarySearchIds(cookie, search);
    assertEquals(ids.sort(), expectedIds.sort(), `Unexpected library search results for "${search}"`);
}

async function getLibrarySearchIds(cookie: string, search: string): Promise<string[]> {
    const json = await getJson(cookie, `/api/library?mode=album&limit=1000&search=${encodeURIComponent(search)}`);
    return flattenLibraryTabIds(asRecord(json.library, "library"));
}

function flattenLibraryTabIds(library: JsonRecord): string[] {
    const ids: string[] = [];
    for (const artist of asRecordArray(library.artists, "library artists")) {
        for (const album of asRecordArray(artist.albums, "artist albums")) {
            for (const song of asRecordArray(album.songs, "album songs")) {
                for (const version of asRecordArray(song.versions, "song versions")) {
                    ids.push(String(version.id));
                }
            }
        }
        for (const song of asRecordArray(artist.songs, "artist songs")) {
            for (const version of asRecordArray(song.versions, "song versions")) {
                ids.push(String(version.id));
            }
        }
    }
    return ids;
}

function findItem(items: JsonRecord[], suffix: string): JsonRecord {
    const item = items.find((candidate) => String(candidate.relativePath).endsWith(suffix));
    assertExists(item, `Missing import item ending with ${suffix}`);
    return item;
}

function asRecord(value: unknown, label: string): JsonRecord {
    assert(value !== null && typeof value === "object" && !Array.isArray(value), `${label} is not an object`);
    return value as JsonRecord;
}

function asRecordArray(value: unknown, label: string): JsonRecord[] {
    assert(Array.isArray(value), `${label} is not an array`);
    return value.map((item, index) => asRecord(item, `${label}[${index}]`));
}
