import { serve } from "@hono/node-server";
import { Context, Hono, MiddlewareHandler } from "@hono/hono";
import * as fs from "@std/fs";
import { auth, checkLogin, disableSignUp, isDisableSignUp, isFinishSetup, isLoggedIn } from "./auth.ts";
import { SignUpSchema, TabInfo, TabInfoSchema, UpdateTabInfoSchema, YoutubeAddDataSchema, YoutubeSaveRequestSchema } from "./zod.ts";
import { db, hasUser, kv } from "./db.ts";
import { cors } from "@hono/hono/cors";
import { serveStatic } from "@hono/hono/deno";
import { devOriginList, isDev } from "./util.ts";
import * as path from "@std/path";
import { supportedFormatList } from "./common.ts";
import {
    addYoutube, createTab, deleteTab, getTab, getTabFilePath, getTabFullFilePath, getYoutubeList, removeYoutube,
    replaceTab, updateTab, updateYoutube
} from "./tab.ts";
import { ZodError } from "zod";

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
    const indexHTML = await Deno.readTextFile(path.join(frontendDir, "index.html"));
    const app = new Hono();

    const httpServer = serve({
        fetch: app.fetch,
        port: 47777,
    }, (info) => {
        console.log(`Server running on http://localhost:${info.port}`);
    });

    // CORS for development
    if (isDev()) {
        app.use(
            "/api/*",
            cors({
                credentials: true,
                origin: devOriginList,
            }),
        );
    }

    // Better-Auth routes
    app.all("/api/auth/*", (c) => {
        return auth.handler(c.req.raw);
    });

    // Is Disable Sign Up
    app.get("/api/is-finish-setup", (c) => {
        return c.json(isFinishSetup());
    });

    // Register Admin account
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

    // New Tab
    app.post("/api/new-tab", async (c) => {
        try {
            await checkLogin(c);

            const form = await c.req.formData();
            const file = form.get("file");

            if (!(file instanceof File)) {
                throw new Error("No file uploaded");
            }

            // Check file ext if in supportedFormatList
            const fileName = file.name;
            const ext = fileName.split(".").pop()?.toLowerCase();
            if (!ext) {
                throw new Error("File has no extension");
            }

            if (!supportedFormatList.includes(ext)) {
                throw new Error("Unsupported file format: " + ext);
            }

            let title = form.get("title") || fileName;
            let artist = form.get("artist") || "Unknown";

            // Check title and artist type is string
            if (typeof title !== "string" || typeof artist !== "string") {
                throw new Error("Invalid title or artist");
            }

            title = title.trim();
            artist = artist.trim();

            const arrayBuffer = await file.arrayBuffer();
            let id = await createTab(new Uint8Array(arrayBuffer), ext, title, artist, fileName);

            return c.json({
                ok: true,
                id,
            });
        } catch (e) {
            return generalError(c, e);
        }
    });

    // Get Tab List
    app.get("/api/tabs", async (c) => {
        try {
            await checkLogin(c);

            const tabGenerator = kv.list({
                prefix: ["tab"],
            });

            const tabList: TabInfo[] = [];

            for await (const entry of tabGenerator) {
                try {
                    // add to head
                    tabList.unshift(TabInfoSchema.parse(entry.value));
                } catch (e) {
                    console.warn("Invalid tab info in KV:", entry.key, entry.value);
                }
            }

            return c.json({
                ok: true,
                tabs: tabList,
            });
        } catch (e) {
            return generalError(c, e);
        }
    });

    // Get Tab
    app.get("/api/tab/:id", async (c) => {
        try {
            const id = parseInt(c.req.param("id"));
            if (isNaN(id)) {
                throw new Error("Invalid tab ID");
            }

            const tab = await getTab(id);

            if (!tab.public) {
                await checkLogin(c);
            }

            const youtubeList = await getYoutubeList(id);
            const filePath = (await isLoggedIn(c)) ? getTabFullFilePath(tab) : "";

            return c.json({
                ok: true,
                tab,
                youtubeList,
                filePath,
            });
        } catch (e) {
            return generalError(c, e);
        }
    });

    // Edit Tab
    app.post("/api/tab/:id", async (c) => {
        try {
            await checkLogin(c);
            const id = parseInt(c.req.param("id"));
            if (isNaN(id)) {
                throw new Error("Invalid tab ID");
            }

            const body = await c.req.json();
            const data = UpdateTabInfoSchema.parse(body);

            const tab = await getTab(id);
            await updateTab(tab, data);
            return c.json({
                ok: true,
            });
        } catch (e) {
            return generalError(c, e);
        }
    });

    // Replace Tab File
    app.post("/api/tab/:id/replace", async (c) => {
        try {
            await checkLogin(c);
            const id = parseInt(c.req.param("id"));
            if (isNaN(id)) {
                throw new Error("Invalid tab ID");
            }

            const tab = await getTab(id);

            const form = await c.req.formData();
            const file = form.get("file");

            if (!(file instanceof File)) {
                throw new Error("No file uploaded");
            }

            // Check file ext if in supportedFormatList
            const fileName = file.name;
            const ext = fileName.split(".").pop()?.toLowerCase();
            if (!ext) {
                throw new Error("File has no extension");
            }

            if (!supportedFormatList.includes(ext)) {
                throw new Error("Unsupported file format: " + ext);
            }

            const arrayBuffer = await file.arrayBuffer();
            await replaceTab(tab, new Uint8Array(arrayBuffer), ext, fileName);

            return c.json({
                ok: true,
            });

        } catch (e) {
            return generalError(c, e);
        }
    });

    // Delete Tab
    app.delete("/api/tab/:id", async (c) => {
        try {
            await checkLogin(c);
            const id = parseInt(c.req.param("id"));
            if (isNaN(id)) {
                throw new Error("Invalid tab ID");
            }

            await deleteTab(id);

            return c.json({
                ok: true,
            });
        } catch (e) {
            return generalError(c, e);
        }
    });

    // Add Youtube (/api/tab/${tabID}/youtube)
    app.post("/api/tab/:id/youtube", async (c) => {
        try {
            await checkLogin(c);
            const id = parseInt(c.req.param("id"));
            if (isNaN(id)) {
                throw new Error("Invalid tab ID");
            }

            const body = await c.req.json();
            const data = YoutubeAddDataSchema.parse(body);

            await getTab(id);
            await addYoutube(id, data.videoID);

            return c.json({
                ok: true,
            });
        } catch (e) {
            return generalError(c, e);
        }
    });

    // Save Youtube config (POST /api/tab/${tabID}/youtube/${videoID})
    app.post("/api/tab/:id/youtube/:videoID", async (c) => {
        try {
            await checkLogin(c);
            const id = parseInt(c.req.param("id"));
            const videoID = c.req.param("videoID");
            if (isNaN(id)) {
                throw new Error("Invalid tab ID");
            }

            const body = await c.req.json();
            const data = YoutubeSaveRequestSchema.parse(body);

            await getTab(id);
            await updateYoutube(id, videoID, data);

            return c.json({
                ok: true,
            });
        } catch (e) {
            return generalError(c, e);
        }
    });

    // Remove Youtube (DELETE /api/tab/${tabID}/youtube/${videoID})
    app.delete("/api/tab/:id/youtube/:videoID", async (c) => {
        try {
            await checkLogin(c);
            const id = parseInt(c.req.param("id"));
            const videoID = c.req.param("videoID");
            if (isNaN(id)) {
                throw new Error("Invalid tab ID");
            }

            await getTab(id);
            await removeYoutube(id, videoID);

            return c.json({
                ok: true,
            });
        } catch (e) {
            return generalError(c, e);
        }
    });

    // Serve tab file
    app.get("/api/tab/:id/file", async (c) => {
        try {
            const id = parseInt(c.req.param("id") || "");

            // Unfortunately AlphaTab does not support cookie auth, we need a short lived temp token to auth via query param
            const tempToken = c.req.query("tempToken");

            // Check kv for temp token
            if (tempToken) {
                const tokenData = await kv.get(["temp_token", tempToken]);
                if (!tokenData.value) {
                    throw new Error("Invalid or expired temp token");
                }

                if (tokenData.value !== id) {
                    throw new Error("Temp token does not match tab ID");
                }

                // Delete the token after use
                await kv.delete(["temp_token", tempToken]);
            } else {
                await checkLogin(c);
            }

            const tab = await getTab(id);
            const filePath = getTabFilePath(tab);

            // Check if file exists
            if (!await fs.exists(filePath)) {
                throw new Error("Tab file not found");
            }

            // serve the file
            const file = await Deno.open(filePath, {
                read: true,
            });

            const encodedOriginalFilename = encodeURIComponent(tab.originalFilename);

            return c.body(file.readable, 200, {
                "Content-Type": "application/octet-stream",
                "Content-Disposition": `attachment; filename="${encodedOriginalFilename}"`,
            });
        } catch (e) {
            console.error(e);
            return generalError(c, e);
        }
    });

    // Generate temp token for tab file access
    app.get("/api/tab/:id/temp-token", async (c) => {
        try {
            const id = parseInt(c.req.param("id"));
            if (isNaN(id)) {
                throw new Error("Invalid tab ID");
            }

            const tab = await getTab(id);

            if (!tab.public) {
                await checkLogin(c);
            }

            const token = crypto.randomUUID();

            await kv.set(["temp_token", token], tab.id, { expireIn: 10 });
            return c.json({
                ok: true,
                token,
            });
        } catch (e) {
            return generalError(c, e);
        }
    });

    app.get("/", (c) => {
        return c.html(indexHTML);
    });

    // Serve static files
    // @ts-ignore No idea why ts is complaining here
    app.get(
        "*",
        serveStatic({
            root: "./dist",
        }),
    );

    // if /api/* not found, return 404
    app.all("/api/*", (c) => {
        return c.json({
            ok: false,
            msg: "Page Not found",
        }, 404);
    });

    // For SPA, always return index.html
    app.notFound((c) => {
        return c.html(indexHTML, 200);
    });

    // Close Server event
    Deno.addSignalListener("SIGINT", () => {
        httpServer.close();
        kv.close();
        db.close();
        console.log("Server closed");
        Deno.exit();
    });
}

function generalError(c: Context, e: unknown) {
    if (e instanceof ZodError) {
        let message = "";
        for (const issue of e.issues) {
            message += `${issue.path.join(".")}: ${issue.message}\n`;
        }
        return c.json({
            ok: false,
            msg: message,
        }, 400);
    } else if (e instanceof Error) {
        return c.json({
            ok: false,
            msg: e.message,
        }, 400);
    } else {
        return c.json({
            ok: false,
            msg: "Unknown error",
        }, 400);
    }
}

if (import.meta.main) {
    await main();
}
