import * as z from "zod";

export const SignUpSchema = z.object({
    email: z.email(),
    name: z.string().min(1),
    password: z.string().min(8),
});

export type SignUpData = z.infer<typeof SignUpSchema>;
