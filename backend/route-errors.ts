import { Context } from "@hono/hono";
import { ZodError } from "zod";

interface RouteErrorOptions {
    logPrefix: string;
    fallbackMessage: string;
}

export function routeError(c: Context, error: unknown, options: RouteErrorOptions) {
    if (error instanceof ZodError) {
        return c.json({
            ok: false,
            msg: error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("\n"),
        }, 400);
    }

    if (error instanceof Error) {
        if (error.message === "Not logged in") {
            return c.json({ ok: false, msg: "Not logged in" }, 401);
        }
        if (error.message.endsWith("not found") || error.message.endsWith("not found.")) {
            return c.json({ ok: false, msg: error.message }, 404);
        }
        if (isClientError(error.message)) {
            return c.json({ ok: false, msg: error.message }, 400);
        }

        console.error(`${options.logPrefix}:`, error);
        return c.json({ ok: false, msg: options.fallbackMessage }, 500);
    }

    console.error(`${options.logPrefix}:`, error);
    return c.json({ ok: false, msg: options.fallbackMessage }, 500);
}

function isClientError(message: string): boolean {
    return [
        "Cannot ",
        "Import path ",
        "Server-side import ",
        "Suggested artist ",
        "Bulk ",
        "Source and target ",
        "Album does not belong ",
        "Preferred tab ",
        "MusicBrainz user agent ",
        "Split-song import ",
        "Exact duplicate file ",
    ].some((prefix) => message.startsWith(prefix));
}
