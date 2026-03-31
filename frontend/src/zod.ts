import * as z from "zod";
import { ScrollMode } from "@coderline/alphatab";

export const SettingSchema = z.object({
    scoreStyle: z.enum(["auto", "tab", "score-tab", "score", "horizontal-tab"]).default("auto"),
    scoreColor: z.enum(["light", "dark"]).default("dark"),
    noteColor: z.enum(["rocksmith", "louis-bass-v", "none"]).default("rocksmith"),
    cursor: z.enum(["animated", "instant", "bar", "invisible"]).default(
        "animated",
    ),
    scrollMode: z.enum(ScrollMode).default(ScrollMode.Continuous),
    groupByArtist: z.boolean().default(false),
    tabSortBy: z.enum(["title", "artist", "dateNewest", "dateOldest"]).default("dateNewest"),
    showKeySignature: z.boolean().default(false),
    scale: z.number().min(0.1).default(1),
    toolbarAutoHide: z.boolean().default(false),
    playlistAutoAdvance: z.boolean().default(false),
});
export type Setting = z.infer<typeof SettingSchema>;
