import { tabDir } from "./util.ts";
import * as fs from "@std/fs";
import * as path from "@std/path";
import { TabInfo, TabInfoSchema } from "./zod.ts";
import { kv } from "./db.ts";

export async function createTab(tabFileData: Uint8Array, ext: string, title: string, artist: string, originalFilename: string) {
    const id = await getNextTabID();
    const dir = path.join(tabDir, id.toString());

    // Don't use fs.ensureDir, to avoid rarely case that two tabs get the same ID
    await Deno.mkdir(dir);

    const filename = "tab." + ext;
    await Deno.writeFile(path.join(dir, filename), tabFileData);

    // Create info.json
    const info: TabInfo = {
        id,
        title,
        artist,
        filename,
        originalFilename,
        createdAt: new Date().toISOString(),
        public: false,
    };

    await kv.set(["tab", id], info);

    return id;
}

/**
 * Read the tabDir and find the max ID
 */
export async function getNextTabID() {
    const files = Deno.readDir(tabDir);
    let maxID = 0;
    for await (const file of files) {
        if (file.isDirectory) {
            const id = parseInt(file.name);
            if (!isNaN(id) && id > maxID) {
                maxID = id;
            }
        }
    }
    return maxID + 1;
}

export async function getTab(id: number) {
    if (isNaN(id)) {
        throw new Error("Invalid tab ID");
    }

    const tab = await kv.get(["tab", id]);
    if (!tab.value) {
        throw new Error("Tab not found");
    }

    return TabInfoSchema.parse(tab.value);
}

export async function getTabFilePath(tab: TabInfo) {
    return path.join(tabDir, tab.id.toString(), tab.filename);
}

export async function deleteTab(id: number) {
    // Check if tab exists
    const tab = await kv.get(["tab", id]);
    if (!tab.value) {
        throw new Error("Tab not found");
    }

    // Rename the directory to ./data/tabs/deleted/
    const oldPath = path.join(tabDir, id.toString());
    const newPath = path.join(tabDir, "deleted", id.toString());
    await fs.ensureDir(path.join(tabDir, "deleted"));
    await Deno.rename(oldPath, newPath);

    // Delete from KV
    await kv.delete(["tab", id]);
}
