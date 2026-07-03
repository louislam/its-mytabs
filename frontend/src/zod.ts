import * as z from "zod";
import { ScrollMode } from "@coderline/alphatab";

export const SettingSchema = z.object({
    scoreStyle: z.enum(["tab", "score-tab", "score", "auto", "horizontal-tab"]).default("tab"),
    scoreColor: z.enum(["light", "dark"]).default("dark"),
    noteColor: z.enum(["rocksmith", "louis-bass-v", "none"]).default("rocksmith"),
    cursor: z.enum(["animated", "instant", "bar", "invisible"]).default(
        "animated",
    ),
    scrollMode: z.enum(ScrollMode).default(ScrollMode.Continuous),
    groupByArtist: z.boolean().default(false),
    showKeySignature: z.boolean().default(false),
    scale: z.number().min(0.1).default(1),
    toolbarAutoHide: z.boolean().default(false),
});
export type Setting = z.infer<typeof SettingSchema>;

export const ImportGroupingModeSchema = z.enum(["auto", "artist-song", "artist-album-song"]);
export type ImportGroupingMode = z.infer<typeof ImportGroupingModeSchema>;

export const ImportJobStatusSchema = z.enum(["created", "scanning", "ready_for_review", "committing", "completed", "failed", "canceled"]);
export type ImportJobStatus = z.infer<typeof ImportJobStatusSchema>;

export const ImportItemStatusSchema = z.enum(["pending", "parsing", "ready", "committed", "skipped", "failed"]);
export type ImportItemStatus = z.infer<typeof ImportItemStatusSchema>;

export const ImportDecisionSchema = z.enum(["import", "skip_unsupported", "skip_exact_duplicate", "link_duplicate_source", "keep_as_version", "split_song", "manual_skip"]);
export type ImportDecision = z.infer<typeof ImportDecisionSchema>;

const NullableStringSchema = z.string().nullable().optional().default(null);
const NullableNumberSchema = z.number().nullable().optional().default(null);
const ApiBooleanSchema = z.union([z.boolean(), z.literal(0), z.literal(1)]).transform(Boolean);

export const ImportJobSchema = z.object({
    id: z.string(),
    sourceType: z.string(),
    rootPath: NullableStringSchema,
    copyMode: z.string().optional().default("copy"),
    groupingMode: ImportGroupingModeSchema,
    status: ImportJobStatusSchema,
    totalCount: z.number().int().nonnegative().optional().default(0),
    importedCount: z.number().int().nonnegative().optional().default(0),
    skippedCount: z.number().int().nonnegative().optional().default(0),
    failedCount: z.number().int().nonnegative().optional().default(0),
    createdAt: z.string(),
    updatedAt: z.string(),
    startedAt: NullableStringSchema,
    finishedAt: NullableStringSchema,
    errorMessage: NullableStringSchema,
});
export type ImportJob = z.infer<typeof ImportJobSchema>;

export const ImportItemSchema = z.object({
    id: z.string(),
    jobId: z.string(),
    sourcePath: z.string(),
    relativePath: z.string().optional().default(""),
    ext: z.string().optional().default(""),
    byteSize: NullableNumberSchema,
    sha256: NullableStringSchema,
    status: ImportItemStatusSchema,
    statusMessage: NullableStringSchema,
    parsedArtist: NullableStringSchema,
    parsedTitle: NullableStringSchema,
    parsedAlbum: NullableStringSchema,
    suggestedArtist: NullableStringSchema,
    suggestedTitle: NullableStringSchema,
    suggestedAlbum: NullableStringSchema,
    suggestedVersionLabel: NullableStringSchema,
    confidence: z.number().min(0).max(1).optional().default(0),
    duplicateTabFileId: NullableNumberSchema,
    probableDuplicateSongId: NullableNumberSchema,
    decision: ImportDecisionSchema,
    selected: ApiBooleanSchema.default(true),
    createdTabId: NullableStringSchema,
    existingTabId: NullableStringSchema,
    committedAt: NullableStringSchema,
    commitError: NullableStringSchema,
    reviewRequired: ApiBooleanSchema.default(false),
    errors: z.array(z.string()).optional().default([]),
    createdAt: z.string(),
    updatedAt: z.string(),
});
export type ImportItem = z.infer<typeof ImportItemSchema>;

export const ImportItemsPageSchema = z.object({
    items: z.array(ImportItemSchema),
    total: z.number().int().nonnegative(),
    limit: z.number().int().positive(),
    offset: z.number().int().nonnegative(),
});
export type ImportItemsPage = z.infer<typeof ImportItemsPageSchema>;

export const ImportReportSchema = z.object({
    job: ImportJobSchema,
    totals: z.object({
        imported: z.number().int().nonnegative().optional().default(0),
        skipped: z.number().int().nonnegative().optional().default(0),
        failed: z.number().int().nonnegative().optional().default(0),
    }),
    createdTabs: z.array(z.object({
        id: z.string(),
        title: z.string(),
        artist: z.string(),
    })).optional().default([]),
    failedItems: z.array(ImportItemSchema).optional().default([]),
});
export type ImportReport = z.infer<typeof ImportReportSchema>;

export const LibraryBrowseVersionSchema = z.object({
    id: z.string(),
    songId: z.number(),
    version: z.number(),
    versionLabel: z.string().nullable(),
    title: z.string(),
    artist: z.string(),
    album: z.string(),
    filename: z.string(),
    originalFilename: z.string(),
    ext: z.string().nullable(),
    public: ApiBooleanSchema,
    fav: ApiBooleanSchema,
    preferred: ApiBooleanSchema,
    hasAudio: ApiBooleanSchema,
    hasYoutube: ApiBooleanSchema,
    createdAt: z.string(),
    updatedAt: z.string(),
});
export type LibraryBrowseVersion = z.infer<typeof LibraryBrowseVersionSchema>;

export const LibraryBrowseSongSchema = z.object({
    id: z.number(),
    title: z.string(),
    preferredTabId: z.string().nullable(),
    preferredVersion: LibraryBrowseVersionSchema.nullable(),
    versionCount: z.number(),
    publicVersionCount: z.number(),
    favVersionCount: z.number(),
    versions: z.array(LibraryBrowseVersionSchema),
});
export type LibraryBrowseSong = z.infer<typeof LibraryBrowseSongSchema>;

export const LibraryBrowseAlbumSchema = z.object({
    id: z.number().nullable(),
    title: z.string(),
    songCount: z.number(),
    versionCount: z.number(),
    songs: z.array(LibraryBrowseSongSchema),
});
export type LibraryBrowseAlbum = z.infer<typeof LibraryBrowseAlbumSchema>;

export const LibraryBrowseArtistSchema = z.object({
    id: z.number(),
    name: z.string(),
    songCount: z.number(),
    versionCount: z.number(),
    albums: z.array(LibraryBrowseAlbumSchema),
    songs: z.array(LibraryBrowseSongSchema),
});
export type LibraryBrowseArtist = z.infer<typeof LibraryBrowseArtistSchema>;

export const LibraryBrowseSchema = z.object({
    mode: z.enum(["album", "flat"]),
    artistCount: z.number(),
    songCount: z.number(),
    versionCount: z.number(),
    totalVersionCount: z.number(),
    offset: z.number(),
    limit: z.number().nullable(),
    hasMore: ApiBooleanSchema,
    artists: z.array(LibraryBrowseArtistSchema),
});
export type LibraryBrowse = z.infer<typeof LibraryBrowseSchema>;
