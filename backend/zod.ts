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

export const TabInfoSchema = z.object({
    id: z.number().default(-1),
    title: title.default("Unknown"),
    artist: artist.default("Unknown"),
    filename: z.string().default("tab.gp"),
    originalFilename: z.string().default("Unknown"),
    createdAt: z.iso.datetime().default(() => new Date().toISOString()),
    public: isPublic.default(false),
});
export type TabInfo = z.infer<typeof TabInfoSchema>;

export const UpdateTabInfoSchema = z.object({
    title,
    artist,
    public: isPublic,
});
export type UpdateTabInfo = z.infer<typeof UpdateTabInfoSchema>;

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
export type YoutubeSaveRequest = z.infer<typeof SyncRequestSchema>;

export const AudioDataSchema = z.object({
    filename: z.string().min(1),
    syncMethod: syncMethod.default("simple"),
    simpleSync: simpleSync.default(0),
    advancedSync: advancedSync.default(""),
});

export type AudioData = z.infer<typeof AudioDataSchema>;
