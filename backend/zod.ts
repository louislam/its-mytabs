import * as z from "zod";

export const SignUpSchema = z.object({
    email: z.email(),
    name: z.string().min(1),
    password: z.string().min(8),
});
export type SignUpData = z.infer<typeof SignUpSchema>;

const title = z.string().min(1);
const artist = z.string().min(0);
const isPublic = z.boolean();
const isFav = z.boolean();

export const TabInfoSchema = z.object({
    id: z.string().default("-1"),
    title: title.default("Unknown"),
    artist: artist.default(""),
    filename: z.string().default("tab.gp"),
    originalFilename: z.string().default("Unknown"),
    createdAt: z.iso.datetime().default(() => new Date().toISOString()),
    public: isPublic.default(false),
    fav: isFav.default(false),
});
export type TabInfo = z.infer<typeof TabInfoSchema>;

export const UpdateTabInfoSchema = z.object({
    title,
    artist,
    public: isPublic,
});
export type UpdateTabInfo = z.infer<typeof UpdateTabInfoSchema>;

export const UpdateTabFavSchema = z.object({
    fav: isFav,
});
export type UpdateTabFav = z.infer<typeof UpdateTabFavSchema>;

const videoID = z.string().min(1);
const syncMethod = z.enum(["simple", "advanced"]);
const simpleSync = z.number();
const advancedSync = z.string();

export const YoutubeSchema = z.object({
    videoID,
    syncMethod: syncMethod.default("simple"),
    simpleSync: simpleSync.default(0),
    advancedSync: advancedSync.default(""),
});
export type Youtube = z.infer<typeof YoutubeSchema>;

export const YoutubeAddDataSchema = z.object({
    videoID,
});
export type YoutubeData = z.infer<typeof YoutubeAddDataSchema>;

export const SyncRequestSchema = z.object({
    syncMethod,
    simpleSync,
    advancedSync,
});
export type SyncRequest = z.infer<typeof SyncRequestSchema>;

export const AudioDataSchema = z.object({
    filename: z.string().min(1),
    syncMethod: syncMethod.default("simple"),
    simpleSync: simpleSync.default(0),
    advancedSync: advancedSync.default(""),
});

export type AudioData = z.infer<typeof AudioDataSchema>;

export const ConfigJSONSchema = z.object({
    tab: TabInfoSchema,
    audio: z.array(AudioDataSchema).default([]),
    youtube: z.array(YoutubeSchema).default([]),
});
export type ConfigJSON = z.infer<typeof ConfigJSONSchema>;

export const ImportJobStatusSchema = z.enum(["created", "scanning", "ready_for_review", "committing", "completed", "failed", "canceled"]);
export type ImportJobStatus = z.infer<typeof ImportJobStatusSchema>;

export const ImportSourceTypeSchema = z.enum(["server-folder"]);
export type ImportSourceType = z.infer<typeof ImportSourceTypeSchema>;

export const ImportCopyModeSchema = z.enum(["copy"]);
export type ImportCopyMode = z.infer<typeof ImportCopyModeSchema>;

export const ImportGroupingModeSchema = z.enum(["auto", "artist-song", "artist-album-song"]);
export type ImportGroupingMode = z.infer<typeof ImportGroupingModeSchema>;

export const ImportItemDecisionSchema = z.enum(["import", "skip_unsupported", "skip_exact_duplicate", "link_duplicate_source", "keep_as_version", "split_song", "manual_skip"]);
export type ImportItemDecision = z.infer<typeof ImportItemDecisionSchema>;

const QueryBooleanSchema = z.preprocess((value) => {
    if (value === "true") {
        return true;
    }
    if (value === "false") {
        return false;
    }
    return value;
}, z.boolean());

export const CreateImportJobSchema = z.object({
    sourceType: ImportSourceTypeSchema.default("server-folder"),
    rootPath: z.string().min(1),
    copyMode: ImportCopyModeSchema.default("copy"),
    groupingMode: ImportGroupingModeSchema.default("auto"),
});
export type CreateImportJobRequest = z.infer<typeof CreateImportJobSchema>;

const QueryStringSchema = z.string().trim().optional();

export const ImportItemsQuerySchema = z.object({
    limit: z.coerce.number().int().min(1).max(200).default(50),
    offset: z.coerce.number().int().min(0).default(0),
    search: QueryStringSchema,
    status: z.enum(["pending", "parsing", "ready", "committed", "skipped", "failed"]).optional(),
    selected: QueryBooleanSchema.optional(),
    duplicate: z.enum(["none", "exact", "probable"]).optional(),
    decision: ImportItemDecisionSchema.optional(),
    sort: z.enum(["artist-title", "album-title", "confidence-asc", "confidence-desc", "source-path"]).default("artist-title"),
});
export type ImportItemsQuery = z.infer<typeof ImportItemsQuerySchema>;

export const PatchImportItemSchema = z.object({
    selected: z.boolean().optional(),
    decision: ImportItemDecisionSchema.optional(),
    suggestedArtist: z.string().trim().min(1).optional(),
    suggestedTitle: z.string().trim().min(1).optional(),
    suggestedAlbum: z.string().trim().optional(),
    suggestedVersionLabel: z.string().trim().optional(),
    reviewRequired: z.boolean().optional(),
});
export type PatchImportItemRequest = z.infer<typeof PatchImportItemSchema>;

export const BulkImportItemsSchema = z.object({
    itemIds: z.array(z.string().min(1)).optional(),
    allMatching: z.boolean().optional(),
    filters: z.object({
        search: QueryStringSchema,
        status: z.enum(["pending", "parsing", "ready", "committed", "skipped", "failed"]).optional(),
        selected: z.boolean().optional(),
        duplicate: z.enum(["none", "exact", "probable"]).optional(),
        decision: ImportItemDecisionSchema.optional(),
        sort: z.enum(["artist-title", "album-title", "confidence-asc", "confidence-desc", "source-path"]).optional(),
    }).optional(),
    action: z.enum(["select", "deselect", "set-decision"]),
    decision: ImportItemDecisionSchema.optional(),
});
export type BulkImportItemsRequest = z.infer<typeof BulkImportItemsSchema>;
