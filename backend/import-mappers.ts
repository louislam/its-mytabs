import { ImportGroupingMode, ImportItemDecision, ImportJobStatus } from "./zod.ts";
import { ImportItem, ImportItemStatus, ImportJob } from "./import-types.ts";
import { readBoolean, readNullableNumber, readNullableString, readNumber, readString, SqlRow } from "./sql-row.ts";

export function mapJob(row: SqlRow): ImportJob {
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

export function mapItem(row: SqlRow): ImportItem {
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
