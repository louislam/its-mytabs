import * as z from "zod";

export const SettingSchema = z.object({
    scoreStyle: z.enum(["tab", "score-tab", "score", "auto"]).default("tab"),
    scoreColor: z.enum(["light", "dark"]).default("dark"),
    noteColor: z.enum(["rocksmith", "none"]).default("rocksmith"),
    cursor: z.enum(["animated", "instant", "bar", "invisible"]).default("animated"),
});
export type Setting = z.infer<typeof SettingSchema>;
