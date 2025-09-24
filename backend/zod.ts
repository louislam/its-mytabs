import * as z from "zod";

export const SignUpSchema = z.object({
    email: z.email(),
    name: z.string().min(1),
    password: z.string().min(8),
});

export type SignUpData = z.infer<typeof SignUpSchema>;

export const TabInfoSchema = z.object({
    id: z.number().default(-1),
    title: z.string().default("Unknown"),
    artist: z.string().default("Unknown"),
    filename: z.string().default("tab.gp"),
    originalFilename: z.string().default("Unknown"),
    createdAt: z.iso.datetime().default(() => new Date().toISOString()),
    public: z.boolean().default(false),
});

export type TabInfo = z.infer<typeof TabInfoSchema>;
