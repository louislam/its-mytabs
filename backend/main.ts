import { serve, ServerType } from "@hono/node-server";
import { Context, Hono } from "@hono/hono";
import * as fs from "@std/fs";
import { auth, checkLogin, isFinishSetup, isLoggedIn } from "./auth.ts";
import { SignUpSchema, SyncRequestSchema, UpdateTabFavSchema, UpdateTabInfoSchema, YoutubeAddDataSchema } from "./zod.ts";
import { db, hasUser, isInitDB, kv, migrate } from "./db.ts";
import { cors } from "@hono/hono/cors";
import { serveStatic } from "@hono/hono/deno";
import { appVersion, checkFilename, dataDir, devOriginList, getFrontendDir, getSourceDir, host, isDemoMode, isDev, port, start, tabDir } from "./util.ts";
import * as path from "@std/path";
import { supportedAudioFormatList, supportedFormatList } from "./common.ts";
import {
    addAudio,
    addYoutube,
    checkTabExists,
    createTab,
    deleteTab,
    fixMissingTab,
    getAllTabs,
    getConfigJSON,
    getTab,
    getTabFilePath,
    getTabFolderPath,
    getTabFullFilePath,
    removeAudio,
    removeYoutube,
    replaceTab,
    updateAudio,
    updateConfigJSON,
    updateTab,
    updateTabFav,
    updateYoutube,
} from "./tab.ts";
import { ZodError } from "zod";
import sanitize from "sanitize-filename";
import "@std/dotenv/load";
import { socketIO } from "./socket.ts";
import * as cheerio from "cheerio";

let httpServer: ServerType;

export async function main() {
    console.log(`It's MyTabs v${appVersion}`);

    if (isInitDB()) {
        console.log("Database initialized.");
    }

    console.log("Migrating....");
    await migrate();

    const frontendDir = getFrontendDir();

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
    const indexHTMLContent = await Deno.readTextFile(path.join(frontendDir, "index.html"));

    // Inject demo mode flag using cheerio
    const $ = cheerio.load(indexHTMLContent);
    $("head").append(`<script id="app-config" type="application/json">${JSON.stringify({ isDemo: isDemoMode })}</script>`);
    const indexHTML = $.html();

    if (isDemoMode) {
        console.warn("Running in DEMO MODE.");
    }

    const app = new Hono();

    httpServer = serve({
        fetch: app.fetch,
        port,
        hostname: host,
    }, (info) => {
        let address = info.address;
        if (address == "0.0.0.0") {
            address = "localhost";
        }

        // Print DATA_DIR so it's visible on startup
        console.log(`Data Dir:`, dataDir);

        const url = `http://${address}:${info.port}`;
        console.log(`Server running on ${url}`);

        const launchBrowser = Deno.env.get("MYTABS_LAUNCH_BROWSER");

        if (Deno.build.standalone) {
            if (launchBrowser !== "false") {
                start(url);
            }
        }
    });

    // Socket Controller
    const io = socketIO(httpServer);

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
            let artist = form.get("artist") || "";

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

    // Create Empty Tab
    app.post("/api/new-tab/template/:type", async (c) => {
        try {
            await checkLogin(c);

            const templateTypeList: Record<string, string> = {
                bass: "./extra/empty-bass.gp",
                guitar: "./extra/empty-guitar.gp",
            };

            const type = c.req.param("type");
            const srcDir = getSourceDir();
            const rel = templateTypeList[type];
            if (!rel) {
                return c.json({ ok: false, msg: "Template not found" }, 400);
            }

            const templatePath = path.join(srcDir, rel);
            const bytes = await Deno.readFile(templatePath);
            const ext = templatePath.split(".").pop()?.toLowerCase() || "gp";
            const title = "Empty Tab";
            const artist = "";

            const id = await createTab(bytes, ext, title, artist, path.basename(templatePath));

            // Append the id to the title
            await updateConfigJSON(id, async (config) => {
                config.tab.title += " #" + id;
            });

            return c.json({ ok: true, id });
        } catch (e) {
            return generalError(c, e);
        }
    });

    // Get Tab List
    app.get("/api/tabs", async (c) => {
        try {
            await checkLogin(c);

            const tabList = await getAllTabs();

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
            const id = c.req.param("id");

            let config = await getConfigJSON(id);
            if (!config) {
                throw new Error("Config.json not found");
            }

            if (!config.tab.public) {
                await checkLogin(c);
            }

            config = await fixMissingTab(config);

            const filePath = (await isLoggedIn(c)) ? getTabFullFilePath(config.tab) : "";

            return c.json({
                ok: true,
                platform: Deno.build.os,
                tab: config.tab,
                youtubeList: config.youtube,
                audioList: config.audio,
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
            const id = c.req.param("id");

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

    // Update Tab Favorite Status
    app.post("/api/tab/:id/fav", async (c) => {
        try {
            await checkLogin(c);
            const id = c.req.param("id");

            const body = await c.req.json();
            const data = UpdateTabFavSchema.parse(body);

            const tab = await getTab(id);
            await updateTabFav(tab, data);
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
            const id = c.req.param("id");

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
            const id = c.req.param("id");

            await deleteTab(id);

            return c.json({
                ok: true,
            });
        } catch (e) {
            return generalError(c, e);
        }
    });

    // Add Audio
    app.post("/api/tab/:id/audio", async (c) => {
        try {
            await checkLogin(c);
            const id = c.req.param("id");

            const tab = await getTab(id);

            const form = await c.req.formData();
            const file = form.get("file");

            if (!(file instanceof File)) {
                throw new Error("No file uploaded");
            }

            const fileName = file.name;
            const ext = fileName.split(".").pop()?.toLowerCase();
            if (!ext) {
                throw new Error("File has no extension");
            }

            if (!supportedAudioFormatList.includes(ext)) {
                throw new Error("Unsupported file format: " + ext);
            }

            const arrayBuffer = await file.arrayBuffer();
            await addAudio(tab, new Uint8Array(arrayBuffer), fileName);

            return c.json({
                ok: true,
            });
        } catch (e) {
            return generalError(c, e);
        }
    });

    // Save Audio (Metadata only)
    app.post("/api/tab/:id/audio/:filename", async (c) => {
        try {
            await checkLogin(c);
            const id = c.req.param("id");

            const body = await c.req.json();
            const data = SyncRequestSchema.parse(body);

            const tab = await getTab(id);
            const filename = c.req.param("filename");

            await updateAudio(tab, filename, data);

            return c.json({
                ok: true,
            });
        } catch (e) {
            return generalError(c, e);
        }
    });

    // Remove Audio
    app.delete("/api/tab/:id/audio/:filename", async (c) => {
        try {
            await checkLogin(c);
            const id = c.req.param("id");
            const tab = await getTab(id);
            const filename = c.req.param("filename");
            await removeAudio(tab, filename);

            return c.json({
                ok: true,
            });
        } catch (e) {
            return generalError(c, e);
        }
    });

    // Serve audio file
    app.get("/api/tab/:id/audio/:filename", async (c) => {
        try {
            const id = c.req.param("id");
            const tab = await getTab(id);
            if (!tab.public) {
                await checkLogin(c);
            }

            const filename = c.req.param("filename");
            checkFilename(filename);
            const filePath = path.join(tabDir, id, filename);

            // Check if file exists
            if (!await fs.exists(filePath)) {
                throw new Error("Audio file not found");
            }

            // serve the file
            const file = await Deno.open(filePath, {
                read: true,
            });

            const encodedFilename = encodeURIComponent(filename);
            let mime = "application/octet-stream";
            let mimeList: Record<string, string> = {
                "mp3": "audio/mpeg",
                "ogg": "audio/ogg",
            };

            const ext = filename.split(".").pop()?.toLowerCase();
            if (ext && mimeList[ext]) {
                mime = mimeList[ext];
            }

            return c.body(file.readable, 200, {
                "Content-Type": mime,
                "Content-Disposition": `attachment; filename="${encodedFilename}"`,
            });
        } catch (e) {
            return generalError(c, e);
        }
    });

    // Add Youtube (/api/tab/${tabID}/youtube)
    app.post("/api/tab/:id/youtube", async (c) => {
        try {
            await checkLogin(c);
            const id = c.req.param("id");

            const body = await c.req.json();
            const data = YoutubeAddDataSchema.parse(body);

            await checkTabExists(id);
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
            const id = c.req.param("id");
            const videoID = c.req.param("videoID");

            const body = await c.req.json();
            const data = SyncRequestSchema.parse(body);

            await checkTabExists(id);
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
            const id = c.req.param("id");
            const videoID = c.req.param("videoID");

            await checkTabExists(id);
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
            const id = c.req.param("id");

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
            const id = c.req.param("id");

            const tab = await getTab(id);

            if (!tab.public) {
                await checkLogin(c);
            }

            const token = crypto.randomUUID();

            await kv.set(["temp_token", token], tab.id, { expireIn: 20 });
            return c.json({
                ok: true,
                token,
            });
        } catch (e) {
            return generalError(c, e);
        }
    });

    // Open folder and Open external (Windows only)
    app.post("/api/tab/:id/open-folder", async (c) => {
        try {
            await checkLogin(c);
            const id = c.req.param("id");
            const tab = await getTab(id);

            if (!Deno.build.standalone || Deno.build.os !== "windows") {
                throw new Error("Open folder is only supported on Windows");
            }
            const folder = getTabFolderPath(tab);
            const child = new Deno.Command("explorer.exe", { args: [folder], stdout: "null", stderr: "null" }).spawn();
            await child.status;
            return c.json({ ok: true });
        } catch (e) {
            return generalError(c, e);
        }
    });

    app.post("/api/tab/:id/open-external", async (c) => {
        try {
            await checkLogin(c);
            const id = c.req.param("id");
            const tab = await getTab(id);

            if (!Deno.build.standalone || Deno.build.os !== "windows") {
                throw new Error("Open external is only supported on Windows");
            }

            const fullPath = getTabFullFilePath(tab);
            const child = new Deno.Command("cmd", { args: ["/c", "start", "", fullPath], stdout: "null", stderr: "null" }).spawn();
            await child.status;
            return c.json({ ok: true });
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
            root: path.join(frontendDir),
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

    const signalHandler = () => {
        closeServer();
        Deno.exit();
    };

    // Close Server event
    Deno.addSignalListener("SIGINT", signalHandler);

    if (Deno.build.os === "linux") {
        Deno.addSignalListener("SIGTERM", signalHandler);
    }

    // Unhandled Rejection
    globalThis.addEventListener("unhandledrejection", (e) => {
        console.log("unhandled rejection at:", e.promise, "reason:", e.reason);
        e.preventDefault();
    });
}

export function closeServer() {
    if (httpServer) {
        httpServer.close();
    }
    kv.close();
    db.close();
    console.log("Server closed");
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
