import * as fs from "@std/fs";
import * as path from "@std/path";

const defaultLibraryRoot = "/home/mateuszpsujek/SynologyDrive/taby";
const enabled = Deno.env.get("MYTABS_REAL_LIBRARY_DRY_RUN") === "1";
const rootPath = path.resolve(Deno.env.get("MYTABS_REAL_LIBRARY_DRY_RUN_ROOT") ?? defaultLibraryRoot);

if (!enabled) {
    console.log("Real library dry run skipped. Set MYTABS_REAL_LIBRARY_DRY_RUN=1 to enable it.");
    Deno.exit(0);
}

if (!await fs.exists(rootPath)) {
    console.log(`Real library dry run skipped. Path does not exist: ${rootPath}`);
    Deno.exit(0);
}

const stat = await Deno.stat(rootPath);
if (!stat.isDirectory && !stat.isFile) {
    console.log(`Real library dry run skipped. Path is not a file or directory: ${rootPath}`);
    Deno.exit(0);
}

let tempDataDir: string | null = null;
if (!Deno.env.get("DATA_DIR")) {
    tempDataDir = await Deno.makeTempDir({ prefix: "mytabs-real-library-dry-run-" });
    Deno.env.set("DATA_DIR", tempDataDir);
}

Deno.env.set("MYTABS_DEMO_MODE", "false");
if (!Deno.env.get("MYTABS_IMPORT_ROOTS")) {
    Deno.env.set("MYTABS_IMPORT_ROOTS", rootPath);
}

const { createImportJob, getImportReport, listImportItems, listImportReviewGroups, scanImportJob } = await import("../backend/import.ts");
const { db, kv } = await import("../backend/db.ts");

try {
    const started = performance.now();
    const job = await createImportJob({
        sourceType: "server-folder",
        rootPath,
        copyMode: "copy",
        groupingMode: "artist-album-song",
    });
    const scanned = await scanImportJob(job.id);
    const report = getImportReport(job.id);
    const unsupported = listImportItems(job.id, { limit: 20, offset: 0, decision: "skip_unsupported", sort: "source-path" });
    const parseFailures = sampleItemsWhere(job.id, "status_message LIKE 'Parser metadata unavailable:%'");
    const exactDuplicates = listImportItems(job.id, { limit: 20, offset: 0, duplicate: "exact", sort: "source-path" });
    const probableDuplicates = listImportItems(job.id, { limit: 20, offset: 0, duplicate: "probable", sort: "artist-title" });
    const lowConfidence = listImportItems(job.id, { limit: 20, offset: 0, sort: "confidence-asc" });
    const groups = listImportReviewGroups(job.id, { limit: 20, offset: 0, sort: "album-title" });
    const durationMs = performance.now() - started;

    console.log(JSON.stringify({
        ok: true,
        dryRunOnly: true,
        dataDir: Deno.env.get("DATA_DIR"),
        usedTemporaryDataDir: tempDataDir !== null,
        rootPath,
        durationMs: Math.round(durationMs),
        job: {
            id: scanned.id,
            status: scanned.status,
            totalCount: scanned.totalCount,
            importedCount: scanned.importedCount,
            skippedCount: scanned.skippedCount,
            failedCount: scanned.failedCount,
            errorMessage: scanned.errorMessage,
        },
        report: {
            totals: report.totals,
            createdTabs: report.createdTabs.length,
            failedItems: report.failedItems.length,
        },
        review: {
            unsupported: summarizePage(unsupported.items),
            parseFailures: summarizePage(parseFailures),
            exactDuplicates: summarizePage(exactDuplicates.items),
            probableDuplicates: summarizePage(probableDuplicates.items),
            lowConfidence: summarizePage(lowConfidence.items),
            firstGroups: groups.groups.map((group) => ({
                key: group.key,
                suggestedArtist: group.suggestedArtist,
                suggestedAlbum: group.suggestedAlbum,
                suggestedTitle: group.suggestedTitle,
                itemCount: group.itemCount,
                selectedCount: group.selectedCount,
                reviewRequiredCount: group.reviewRequiredCount,
            })),
        },
    }, null, 4));
} finally {
    kv.close();
    db.close();
    if (tempDataDir) {
        await Deno.remove(tempDataDir, { recursive: true });
    }
}

function sampleItemsWhere(jobId: string, where: string) {
    const rows = db.prepare(`
        SELECT relative_path, status_message, suggested_artist, suggested_title, suggested_album, confidence
        FROM import_items
        WHERE job_id = ? AND ${where}
        ORDER BY relative_path COLLATE NOCASE
        LIMIT 20
    `).all(jobId) as Array<Record<string, string | number | null>>;

    return rows.map((row) => ({
        relativePath: readString(row, "relative_path"),
        statusMessage: readNullableString(row, "status_message"),
        suggestedArtist: readNullableString(row, "suggested_artist"),
        suggestedTitle: readNullableString(row, "suggested_title"),
        suggestedAlbum: readNullableString(row, "suggested_album"),
        confidence: readNumber(row, "confidence"),
    }));
}

function summarizePage(items: Array<{ relativePath: string; statusMessage: string | null; suggestedArtist: string | null; suggestedTitle: string | null; suggestedAlbum: string | null; confidence: number }>) {
    return items.map((item) => ({
        relativePath: item.relativePath,
        statusMessage: item.statusMessage,
        suggestedArtist: item.suggestedArtist,
        suggestedTitle: item.suggestedTitle,
        suggestedAlbum: item.suggestedAlbum,
        confidence: item.confidence,
    }));
}

function readString(row: Record<string, string | number | null>, key: string): string {
    const value = row[key];
    if (typeof value !== "string") {
        throw new Error(`Expected ${key} to be a string`);
    }
    return value;
}

function readNullableString(row: Record<string, string | number | null>, key: string): string | null {
    const value = row[key];
    if (value === null) {
        return null;
    }
    if (typeof value !== "string") {
        throw new Error(`Expected ${key} to be a string or null`);
    }
    return value;
}

function readNumber(row: Record<string, string | number | null>, key: string): number {
    const value = row[key];
    if (typeof value !== "number") {
        throw new Error(`Expected ${key} to be a number`);
    }
    return value;
}
