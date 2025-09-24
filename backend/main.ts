import { serve } from "@hono/node-server";
import { Hono, MiddlewareHandler } from "@hono/hono";
import * as fs from "@std/fs";
import {auth, disableSignUp, isFinishSetup, isDisableSignUp} from "./auth.ts";
import { SignUpSchema } from "./zod.ts";
import { hasUser } from "./db.ts";
import { cors } from '@hono/hono/cors'
import { serveStatic } from '@hono/hono/deno'
import {devOriginList, isDev} from "./util.ts";
import * as path from "@std/path";

export async function main() {
    const frontendDir = "./dist";

    if (!Deno.build.standalone) {
        // Check if the frontend directory exists
        // If dev, allow not to exist, but create it
        // If prod, check if it exists, if not, exit
        if (!fs.existsSync(frontendDir)) {
            if (isDev()) {
                console.error("You need to build the frontend first. Run `deno task build`.");
            } else {
                console.error(`${frontendDir} does not exist.`);
                console.error(`Please run \`deno task setup\` to build ${frontendDir}`);
            }
            Deno.exit(1);
        }
    }

    // Read index.html content
    const indexHTML = await Deno.readTextFile(path.join(frontendDir, 'index.html'));
    const app = new Hono();

    const httpServer = serve({
        fetch: app.fetch,
        port: 47777,
    }, (info) => {
        console.log(`Server running on http://localhost:${info.port}`);
    });

    // CORS for development
    if (isDev()) {
        app.use('/api/*', cors({
            credentials: true,
            origin: devOriginList,
        }));
    }

    // Better Auth routes
    app.all("/api/auth/*", (c) => {
        return auth.handler(c.req.raw);
    });

    // Is Disable Sign Up
    app.get("/api/is-finish-setup", (c) => {
        return c.json(isFinishSetup());
    });

    app.post("/register", async (c) => {
        try {
            if (hasUser()) {
                return c.json({ error: "User already exists" }, 400);
            }

            const body = SignUpSchema.parse(await c.req.json());

            const data = await auth.api.signUpEmail({
                body,
            });

            return c.json(data);
        } catch (e) {
            if (e instanceof Error) {
                return c.json({ error: e.message }, 400);
            } else {
                return c.json({ error: "Unknown error" }, 400);
            }
        }
    });

    app.get("/", (c) => {
        return c.html(indexHTML);
    });

    // Serve static files
    // @ts-ignore No idea why ts is complaining here
    app.get("*", serveStatic({
        root: './dist',
    }));

    // For SPA, always return index.html
    app.notFound((c) => {
        return c.html(indexHTML, 200);
    });
}

if (import.meta.main) {
    await main();
}
