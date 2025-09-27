import * as fs from "@std/fs";
import * as path from "@std/path";

export async function getDataDir() {
    let dataDir = Deno.env.get("DATA_DIR") || "./data";
    await fs.ensureDir(dataDir);
    return dataDir;
}

export const dataDir = await getDataDir();

export async function getTabDir() {
    let dir = path.join(dataDir, "tabs");
    await fs.ensureDir(dir);
    return dir;
}

export const tabDir = await getTabDir();

export function isDev() {
    return process.env.NODE_ENV === "development";
}

export const devOriginList = [
    "http://127.0.0.1:5173",
    "http://127.0.0.1:5174",
    "http://127.0.0.1:5175",
    "http://localhost:5173",
    "http://localhost:5174",
    "http://localhost:5175",
];
