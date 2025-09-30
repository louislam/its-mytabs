import * as fs from "@std/fs";
import { DatabaseSync } from "node:sqlite";
import * as path from "@std/path";
import {dataDir, getSourceDir, tabDir} from "./util.ts";
import {getNextTabID} from "./tab.ts";

let dbPath = path.join(dataDir, "config.db");

let isInitDatabase = false;

if (!await fs.exists(dbPath)) {
    isInitDatabase = true;
    await Deno.copyFile(path.join(getSourceDir(), "./extra/config-template.db"), dbPath);
}

export const db = new DatabaseSync(dbPath);
export const kv = await Deno.openKv(dbPath);

if (isInitDatabase) {
    await addDemoTab();
}

export function isInitDB() {
    return isInitDatabase;
}

export function hasUser() {
    const row = db.prepare("SELECT COUNT(*) as count FROM user").get();
    if (!row) {
        throw new Error("User table not found");
    }
    if (typeof row.count !== "number") {
        throw new Error("Invalid count value");
    }
    return row.count > 0;
}

export async function addDemoTab() {
    try {
        const demoTabPath = path.join(getSourceDir(), "./extra/demo-tab.gp");
        const id = await getNextTabID();
        const dir = path.join(tabDir, id.toString());
        await Deno.mkdir(dir);

        // Copy demo tab file
        await Deno.copyFile(demoTabPath, path.join(dir, "tab.gp"));

        // Add Tab
        await kv.set(["tab", id], {
            id,
            title: "Hare no Hi ni (Bass Only)",
            artist: "Reira Ushio",
            filename: "tab.gp",
            originalFilename: "汐れいら-ハレの日に (Bass Only)-09-18-2025.gp",
            createdAt: "2025-09-26T07:29:56.450Z",
            public: false
        });

        // Add Youtube Source
        const videoID = "VuKSlOT__9s";
        await kv.set(["youtube", id, videoID],    {
            videoID,
            syncMethod: "simple",
            simpleSync: 2900,
            advancedSync: ""
        });

    } catch (e) {
        console.log("Skip: Failed to add demo tab:", e);
    }
}
