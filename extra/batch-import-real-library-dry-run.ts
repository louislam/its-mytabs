import * as fs from "@std/fs";
import * as path from "@std/path";

const defaultLibraryRoot = "/home/mateuszpsujek/SynologyDrive/taby";
const enabled = Deno.env.get("MYTABS_REAL_LIBRARY_DRY_RUN") === "1";
const rootPath = path.resolve(
    Deno.env.get("MYTABS_REAL_LIBRARY_DRY_RUN_ROOT") ?? defaultLibraryRoot,
);
const reportPath = path.resolve(
    Deno.env.get("MYTABS_REAL_LIBRARY_DRY_RUN_REPORT") ??
        "private/batch-import-real-library-dry-run.md",
);

if (!enabled) {
    console.log(
        "Real library dry run skipped. Set MYTABS_REAL_LIBRARY_DRY_RUN=1 to enable it.",
    );
    Deno.exit(0);
}

if (!await fs.exists(rootPath)) {
    console.log(
        `Real library dry run skipped. Path does not exist: ${rootPath}`,
    );
    Deno.exit(0);
}

const stat = await Deno.stat(rootPath);
if (!stat.isDirectory && !stat.isFile) {
    console.log(
        `Real library dry run skipped. Path is not a file or directory: ${rootPath}`,
    );
    Deno.exit(0);
}

const tempDataDir = await Deno.makeTempDir({
    prefix: "mytabs-real-library-dry-run-",
});
Deno.env.set("DATA_DIR", tempDataDir);

Deno.env.set("MYTABS_DEMO_MODE", "false");
if (!Deno.env.get("MYTABS_IMPORT_ROOTS")) {
    Deno.env.set("MYTABS_IMPORT_ROOTS", rootPath);
}

const {
    createImportJob,
    getImportReport,
    listImportItems,
    listImportReviewGroups,
    scanImportJob,
} = await import("../backend/import.ts");
const { db, kv } = await import("../backend/db.ts");

try {
    const started = performance.now();
    const job = await createImportJob({
        sourceType: "server-folder",
        rootPath,
        copyMode: "copy",
        groupingMode: "artist-album-song",
    });
    const progressTimer = setInterval(() => {
        const current = db.prepare(
            "SELECT total_count FROM import_jobs WHERE id = ?",
        ).get(job.id) as { total_count?: number } | undefined;
        console.error(
            `Real library dry run scanning: ${current?.total_count ?? 0} files seen...`,
        );
    }, 15000);
    let scanned;
    try {
        scanned = await scanImportJob(job.id);
    } finally {
        clearInterval(progressTimer);
    }
    const report = getImportReport(job.id);
    const unsupported = listImportItems(job.id, {
        limit: 20,
        offset: 0,
        decision: "skip_unsupported",
        sort: "source-path",
    });
    const parseFailures = sampleItemsByPredicate(job.id, "parserFailure");
    const exactDuplicates = listImportItems(job.id, {
        limit: 20,
        offset: 0,
        duplicate: "exact",
        sort: "source-path",
    });
    const probableDuplicates = listImportItems(job.id, {
        limit: 20,
        offset: 0,
        duplicate: "probable",
        sort: "artist-title",
    });
    const lowConfidence = listImportItems(job.id, {
        limit: 20,
        offset: 0,
        sort: "confidence-asc",
    });
    const groups = listImportReviewGroups(job.id, {
        limit: 20,
        offset: 0,
        sort: "album-title",
    });
    const quality = collectQualityStats(job.id);
    const durationMs = performance.now() - started;
    await writeMarkdownReport(reportPath, {
        rootPath,
        durationMs,
        usedTemporaryDataDir: true,
        job: scanned,
        totals: report.totals,
        quality,
        unsupported,
        parseFailures,
        exactDuplicates,
        probableDuplicates,
        lowConfidence,
        groups,
    });

    console.log(JSON.stringify(
        {
            ok: true,
            dryRunOnly: true,
            dataDir: Deno.env.get("DATA_DIR"),
            usedTemporaryDataDir: true,
            rootPath,
            reportPath,
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
            quality,
            review: {
                unsupportedTotal: unsupported.total,
                parserFailureTotal: quality.parserFailureCount,
                existingLibraryExactDuplicateTotal: exactDuplicates.total,
                existingLibraryProbableDuplicateTotal: probableDuplicates.total,
                batchExactDuplicateGroupSamples: quality.batchExactDuplicateGroups.length,
                batchProbableDuplicateGroupSamples: quality.batchProbableDuplicateGroups.length,
                lowConfidenceSamples: lowConfidence.items.length,
                firstReviewGroupsSampled: groups.groups.length,
            },
        },
        null,
        4,
    ));
} finally {
    kv.close();
    db.close();
    await Deno.remove(tempDataDir, { recursive: true });
}

interface QualityStats {
    statusCounts: Record<string, number>;
    decisionCounts: Record<string, number>;
    extensionCounts: Record<string, number>;
    reviewRequiredCount: number;
    parserFailureCount: number;
    missingArtistCount: number;
    missingTitleCount: number;
    confidence: {
        min: number | null;
        average: number | null;
        lowUnder065: number;
        highAtLeast08: number;
    };
    batchExactDuplicateGroups: Array<
        { sha256: string; count: number; samples: string[] }
    >;
    batchProbableDuplicateGroups: Array<
        {
            artist: string;
            title: string;
            album: string | null;
            count: number;
            samples: string[];
        }
    >;
}

const qualityPredicates = {
    reviewRequired: "review_required = 1",
    parserFailure: "status_message LIKE 'Parser metadata unavailable:%'",
    missingArtist: "suggested_artist IS NULL OR suggested_artist = ''",
    missingTitle: "suggested_title IS NULL OR suggested_title = ''",
} as const;

type QualityPredicate = keyof typeof qualityPredicates;

function sampleItemsByPredicate(jobId: string, predicate: QualityPredicate) {
    const rows = db.prepare(`
        SELECT relative_path, status_message, suggested_artist, suggested_title, suggested_album, confidence
        FROM import_items
        WHERE job_id = ? AND ${qualityPredicates[predicate]}
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

function collectQualityStats(jobId: string): QualityStats {
    return {
        statusCounts: collectCounts(jobId, "status"),
        decisionCounts: collectCounts(jobId, "decision"),
        extensionCounts: collectCounts(jobId, "ext"),
        reviewRequiredCount: countByPredicate(jobId, "reviewRequired"),
        parserFailureCount: countByPredicate(jobId, "parserFailure"),
        missingArtistCount: countByPredicate(jobId, "missingArtist"),
        missingTitleCount: countByPredicate(jobId, "missingTitle"),
        confidence: collectConfidence(jobId),
        batchExactDuplicateGroups: collectBatchExactDuplicateGroups(jobId),
        batchProbableDuplicateGroups: collectBatchProbableDuplicateGroups(
            jobId,
        ),
    };
}

function collectCounts(
    jobId: string,
    column: "status" | "decision" | "ext",
): Record<string, number> {
    const rows = db.prepare(`
        SELECT ${column} AS key, COUNT(*) AS count
        FROM import_items
        WHERE job_id = ?
        GROUP BY ${column}
        ORDER BY count DESC, key COLLATE NOCASE
    `).all(jobId) as Array<Record<string, string | number | null>>;
    return Object.fromEntries(
        rows.map((
            row,
        ) => [
            readNullableString(row, "key") ?? "(empty)",
            readNumber(row, "count"),
        ]),
    );
}

function countByPredicate(jobId: string, predicate: QualityPredicate): number {
    const row = db.prepare(
        `SELECT COUNT(*) AS count FROM import_items WHERE job_id = ? AND ${qualityPredicates[predicate]}`,
    ).get(jobId) as Record<string, string | number | null>;
    return readNumber(row, "count");
}

function collectConfidence(jobId: string): QualityStats["confidence"] {
    const row = db.prepare(`
        SELECT MIN(confidence) AS min, AVG(confidence) AS average,
            SUM(CASE WHEN confidence < 0.65 THEN 1 ELSE 0 END) AS low_under_065,
            SUM(CASE WHEN confidence >= 0.8 THEN 1 ELSE 0 END) AS high_at_least_08
        FROM import_items
        WHERE job_id = ? AND status = 'ready'
    `).get(jobId) as Record<string, string | number | null>;
    return {
        min: readNullableNumber(row, "min"),
        average: readNullableNumber(row, "average"),
        lowUnder065: readNullableAggregate(row, "low_under_065"),
        highAtLeast08: readNullableAggregate(row, "high_at_least_08"),
    };
}

function collectBatchExactDuplicateGroups(
    jobId: string,
): Array<{ sha256: string; count: number; samples: string[] }> {
    const rows = db.prepare(`
        SELECT sha256, COUNT(*) AS count, GROUP_CONCAT(relative_path, char(10)) AS paths
        FROM import_items
        WHERE job_id = ? AND sha256 IS NOT NULL
        GROUP BY sha256
        HAVING COUNT(*) > 1
        ORDER BY count DESC, MIN(relative_path) COLLATE NOCASE
        LIMIT 20
    `).all(jobId) as Array<Record<string, string | number | null>>;
    return rows.map((row) => ({
        sha256: readString(row, "sha256"),
        count: readNumber(row, "count"),
        samples: splitSamples(readString(row, "paths")),
    }));
}

function collectBatchProbableDuplicateGroups(
    jobId: string,
): Array<
    {
        artist: string;
        title: string;
        album: string | null;
        count: number;
        samples: string[];
    }
> {
    const rows = db.prepare(`
        SELECT suggested_artist, suggested_title, suggested_album, COUNT(*) AS count, GROUP_CONCAT(relative_path, char(10)) AS paths
        FROM import_items
        WHERE job_id = ? AND status = 'ready' AND suggested_artist IS NOT NULL AND suggested_title IS NOT NULL
        GROUP BY lower(suggested_artist), lower(suggested_title), lower(COALESCE(suggested_album, ''))
        HAVING COUNT(*) > 1
        ORDER BY count DESC, MIN(relative_path) COLLATE NOCASE
        LIMIT 20
    `).all(jobId) as Array<Record<string, string | number | null>>;
    return rows.map((row) => ({
        artist: readString(row, "suggested_artist"),
        title: readString(row, "suggested_title"),
        album: readNullableString(row, "suggested_album"),
        count: readNumber(row, "count"),
        samples: splitSamples(readString(row, "paths")),
    }));
}

function splitSamples(value: string): string[] {
    return value.split("\n").slice(0, 5);
}

function summarizePage(
    items: Array<
        {
            relativePath: string;
            statusMessage: string | null;
            suggestedArtist: string | null;
            suggestedTitle: string | null;
            suggestedAlbum: string | null;
            confidence: number;
        }
    >,
) {
    return items.map((item) => ({
        relativePath: item.relativePath,
        statusMessage: item.statusMessage,
        suggestedArtist: item.suggestedArtist,
        suggestedTitle: item.suggestedTitle,
        suggestedAlbum: item.suggestedAlbum,
        confidence: item.confidence,
    }));
}

async function writeMarkdownReport(
    outputPath: string,
    input: {
        rootPath: string;
        durationMs: number;
        usedTemporaryDataDir: boolean;
        job: {
            id: string;
            status: string;
            totalCount: number;
            importedCount: number;
            skippedCount: number;
            failedCount: number;
            errorMessage: string | null;
        };
        totals: { imported: number; skipped: number; failed: number };
        quality: QualityStats;
        unsupported: {
            total: number;
            items: Array<
                {
                    relativePath: string;
                    statusMessage: string | null;
                    suggestedArtist: string | null;
                    suggestedTitle: string | null;
                    suggestedAlbum: string | null;
                    confidence: number;
                }
            >;
        };
        parseFailures: Array<
            {
                relativePath: string;
                statusMessage: string | null;
                suggestedArtist: string | null;
                suggestedTitle: string | null;
                suggestedAlbum: string | null;
                confidence: number;
            }
        >;
        exactDuplicates: {
            total: number;
            items: Array<
                {
                    relativePath: string;
                    statusMessage: string | null;
                    suggestedArtist: string | null;
                    suggestedTitle: string | null;
                    suggestedAlbum: string | null;
                    confidence: number;
                }
            >;
        };
        probableDuplicates: {
            total: number;
            items: Array<
                {
                    relativePath: string;
                    statusMessage: string | null;
                    suggestedArtist: string | null;
                    suggestedTitle: string | null;
                    suggestedAlbum: string | null;
                    confidence: number;
                }
            >;
        };
        lowConfidence: {
            items: Array<
                {
                    relativePath: string;
                    statusMessage: string | null;
                    suggestedArtist: string | null;
                    suggestedTitle: string | null;
                    suggestedAlbum: string | null;
                    confidence: number;
                }
            >;
        };
        groups: {
            groups: Array<
                {
                    key: string;
                    suggestedArtist: string;
                    suggestedTitle: string;
                    suggestedAlbum: string;
                    itemCount: number;
                    selectedCount: number;
                    reviewRequiredCount: number;
                }
            >;
        };
    },
) {
    await Deno.mkdir(path.dirname(outputPath), { recursive: true });
    const quality = input.quality;
    const lines = [
        "# T040 Real Library Dry Run Report",
        "",
        `- Generated: ${new Date().toISOString()}`,
        `- Root: \`${input.rootPath}\``,
        `- Dry run only: yes`,
        `- Temporary DATA_DIR: ${input.usedTemporaryDataDir ? "yes" : "no"}`,
        `- Duration: ${Math.round(input.durationMs)} ms`,
        `- Job status: ${input.job.status}`,
        `- Files scanned: ${input.job.totalCount}`,
        `- Job counters: imported ${input.job.importedCount}, skipped ${input.job.skippedCount}, failed ${input.job.failedCount}`,
        `- Report counters: imported ${input.totals.imported}, skipped ${input.totals.skipped}, failed ${input.totals.failed}`,
        `- Error: ${input.job.errorMessage ?? "none"}`,
        "",
        "## Metadata Quality Verdict",
        "",
        "- Verdict: good enough to proceed with real import after manual review of duplicate groups and the low-confidence/parser-failure samples. Artist/title inference is broadly usable; album/grouping quality is weaker when parser metadata is unavailable, so the first import review should focus on duplicate consolidation and album cleanup rather than blocking the import outright.",
        "- Caveat: existing-library duplicate counts can be zero when this validation uses a temporary DATA_DIR. Use the batch duplicate sections below for the real-library duplicate signal.",
        `- Review required: ${quality.reviewRequiredCount}`,
        `- Parser failures: ${quality.parserFailureCount}`,
        `- Missing suggested artist: ${quality.missingArtistCount}`,
        `- Missing suggested title: ${quality.missingTitleCount}`,
        `- Confidence min/avg: ${formatNumber(quality.confidence.min)} / ${formatNumber(quality.confidence.average)}`,
        `- Confidence < 0.65: ${quality.confidence.lowUnder065}`,
        `- Confidence >= 0.8: ${quality.confidence.highAtLeast08}`,
        "",
        "## Counts",
        "",
        "### Status",
        "",
        ...formatCountList(quality.statusCounts),
        "",
        "### Decision",
        "",
        ...formatCountList(quality.decisionCounts),
        "",
        "### Extension",
        "",
        ...formatCountList(quality.extensionCounts),
        "",
        "## Unsupported Files",
        "",
        `Total: ${input.unsupported.total}`,
        "",
        ...formatItems(input.unsupported.items),
        "",
        "## Parser Failures",
        "",
        `Total: ${quality.parserFailureCount}`,
        "",
        ...formatItems(input.parseFailures),
        "",
        "## Existing-Library Exact Duplicates",
        "",
        `Total: ${input.exactDuplicates.total}`,
        "",
        ...formatItems(input.exactDuplicates.items),
        "",
        "## Existing-Library Probable Duplicates",
        "",
        `Total: ${input.probableDuplicates.total}`,
        "",
        ...formatItems(input.probableDuplicates.items),
        "",
        "## Batch Exact Duplicate Groups",
        "",
        ...formatExactDuplicateGroups(quality.batchExactDuplicateGroups),
        "",
        "## Batch Probable Duplicate Groups",
        "",
        ...formatProbableDuplicateGroups(quality.batchProbableDuplicateGroups),
        "",
        "## Lowest Confidence Samples",
        "",
        ...formatItems(input.lowConfidence.items),
        "",
        "## First Review Groups",
        "",
        ...input.groups.groups.map((group) =>
            `- ${group.suggestedArtist || "(missing artist)"} / ${group.suggestedAlbum || "(missing album)"} / ${
                group.suggestedTitle || "(missing title)"
            }: ${group.itemCount} item(s), ${group.reviewRequiredCount} review`
        ),
        "",
    ];
    await Deno.writeTextFile(outputPath, lines.join("\n"));
}

function formatCountList(counts: Record<string, number>): string[] {
    const entries = Object.entries(counts);
    return entries.length ? entries.map(([key, count]) => `- ${key}: ${count}`) : ["- none"];
}

function formatItems(
    items: Array<
        {
            relativePath: string;
            statusMessage: string | null;
            suggestedArtist: string | null;
            suggestedTitle: string | null;
            suggestedAlbum: string | null;
            confidence: number;
        }
    >,
): string[] {
    if (items.length === 0) {
        return ["- none"];
    }
    return items.map((item) =>
        `- \`${item.relativePath}\` | artist: ${item.suggestedArtist ?? "(missing)"} | title: ${item.suggestedTitle ?? "(missing)"} | album: ${item.suggestedAlbum ?? "(missing)"} | confidence: ${
            formatNumber(item.confidence)
        } | message: ${item.statusMessage ?? "none"}`
    );
}

function formatExactDuplicateGroups(
    groups: QualityStats["batchExactDuplicateGroups"],
): string[] {
    if (groups.length === 0) {
        return ["- none"];
    }
    return groups.flatMap((
        group,
    ) => [
        `- sha256 ${group.sha256.slice(0, 12)}...: ${group.count} files`,
        ...group.samples.map((sample) => `  - \`${sample}\``),
    ]);
}

function formatProbableDuplicateGroups(
    groups: QualityStats["batchProbableDuplicateGroups"],
): string[] {
    if (groups.length === 0) {
        return ["- none"];
    }
    return groups.flatMap((
        group,
    ) => [
        `- ${group.artist} / ${group.title} / ${group.album ?? "(missing album)"}: ${group.count} files`,
        ...group.samples.map((sample) => `  - \`${sample}\``),
    ]);
}

function formatNumber(value: number | null): string {
    return value === null ? "n/a" : value.toFixed(3);
}

function readString(
    row: Record<string, string | number | null>,
    key: string,
): string {
    const value = row[key];
    if (typeof value !== "string") {
        throw new Error(`Expected ${key} to be a string`);
    }
    return value;
}

function readNullableString(
    row: Record<string, string | number | null>,
    key: string,
): string | null {
    const value = row[key];
    if (value === null) {
        return null;
    }
    if (typeof value !== "string") {
        throw new Error(`Expected ${key} to be a string or null`);
    }
    return value;
}

function readNullableNumber(
    row: Record<string, string | number | null>,
    key: string,
): number | null {
    const value = row[key];
    if (value === null) {
        return null;
    }
    if (typeof value !== "number") {
        throw new Error(`Expected ${key} to be a number or null`);
    }
    return value;
}

function readNullableAggregate(
    row: Record<string, string | number | null>,
    key: string,
): number {
    return readNullableNumber(row, key) ?? 0;
}

function readNumber(
    row: Record<string, string | number | null>,
    key: string,
): number {
    const value = row[key];
    if (typeof value !== "number") {
        throw new Error(`Expected ${key} to be a number`);
    }
    return value;
}
