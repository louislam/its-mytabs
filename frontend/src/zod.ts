import * as z from "zod";
import { ScrollMode } from "@coderline/alphatab";

export const SettingSchema = z.object({
    scoreStyle: z.enum(["tab", "score-tab", "score", "auto"]).default("tab"),
    scoreColor: z.enum(["light", "dark"]).default("dark"),
    noteColor: z.enum(["rocksmith", "louis-bass-v", "none"]).default("rocksmith"),
    cursor: z.enum(["animated", "instant", "bar", "invisible"]).default(
        "animated",
    ),
    scrollMode: z.enum(ScrollMode).default(ScrollMode.Continuous),
    groupByArtist: z.boolean().default(false),
    showKeySignature: z.boolean().default(false),
});
export type Setting = z.infer<typeof SettingSchema>;
