import * as fs from "@std/fs";
import * as path from "@std/path";
import { db } from "./db.ts";
import { parseAlphaTabFile } from "./alphatab-parser.ts";
import { checkImportPathAllowed, classifyImportExtension, loadImportRootPolicy } from "./import-policy.ts";
import { inferMetadataFromPath, normalizeMetadata } from "./metadata.ts";
import { getCreatedImportTabSummaries, getTabFileByHash, normalizeLibraryText, upsertAlbum, upsertArtist, upsertLibraryTab, upsertSong, upsertTabFile, upsertTabFileSource } from "./library.ts";
import { hashReadableStream, storeLibraryFile } from "./storage.ts";
import { BulkImportItemsRequest, CreateImportJobRequest, ImportGroupingMode, ImportItemDecision, ImportItemsQuery, ImportJobStatus, PatchImportItemRequest } from "./zod.ts";
import { releaseReservedImportTask, reserveImportTask } from "./import-background.ts";

type SqlValue = string | number | bigint | null;
type SqlRow = Record<string, SqlValue>;

type ImportItemStatus = "pending" | "parsing" | "ready" | "committed" | "skipped" | "failed";

export interface ImportJob {
    id: string;
    sourceType: string;
    rootPath: string | null;
    copyMode: string;
    groupingMode: ImportGroupingMode;
    status: ImportJobStatus;
    totalCount: number;
    importedCount: number;
    skippedCount: number;
    failedCount: number;
    createdAt: string;
    updatedAt: string;
    startedAt: string | null;
    finishedAt: string | null;
    errorMessage: string | null;
}

export interface ImportItem {
    id: string;
    jobId: string;
    sourcePath: string;
    relativePath: string;
    ext: string;
    byteSize: number | null;
    sha256: string | null;
    status: ImportItemStatus;
    statusMessage: string | null;
    parsedArtist: string | null;
    parsedTitle: string | null;
    parsedAlbum: string | null;
    suggestedArtist: string | null;
    suggestedTitle: string | null;
    suggestedAlbum: string | null;
    suggestedVersionLabel: string | null;
    confidence: number;
    duplicateTabFileId: number | null;
    probableDuplicateSongId: number | null;
    decision: ImportItemDecision;
    selected: boolean;
    createdTabId: string | null;
    existingTabId: string | null;
    committedAt: string | null;
    commitError: string | null;
    reviewRequired: boolean;
    createdAt: string;
    updatedAt: string;
}

export interface ImportItemsPage {
    items: ImportItem[];
    total: number;
    limit: number;
    offset: number;
}

export interface ImportReviewGroup {
    key: string;
    suggestedArtist: string;
    suggestedTitle: string;
    suggestedAlbum: string;
    probableDuplicateSongId: number | null;
    itemCount: number;
    selectedCount: number;
    reviewRequiredCount: number;
    items: ImportItem[];
}

export interface ImportReport {
    job: ImportJob;
    totals: {
        imported: number;
        skipped: number;
        failed: number;
    };
    createdTabs: Array<{ id: string; title: string; artist: string }>;
    failedItems: ImportItem[];
}

interface Suggestion {
    parsedArtist?: string;
    parsedTitle?: string;
    parsedAlbum?: string;
    suggestedArtist?: string;
    suggestedTitle?: string;
    suggestedAlbum?: string;
    suggestedVersionLabel?: string;
    confidence: number;
    reviewRequired: boolean;
    statusMessage?: string;
}

interface ProbableDuplicate {
    songId: number;
    existingTabId: string | null;
}

export async function createImportJob(input: CreateImportJobRequest): Promise<ImportJob> {
    const policy = await loadImportRootPolicy();
    const check = await checkImportPathAllowed(input.rootPath, policy);
    if (!check.ok) {
        throw new Error(check.message ?? "Import path is not allowed.");
    }

    const now = new Date().toISOString();
    const id = crypto.randomUUID();
    db.prepare(`
        INSERT INTO import_jobs (id, source_type, root_path, copy_mode, grouping_mode, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, 'created', ?, ?)
    `).run(id, input.sourceType, check.realPath ?? input.rootPath, input.copyMode, input.groupingMode, now, now);
    return requireImportJob(id);
}

export function listImportJobs(): ImportJob[] {
    const rows = db.prepare("SELECT * FROM import_jobs ORDER BY datetime(created_at) DESC, id DESC").all() as SqlRow[];
    return rows.map(mapJob);
}

export function getImportJob(id: string): ImportJob | null {
    const row = db.prepare("SELECT * FROM import_jobs WHERE id = ?").get(id) as SqlRow | undefined;
    return row ? mapJob(row) : null;
}

export async function scanImportJob(jobId: string): Promise<ImportJob> {
    const scan = await prepareImportScan(jobId);
    await runImportScan(scan.jobId, scan.rootPath);
    return requireImportJob(scan.jobId);
}

export async function startImportJobScan(jobId: string): Promise<ImportJob> {
    const trackTask = reserveImportTask(jobId);
    try {
        const scan = await prepareImportScan(jobId);
        trackTask(runImportScan(scan.jobId, scan.rootPath));
        return requireImportJob(scan.jobId);
    } catch (error) {
        releaseReservedImportTask(jobId);
        throw error;
    }
}

async function prepareImportScan(jobId: string): Promise<{ jobId: string; rootPath: string }> {
    const job = requireImportJob(jobId);
    if (!["created", "ready_for_review", "failed"].includes(job.status)) {
        throw new Error(`Cannot scan import job with status "${job.status}".`);
    }
    if (!job.rootPath) {
        throw new Error("Import job has no root path.");
    }

    const policy = await loadImportRootPolicy();
    const check = await checkImportPathAllowed(job.rootPath, policy);
    if (!check.ok) {
        throw new Error(check.message ?? "Import path is not allowed.");
    }

    const rootPath = check.realPath ?? job.rootPath;
    const now = new Date().toISOString();
    db.prepare(`
        UPDATE import_jobs
        SET status = 'scanning', root_path = ?, total_count = 0, imported_count = 0, skipped_count = 0, failed_count = 0, started_at = ?, finished_at = NULL, error_message = NULL, updated_at = ?
        WHERE id = ?
    `).run(rootPath, now, now, job.id);
    db.prepare("DELETE FROM import_items WHERE job_id = ?").run(job.id);

    return { jobId: job.id, rootPath };
}

async function runImportScan(jobId: string, rootPath: string): Promise<void> {
    try {
        const stat = await Deno.stat(rootPath);
        if (stat.isFile) {
            await scanOneFile(requireRunnableImportJob(jobId, "scanning"), rootPath, path.basename(rootPath));
        } else if (stat.isDirectory) {
            for await (const entry of fs.walk(rootPath, { includeDirs: false, followSymlinks: false })) {
                if (!entry.isFile) {
                    continue;
                }
                const relativePath = path.relative(rootPath, entry.path).split(path.SEPARATOR).join("/");
                await scanOneFile(requireRunnableImportJob(jobId, "scanning"), entry.path, relativePath);
            }
        } else {
            throw new Error("Import path is not a file or directory.");
        }

        if (getImportJob(jobId)?.status === "scanning") {
            updateJobCounts(jobId, "ready_for_review");
        }
    } catch (error) {
        if (error instanceof ImportCanceledError) {
            return;
        }
        const message = error instanceof Error ? error.message : String(error);
        db.prepare("UPDATE import_jobs SET status = 'failed', error_message = ?, finished_at = ?, updated_at = ? WHERE id = ?").run(
            message,
            new Date().toISOString(),
            new Date().toISOString(),
            jobId,
        );
        throw error;
    }
}

export function listImportItems(jobId: string, input: Partial<ImportItemsQuery> = {}): ImportItemsPage {
    requireImportJob(jobId);
    const query = normalizeItemsQuery(input);
    const { where, params } = buildItemFilter(jobId, query);
    const totalRow = db.prepare(`SELECT COUNT(*) AS count FROM import_items WHERE ${where}`).get(...params) as SqlRow;
    const rows = db.prepare(`
        SELECT * FROM import_items
        WHERE ${where}
        ORDER BY ${itemOrderBy(query.sort)}
        LIMIT ? OFFSET ?
    `).all(...params, query.limit, query.offset) as SqlRow[];

    return {
        items: rows.map(mapItem),
        total: readNumber(totalRow, "count"),
        limit: query.limit,
        offset: query.offset,
    };
}

function normalizeItemsQuery(query: Partial<ImportItemsQuery>): ImportItemsQuery {
    return {
        limit: query.limit ?? 50,
        offset: query.offset ?? 0,
        search: query.search,
        status: query.status,
        selected: query.selected,
        duplicate: query.duplicate,
        decision: query.decision,
        sort: query.sort ?? "artist-title",
    };
}

function buildItemFilter(jobId: string, query: Partial<ImportItemsQuery>): { where: string; params: Array<string | number> } {
    const clauses = ["job_id = ?"];
    const params: Array<string | number> = [jobId];
    if (query.search) {
        clauses.push(`(
            source_path LIKE ? ESCAPE '\\'
            OR relative_path LIKE ? ESCAPE '\\'
            OR suggested_artist LIKE ? ESCAPE '\\'
            OR suggested_title LIKE ? ESCAPE '\\'
            OR suggested_album LIKE ? ESCAPE '\\'
            OR parsed_artist LIKE ? ESCAPE '\\'
            OR parsed_title LIKE ? ESCAPE '\\'
            OR parsed_album LIKE ? ESCAPE '\\'
        )`);
        const search = `%${escapeLike(query.search)}%`;
        params.push(search, search, search, search, search, search, search, search);
    }
    if (query.status) {
        clauses.push("status = ?");
        params.push(query.status);
    }
    if (query.selected !== undefined) {
        clauses.push("selected = ?");
        params.push(query.selected ? 1 : 0);
    }
    if (query.decision) {
        clauses.push("decision = ?");
        params.push(query.decision);
    }
    if (query.duplicate === "none") {
        clauses.push("duplicate_tab_file_id IS NULL AND probable_duplicate_song_id IS NULL");
    } else if (query.duplicate === "exact") {
        clauses.push("duplicate_tab_file_id IS NOT NULL");
    } else if (query.duplicate === "probable") {
        clauses.push("probable_duplicate_song_id IS NOT NULL");
    }
    return { where: clauses.join(" AND "), params };
}

function itemOrderBy(sort: ImportItemsQuery["sort"] | undefined): string {
    switch (sort) {
        case "album-title":
            return "review_required DESC, suggested_album COLLATE NOCASE, suggested_artist COLLATE NOCASE, suggested_title COLLATE NOCASE, relative_path COLLATE NOCASE";
        case "confidence-asc":
            return "confidence ASC, review_required DESC, suggested_artist COLLATE NOCASE, suggested_title COLLATE NOCASE, relative_path COLLATE NOCASE";
        case "confidence-desc":
            return "confidence DESC, review_required DESC, suggested_artist COLLATE NOCASE, suggested_title COLLATE NOCASE, relative_path COLLATE NOCASE";
        case "source-path":
            return "relative_path COLLATE NOCASE, source_path COLLATE NOCASE";
        case "artist-title":
        default:
            return "review_required DESC, probable_duplicate_song_id IS NULL, suggested_artist COLLATE NOCASE, suggested_title COLLATE NOCASE, suggested_album COLLATE NOCASE, relative_path COLLATE NOCASE";
    }
}

function escapeLike(value: string): string {
    return value.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_");
}

export function listImportReviewGroups(jobId: string, query: Partial<ImportItemsQuery> = {}): { groups: ImportReviewGroup[]; page: number; pageSize: number; total: number } {
    const normalizedQuery = normalizeItemsQuery(query);
    const page = listImportItems(jobId, normalizedQuery);
    const groupMap = new Map<string, ImportReviewGroup>();

    for (const item of page.items) {
        const artist = item.suggestedArtist ?? "";
        const title = item.suggestedTitle ?? "";
        const album = item.suggestedAlbum ?? "";
        const key = item.probableDuplicateSongId !== null
            ? `song:${item.probableDuplicateSongId}`
            : `meta:${normalizeLibraryText(artist)}:${normalizeLibraryText(title)}:${normalizeLibraryText(album)}`;
        const group = groupMap.get(key) ?? {
            key,
            suggestedArtist: artist,
            suggestedTitle: title,
            suggestedAlbum: album,
            probableDuplicateSongId: item.probableDuplicateSongId,
            itemCount: 0,
            selectedCount: 0,
            reviewRequiredCount: 0,
            items: [],
        };
        group.itemCount++;
        if (item.selected) {
            group.selectedCount++;
        }
        if (item.reviewRequired) {
            group.reviewRequiredCount++;
        }
        group.items.push(item);
        groupMap.set(key, group);
    }

    return {
        groups: [...groupMap.values()],
        page: Math.floor(normalizedQuery.offset / normalizedQuery.limit) + 1,
        pageSize: normalizedQuery.limit,
        total: page.total,
    };
}

export function patchImportItem(jobId: string, itemId: string, patch: PatchImportItemRequest): ImportItem {
    const job = requireImportJob(jobId);
    if (!["ready_for_review", "failed"].includes(job.status)) {
        throw new Error(`Cannot edit import items while job status is "${job.status}".`);
    }
    requireImportItem(jobId, itemId);

    const updates: string[] = [];
    const params: Array<string | number | null> = [];
    if (patch.selected !== undefined) {
        updates.push("selected = ?");
        params.push(patch.selected ? 1 : 0);
    }
    if (patch.decision !== undefined) {
        updates.push("decision = ?");
        params.push(patch.decision);
        if (isSkipDecision(patch.decision) && patch.selected === undefined) {
            updates.push("selected = 0");
        }
    }
    if (patch.suggestedArtist !== undefined) {
        updates.push("suggested_artist = ?");
        params.push(patch.suggestedArtist);
    }
    if (patch.suggestedTitle !== undefined) {
        updates.push("suggested_title = ?");
        params.push(patch.suggestedTitle);
    }
    if (patch.suggestedAlbum !== undefined) {
        updates.push("suggested_album = ?");
        params.push(patch.suggestedAlbum);
    }
    if (patch.suggestedVersionLabel !== undefined) {
        updates.push("suggested_version_label = ?");
        params.push(patch.suggestedVersionLabel || null);
    }
    if (patch.reviewRequired !== undefined) {
        updates.push("review_required = ?");
        params.push(patch.reviewRequired ? 1 : 0);
    }
    if (updates.length === 0) {
        return requireImportItem(jobId, itemId);
    }

    updates.push("updated_at = ?");
    params.push(new Date().toISOString(), itemId, jobId);
    db.prepare(`UPDATE import_items SET ${updates.join(", ")} WHERE id = ? AND job_id = ?`).run(...params);
    updateProbableDuplicateForItem(jobId, itemId);
    return requireImportItem(jobId, itemId);
}

export function bulkUpdateImportItems(jobId: string, input: BulkImportItemsRequest): { updated: number; page: ImportItemsPage } {
    const job = requireImportJob(jobId);
    if (!["ready_for_review", "failed"].includes(job.status)) {
        throw new Error(`Cannot bulk edit import items while job status is "${job.status}".`);
    }
    if (input.action === "set-decision" && !input.decision) {
        throw new Error("Bulk set-decision requires a decision.");
    }

    const filterQuery: Partial<ImportItemsQuery> = input.allMatching ? input.filters ?? {} : {};
    const { where, params } = buildItemFilter(jobId, filterQuery);
    const clauses = [where];
    if (!input.allMatching && input.itemIds?.length) {
        clauses.push(`id IN (${input.itemIds.map(() => "?").join(", ")})`);
        params.push(...input.itemIds);
    } else if (!input.allMatching) {
        return {
            updated: 0,
            page: listImportItems(jobId),
        };
    }

    const updates: string[] = [];
    const updateParams: Array<string | number> = [];
    if (input.action === "select") {
        updates.push("selected = 1");
    } else if (input.action === "deselect") {
        updates.push("selected = 0");
    } else {
        updates.push("decision = ?");
        updateParams.push(input.decision!);
        if (isSkipDecision(input.decision!)) {
            updates.push("selected = 0");
        }
    }
    updates.push("updated_at = ?");
    updateParams.push(new Date().toISOString());

    const result = db.prepare(`UPDATE import_items SET ${updates.join(", ")} WHERE ${clauses.join(" AND ")}`).run(...updateParams, ...params);
    return {
        updated: Number(result.changes),
        page: listImportItems(jobId, {
            limit: input.itemIds?.length || 50,
            offset: 0,
            sort: input.filters?.sort ?? "artist-title",
        }),
    };
}

export async function commitImportJob(jobId: string): Promise<ImportJob> {
    prepareImportCommit(jobId);
    await runImportCommit(jobId);
    return requireImportJob(jobId);
}

export async function startImportJobCommit(jobId: string): Promise<ImportJob> {
    const trackTask = reserveImportTask(jobId);
    try {
        prepareImportCommit(jobId);
        trackTask(runImportCommit(jobId));
        return requireImportJob(jobId);
    } catch (error) {
        releaseReservedImportTask(jobId);
        throw error;
    }
}

function prepareImportCommit(jobId: string): void {
    const job = requireImportJob(jobId);
    if (job.status !== "ready_for_review" && job.status !== "failed") {
        throw new Error(`Cannot commit import job with status "${job.status}".`);
    }

    db.prepare("UPDATE import_jobs SET status = 'committing', updated_at = ? WHERE id = ?").run(new Date().toISOString(), jobId);
}

async function runImportCommit(jobId: string): Promise<void> {
    const rows = db.prepare(`
        SELECT * FROM import_items
        WHERE job_id = ? AND status IN ('ready', 'failed')
        ORDER BY relative_path COLLATE NOCASE
    `).all(jobId) as SqlRow[];

    for (const row of rows) {
        const item = mapItem(row);
        if (!item.selected || isSkipDecision(item.decision)) {
            markItemSkipped(item.id, item.jobId);
            continue;
        }
        try {
            await commitImportItem(requireRunnableImportJob(jobId, "committing"), item);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            db.prepare("UPDATE import_items SET status = 'failed', commit_error = ?, updated_at = ? WHERE id = ? AND job_id = ?").run(message, new Date().toISOString(), item.id, item.jobId);
        }
    }

    if (getImportJob(jobId)?.status === "committing") {
        updateJobCounts(jobId, "completed");
    }
}

export function cancelImportJob(jobId: string): ImportJob {
    const job = requireImportJob(jobId);
    if (["completed", "canceled"].includes(job.status)) {
        return job;
    }
    if (job.status === "committing") {
        throw new Error("Cannot cancel a job that is committing.");
    }
    db.prepare("UPDATE import_jobs SET status = 'canceled', finished_at = ?, updated_at = ? WHERE id = ?").run(new Date().toISOString(), new Date().toISOString(), jobId);
    return requireImportJob(jobId);
}

export function getImportReport(jobId: string): ImportReport {
    const job = requireImportJob(jobId);
    const countsRow = db.prepare(`
        SELECT
            COUNT(*) AS total,
            SUM(CASE WHEN status = 'ready' THEN 1 ELSE 0 END) AS ready,
            SUM(CASE WHEN status = 'committed' THEN 1 ELSE 0 END) AS committed,
            SUM(CASE WHEN status = 'skipped' THEN 1 ELSE 0 END) AS skipped,
            SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed,
            SUM(CASE WHEN selected = 1 THEN 1 ELSE 0 END) AS selected,
            SUM(CASE WHEN review_required = 1 THEN 1 ELSE 0 END) AS review_required,
            SUM(CASE WHEN duplicate_tab_file_id IS NOT NULL THEN 1 ELSE 0 END) AS exact_duplicates,
            SUM(CASE WHEN probable_duplicate_song_id IS NOT NULL THEN 1 ELSE 0 END) AS probable_duplicates
        FROM import_items
        WHERE job_id = ?
    `).get(jobId) as SqlRow;
    const errorRows = db.prepare(`
        SELECT *
        FROM import_items
        WHERE job_id = ? AND status = 'failed'
        ORDER BY relative_path COLLATE NOCASE
    `).all(jobId) as SqlRow[];

    return {
        job,
        totals: {
            imported: readNullableAggregate(countsRow, "committed"),
            skipped: readNullableAggregate(countsRow, "skipped"),
            failed: readNullableAggregate(countsRow, "failed"),
        },
        createdTabs: getCreatedImportTabSummaries(jobId),
        failedItems: errorRows.map(mapItem),
    };
}

async function scanOneFile(job: ImportJob, sourcePath: string, relativePath: string): Promise<void> {
    const extensionPolicy = classifyImportExtension(sourcePath);
    const now = new Date().toISOString();
    const stat = await Deno.stat(sourcePath);
    const itemId = crypto.randomUUID();

    if (!extensionPolicy.supported) {
        db.prepare(`
            INSERT INTO import_items (id, job_id, source_path, relative_path, ext, byte_size, status, status_message, decision, selected, review_required, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, 'skipped', ?, 'skip_unsupported', 0, 0, ?, ?)
        `).run(itemId, job.id, sourcePath, relativePath, extensionPolicy.extension, stat.size, extensionPolicy.reason, now, now);
        incrementJobTotal(job.id);
        return;
    }

    const hash = await hashFile(sourcePath);
    const parseResult = await parseAlphaTabFile(sourcePath);
    const suggestion = buildSuggestion({
        relativePath,
        groupingMode: job.groupingMode,
        parserMetadata: parseResult.ok ? parseResult.summary : undefined,
        parserError: parseResult.ok ? undefined : parseResult.error.message,
    });
    const duplicateFile = getTabFileByHash(hash.sha256);
    const probableDuplicate = suggestion.suggestedArtist && suggestion.suggestedTitle
        ? findProbableDuplicate(suggestion.suggestedArtist, suggestion.suggestedTitle, suggestion.suggestedAlbum ?? "")
        : null;
    const decision = duplicateFile ? "link_duplicate_source" : probableDuplicate ? "keep_as_version" : "import";
    const reviewRequired = suggestion.reviewRequired || decision === "keep_as_version";

    db.prepare(`
        INSERT INTO import_items (
            id, job_id, source_path, relative_path, ext, byte_size, sha256, status, status_message,
            parsed_artist, parsed_title, parsed_album, suggested_artist, suggested_title, suggested_album, suggested_version_label,
            confidence, duplicate_tab_file_id, probable_duplicate_song_id, decision, selected, existing_tab_id, review_required, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, 'ready', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)
    `).run(
        itemId,
        job.id,
        sourcePath,
        relativePath,
        extensionPolicy.extension,
        hash.byteSize,
        hash.sha256,
        suggestion.statusMessage ?? null,
        suggestion.parsedArtist ?? null,
        suggestion.parsedTitle ?? null,
        suggestion.parsedAlbum ?? null,
        suggestion.suggestedArtist ?? null,
        suggestion.suggestedTitle ?? null,
        suggestion.suggestedAlbum ?? null,
        suggestion.suggestedVersionLabel ?? null,
        suggestion.confidence,
        duplicateFile?.id ?? null,
        probableDuplicate?.songId ?? null,
        decision,
        probableDuplicate?.existingTabId ?? null,
        reviewRequired ? 1 : 0,
        now,
        now,
    );
    incrementJobTotal(job.id);
}

function buildSuggestion(input: {
    relativePath: string;
    groupingMode: ImportGroupingMode;
    parserMetadata?: { artist?: string; title?: string; album?: string };
    parserError?: string;
}): Suggestion {
    const pathInference = inferMetadataFromPath(input.relativePath);
    const filenameInference = inferMetadataFromPath(path.basename(input.relativePath));
    const parsed = normalizeMetadata(input.parserMetadata ?? {});

    const suggestedArtist = parsed.artist ?? pathInference.artist ?? filenameInference.artist;
    const suggestedTitle = parsed.title ?? pathInference.title ?? filenameInference.title;
    let suggestedAlbum = parsed.album ?? pathInference.album ?? filenameInference.album;
    if (input.groupingMode === "artist-song") {
        suggestedAlbum = undefined;
    }

    const confidenceParts = [pathInference.confidence, filenameInference.confidence * 0.7];
    if (parsed.artist) {
        confidenceParts.push(0.9);
    }
    if (parsed.title) {
        confidenceParts.push(0.9);
    }
    if (parsed.album || suggestedAlbum) {
        confidenceParts.push(0.75);
    }
    const confidence = clamp(confidenceParts.reduce((sum, value) => sum + value, 0) / confidenceParts.length);
    const reviewRequired = !suggestedArtist || !suggestedTitle || confidence < 0.65 || !!input.parserError;

    return {
        parsedArtist: parsed.artist,
        parsedTitle: parsed.title,
        parsedAlbum: parsed.album,
        suggestedArtist,
        suggestedTitle,
        suggestedAlbum,
        suggestedVersionLabel: pathInference.versionLabel ?? filenameInference.versionLabel,
        confidence,
        reviewRequired,
        statusMessage: input.parserError ? `Parser metadata unavailable: ${input.parserError}` : undefined,
    };
}

function findProbableDuplicate(artist: string, title: string, album: string): ProbableDuplicate | null {
    const normalizedArtist = normalizeLibraryText(artist);
    const normalizedTitle = normalizeLibraryText(title);
    const normalizedAlbum = normalizeLibraryText(album);
    const row = normalizedAlbum
        ? db.prepare(`
            SELECT songs.id AS song_id, tabs.id AS tab_id
            FROM songs
            INNER JOIN artists ON artists.id = songs.artist_id
            LEFT JOIN albums ON albums.id = songs.album_id
            LEFT JOIN tabs ON tabs.song_id = songs.id AND tabs.deleted_at IS NULL
            WHERE artists.normalized_name = ? AND songs.normalized_title = ? AND albums.normalized_title = ?
            ORDER BY tabs.version DESC
            LIMIT 1
        `).get(normalizedArtist, normalizedTitle, normalizedAlbum) as SqlRow | undefined
        : db.prepare(`
            SELECT songs.id AS song_id, tabs.id AS tab_id
            FROM songs
            INNER JOIN artists ON artists.id = songs.artist_id
            LEFT JOIN tabs ON tabs.song_id = songs.id AND tabs.deleted_at IS NULL
            WHERE artists.normalized_name = ? AND songs.normalized_title = ?
            ORDER BY songs.album_id IS NOT NULL, tabs.version DESC
            LIMIT 1
        `).get(normalizedArtist, normalizedTitle) as SqlRow | undefined;

    if (!row) {
        return null;
    }
    return {
        songId: readNumber(row, "song_id"),
        existingTabId: readNullableString(row, "tab_id"),
    };
}

function updateProbableDuplicateForItem(jobId: string, itemId: string): void {
    const item = requireImportItem(jobId, itemId);
    const duplicate = item.suggestedArtist && item.suggestedTitle ? findProbableDuplicate(item.suggestedArtist, item.suggestedTitle, item.suggestedAlbum ?? "") : null;
    db.prepare("UPDATE import_items SET probable_duplicate_song_id = ?, existing_tab_id = ?, updated_at = ? WHERE id = ? AND job_id = ?").run(
        duplicate?.songId ?? null,
        duplicate?.existingTabId ?? null,
        new Date().toISOString(),
        itemId,
        jobId,
    );
}

async function commitImportItem(job: ImportJob, item: ImportItem): Promise<void> {
    if (item.decision === "link_duplicate_source") {
        if (item.duplicateTabFileId === null) {
            throw new Error("Exact duplicate file is missing.");
        }
        upsertTabFileSource({
            tabFileId: item.duplicateTabFileId,
            sourceType: job.sourceType,
            sourcePath: item.sourcePath,
            originalFilename: path.basename(item.sourcePath),
            metadata: sourceMetadata(item),
        });
        db.prepare("UPDATE import_items SET status = 'committed', committed_at = ?, updated_at = ? WHERE id = ? AND job_id = ?").run(
            new Date().toISOString(),
            new Date().toISOString(),
            item.id,
            item.jobId,
        );
        return;
    }

    if (item.decision === "split_song") {
        throw new Error("Split-song import decisions must be resolved before commit.");
    }

    if (!item.suggestedArtist || !item.suggestedTitle) {
        throw new Error("Suggested artist and title are required before commit.");
    }

    const file = await storeFileFromPath(item.sourcePath, item.ext);
    const tabFile = upsertTabFile(file);
    upsertTabFileSource({
        tabFileId: tabFile.id,
        sourceType: job.sourceType,
        sourcePath: item.sourcePath,
        originalFilename: path.basename(item.sourcePath),
        metadata: sourceMetadata(item),
    });

    const artist = upsertArtist(item.suggestedArtist);
    const album = item.suggestedAlbum ? upsertAlbum(artist.id, item.suggestedAlbum) : null;
    const song = resolveImportTargetSong(item, artist.id, album?.id ?? null);
    const tab = upsertLibraryTab({
        songId: song.id,
        tabFileId: tabFile.id,
        versionLabel: item.suggestedVersionLabel,
        filename: `tab.${item.ext || tabFile.ext}`,
        originalFilename: path.basename(item.sourcePath),
        public: false,
        fav: false,
    });
    db.prepare("UPDATE import_items SET status = 'committed', created_tab_id = ?, committed_at = ?, commit_error = NULL, updated_at = ? WHERE id = ? AND job_id = ?").run(
        tab.id,
        new Date().toISOString(),
        new Date().toISOString(),
        item.id,
        item.jobId,
    );
}

function resolveImportTargetSong(item: ImportItem, artistId: number, albumId: number | null): { id: number } {
    if (item.decision === "keep_as_version" && item.probableDuplicateSongId !== null && songExists(item.probableDuplicateSongId)) {
        return { id: item.probableDuplicateSongId };
    }
    return upsertSong(artistId, item.suggestedTitle!, albumId);
}

function songExists(songId: number): boolean {
    const row = db.prepare("SELECT 1 AS found FROM songs WHERE id = ?").get(songId) as SqlRow | undefined;
    return !!row;
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

async function hashFile(filePath: string): Promise<{ sha256: string; byteSize: number }> {
    const file = await Deno.open(filePath, { read: true });
    return await hashReadableStream(file.readable);
}

function sourceMetadata(item: ImportItem): Record<string, unknown> {
    return {
        importJobId: item.jobId,
        importItemId: item.id,
        relativePath: item.relativePath,
        parsedArtist: item.parsedArtist,
        parsedTitle: item.parsedTitle,
        parsedAlbum: item.parsedAlbum,
        suggestedArtist: item.suggestedArtist,
        suggestedTitle: item.suggestedTitle,
        suggestedAlbum: item.suggestedAlbum,
        confidence: item.confidence,
        decision: item.decision,
    };
}

function markItemSkipped(itemId: string, jobId: string): void {
    db.prepare("UPDATE import_items SET status = 'skipped', committed_at = ?, updated_at = ? WHERE id = ? AND job_id = ?").run(new Date().toISOString(), new Date().toISOString(), itemId, jobId);
}

function updateJobCounts(jobId: string, status: ImportJobStatus): void {
    const row = db.prepare(`
        SELECT
            COUNT(*) AS total,
            SUM(CASE WHEN status = 'committed' THEN 1 ELSE 0 END) AS imported,
            SUM(CASE WHEN status = 'skipped' THEN 1 ELSE 0 END) AS skipped,
            SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed
        FROM import_items
        WHERE job_id = ?
    `).get(jobId) as SqlRow;
    const now = new Date().toISOString();
    const finishedAt = ["ready_for_review", "completed", "failed", "canceled"].includes(status) ? now : null;
    db.prepare(`
        UPDATE import_jobs
        SET status = ?, total_count = ?, imported_count = ?, skipped_count = ?, failed_count = ?, finished_at = ?, updated_at = ?
        WHERE id = ?
    `).run(status, readNumber(row, "total"), readNullableAggregate(row, "imported"), readNullableAggregate(row, "skipped"), readNullableAggregate(row, "failed"), finishedAt, now, jobId);
}

function incrementJobTotal(jobId: string): void {
    db.prepare("UPDATE import_jobs SET total_count = total_count + 1, updated_at = ? WHERE id = ?").run(new Date().toISOString(), jobId);
}

function isSkipDecision(decision: ImportItemDecision): boolean {
    return decision === "skip_unsupported" || decision === "skip_exact_duplicate" || decision === "manual_skip";
}

function requireImportJob(id: string): ImportJob {
    const job = getImportJob(id);
    if (!job) {
        throw new Error("Import job not found.");
    }
    return job;
}

function requireRunnableImportJob(id: string, expectedStatus: ImportJobStatus): ImportJob {
    const job = requireImportJob(id);
    if (job.status === "canceled") {
        throw new ImportCanceledError();
    }
    if (job.status !== expectedStatus) {
        throw new Error(`Import job changed status to "${job.status}".`);
    }
    return job;
}

class ImportCanceledError extends Error {
    constructor() {
        super("Import job canceled.");
    }
}

function requireImportItem(jobId: string, itemId: string): ImportItem {
    const row = db.prepare("SELECT * FROM import_items WHERE id = ? AND job_id = ?").get(itemId, jobId) as SqlRow | undefined;
    if (!row) {
        throw new Error("Import item not found.");
    }
    return mapItem(row);
}

function mapJob(row: SqlRow): ImportJob {
    return {
        id: readString(row, "id"),
        sourceType: readString(row, "source_type"),
        rootPath: readNullableString(row, "root_path"),
        copyMode: readString(row, "copy_mode"),
        groupingMode: readString(row, "grouping_mode") as ImportGroupingMode,
        status: readString(row, "status") as ImportJobStatus,
        totalCount: readNumber(row, "total_count"),
        importedCount: readNumber(row, "imported_count"),
        skippedCount: readNumber(row, "skipped_count"),
        failedCount: readNumber(row, "failed_count"),
        createdAt: readString(row, "created_at"),
        updatedAt: readString(row, "updated_at"),
        startedAt: readNullableString(row, "started_at"),
        finishedAt: readNullableString(row, "finished_at"),
        errorMessage: readNullableString(row, "error_message"),
    };
}

function mapItem(row: SqlRow): ImportItem {
    return {
        id: readString(row, "id"),
        jobId: readString(row, "job_id"),
        sourcePath: readString(row, "source_path"),
        relativePath: readString(row, "relative_path"),
        ext: readString(row, "ext"),
        byteSize: readNullableNumber(row, "byte_size"),
        sha256: readNullableString(row, "sha256"),
        status: readString(row, "status") as ImportItemStatus,
        statusMessage: readNullableString(row, "status_message"),
        parsedArtist: readNullableString(row, "parsed_artist"),
        parsedTitle: readNullableString(row, "parsed_title"),
        parsedAlbum: readNullableString(row, "parsed_album"),
        suggestedArtist: readNullableString(row, "suggested_artist"),
        suggestedTitle: readNullableString(row, "suggested_title"),
        suggestedAlbum: readNullableString(row, "suggested_album"),
        suggestedVersionLabel: readNullableString(row, "suggested_version_label"),
        confidence: readNumber(row, "confidence"),
        duplicateTabFileId: readNullableNumber(row, "duplicate_tab_file_id"),
        probableDuplicateSongId: readNullableNumber(row, "probable_duplicate_song_id"),
        decision: readString(row, "decision") as ImportItemDecision,
        selected: readBoolean(row, "selected"),
        createdTabId: readNullableString(row, "created_tab_id"),
        existingTabId: readNullableString(row, "existing_tab_id"),
        committedAt: readNullableString(row, "committed_at"),
        commitError: readNullableString(row, "commit_error"),
        reviewRequired: readBoolean(row, "review_required"),
        createdAt: readString(row, "created_at"),
        updatedAt: readString(row, "updated_at"),
    };
}

function readString(row: SqlRow, key: string): string {
    const value = row[key];
    if (typeof value !== "string") {
        throw new Error(`Expected ${key} to be a string`);
    }
    return value;
}

function readNullableString(row: SqlRow, key: string): string | null {
    const value = row[key];
    if (value === null) {
        return null;
    }
    if (typeof value !== "string") {
        throw new Error(`Expected ${key} to be a string or null`);
    }
    return value;
}

function readNumber(row: SqlRow, key: string): number {
    const value = row[key];
    if (typeof value === "number") {
        return value;
    }
    if (typeof value === "bigint") {
        return Number(value);
    }
    throw new Error(`Expected ${key} to be a number`);
}

function readNullableNumber(row: SqlRow, key: string): number | null {
    const value = row[key];
    if (value === null) {
        return null;
    }
    if (typeof value === "number") {
        return value;
    }
    if (typeof value === "bigint") {
        return Number(value);
    }
    throw new Error(`Expected ${key} to be a number or null`);
}

function readBoolean(row: SqlRow, key: string): boolean {
    return readNumber(row, key) === 1;
}

function readNullableAggregate(row: SqlRow, key: string): number {
    const value = row[key];
    if (value === null) {
        return 0;
    }
    return readNumber(row, key);
}

function clamp(value: number): number {
    return Math.max(0, Math.min(1, Number(value.toFixed(2))));
}
