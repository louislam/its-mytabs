import * as fs from "@std/fs";
import { DatabaseSync } from "node:sqlite";
import * as path from "@std/path";
import {addDemoTab, dataDir, getSourceDir} from "./util.ts";
import {getNextTabID} from "./tab.ts";

let dbPath = path.join(dataDir, "config.db");

let isInitDatabase = false;

if (!await fs.exists(dbPath)) {
    console.log("Init Database");
    isInitDatabase = true;
    await Deno.copyFile(path.join(getSourceDir(), "./extra/config-template.db"), dbPath);
}

export const db = new DatabaseSync(dbPath);
export const kv = await Deno.openKv(dbPath);

if (isInitDatabase) {
    await addDemoTab();
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

