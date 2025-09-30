import * as fs from "@std/fs";
import * as path from "@std/path";
import { fileURLToPath } from "node:url";
import childProcess from "node:child_process";
import * as jsonc from "@std/jsonc";

const denoJSONCPath = path.join(getSourceDir(), "./deno.jsonc");
export const denoJSONC = jsonc.parse(await Deno.readTextFile(denoJSONCPath));

let version = "unknown";
if (denoJSONC && typeof denoJSONC === "object" && !Array.isArray(denoJSONC) && typeof denoJSONC.version === "string") {
    version = denoJSONC.version;
}

// Parse deno.jsonc
export const appVersion: string = version;

export const host = Deno.env.get("MYTABS_HOST");
export const port = Deno.env.get("MYTABS_PORT") ? parseInt(Deno.env.get("MYTABS_PORT")!) : 47777;

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

export function getFrontendDir(): string {
    return path.join(getSourceDir(), "./dist");
}

/**
 * After compiled, some files are inside the executable, so the path is different
 */
export function getSourceDir(): string {
    if (Deno.build.standalone) {
        // `..` go up one leve is the root. In case this file moved to another folder in the future, be careful
        return path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
    } else {
        return "./";
    }
}

/**
 * For cmd.exe's start command, escape the string
 * @param str
 */
export function escapeString(str: string) {
    return `"${str.replace(/"/g, '""')}"`;
}

export function start(path: string) {
    if (Deno.build.os === "windows") {
        const escapedPath = escapeString(path);
        childProcess.exec(`start "" ${escapedPath}`);
    }
}


