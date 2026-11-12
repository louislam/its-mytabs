import { ImportGroupingMode, ImportItemDecision, ImportJobStatus } from "./zod.ts";

export type ImportItemStatus = "pending" | "parsing" | "ready" | "committed" | "skipped" | "failed";

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
