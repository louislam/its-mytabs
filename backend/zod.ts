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
export type YoutubeSaveRequest = z.infer<typeof SyncRequestSchema>;

export const AudioDataSchema = z.object({
    filename: z.string().min(1),
    syncMethod: syncMethod.default("simple"),
    simpleSync: simpleSync.default(0),
    advancedSync: advancedSync.default(""),
});

export type AudioData = z.infer<typeof AudioDataSchema>;

export const ConfigJsonSchema = z.object({
    tab: TabInfoSchema,
    audio: z.array(AudioDataSchema).default([]),
    youtube: z.array(YoutubeSchema).default([]),
});
export type ConfigJson = z.infer<typeof ConfigJsonSchema>;
