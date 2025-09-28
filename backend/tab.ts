import { tabDir } from "./util.ts";
import * as fs from "@std/fs";
import * as path from "@std/path";
import { TabInfo, TabInfoSchema, UpdateTabInfo, Youtube, YoutubeAddDataSchema, YoutubeData, YoutubeSaveRequest, YoutubeSchema } from "./zod.ts";
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

// Replace Tab
export async function replaceTab(tab: TabInfo, tabFileData: Uint8Array, ext: string, originalFilename: string) {
    // Rename old file to filename.ext.timestamp
    const oldFilePath = getTabFilePath(tab);
    const renamedOldFilePath = oldFilePath + "." + Date.now().toString();
    await Deno.rename(oldFilePath, renamedOldFilePath);

    // Write new file
    const filename = "tab." + ext;
    const newFilePath = path.join(tabDir, tab.id.toString(), filename);
    await Deno.writeFile(newFilePath, tabFileData);

    // Update tab info
    tab.filename = filename;
    tab.originalFilename = originalFilename;
    await kv.set(["tab", tab.id], tab);
}

/**
 * Read the tabDir and find the max ID
 */
export async function getNextTabID(): Promise<number> {
    while (true) {
        const nextID = await getNextID();
        const dir = path.join(tabDir, nextID.toString());

        // check if dir exists
        if (!await fs.exists(dir)) {
            return nextID;
        } else {
            console.log(`Tab directory ${dir} already exists, trying next ID`);
        }
    }
}

/**
 * Get the next ID from Deno KV, regardless of existing directories.
 */
async function getNextID(): Promise<number> {
    const kv = await Deno.openKv();
    const counterKey = ["counter", "tab_id"];
    const op = kv.atomic();
    const current = await kv.get<Deno.KvU64>(counterKey);
    op.check(current);
    op.set(counterKey, new Deno.KvU64(current.value ? current.value.value + 1n : 1n));
    const res = await op.commit();
    if (res.ok) {
        return current.value ? Number(current.value.value) + 1 : 1;
    }
    throw new Error("Failed to increment tab ID");
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

export async function updateTab(tab: TabInfo, data: UpdateTabInfo) {
    tab.title = data.title;
    tab.artist = data.artist;
    tab.public = data.public;
    await kv.set(["tab", tab.id], tab);
}

export function getTabFilePath(tab: TabInfo) {
    return path.join(tabDir, tab.id.toString(), tab.filename);
}

export function getTabFullFilePath(tab: TabInfo) {
    return path.join(Deno.cwd(), getTabFilePath(tab));
}

export async function deleteTab(id: number) {
    // Check if tab exists
    const tab = await kv.get(["tab", id]);
    if (!tab.value) {
        throw new Error("Tab not found");
    }

    // Rename the directory to ./data/tabs/deleted/
    const oldPath = path.join(tabDir, id.toString());
    const newPath = path.join(tabDir, "deleted", id.toString() + "-" + Date.now().toString());
    await fs.ensureDir(path.join(tabDir, "deleted"));
    await Deno.rename(oldPath, newPath);

    // Delete from KV
    await kv.delete(["tab", id]);

    // Delete all youtube entries
    const youtubeIter = kv.list({ prefix: ["youtube", id] });
    for await (const entry of youtubeIter) {
        await kv.delete(entry.key);
    }

    // Delete all preference entries
    const prefIter = kv.list({ prefix: ["tab_preference", id] });
    for await (const entry of prefIter) {
        await kv.delete(entry.key);
    }
}

export async function addYoutube(tabID: number, videoID: string) {
    await kv.set(
        ["youtube", tabID, videoID],
        YoutubeSchema.parse({
            videoID,
        }),
    );
}

export async function updateYoutube(tabID: number, videoID: string, data: YoutubeSaveRequest) {
    await kv.set(
        ["youtube", tabID, videoID],
        YoutubeSchema.parse({
            videoID,
            ...data,
        }),
    );
}

export async function removeYoutube(tabID: number, videoID: string) {
    await kv.delete(["youtube", tabID, videoID]);
}

export async function getYoutubeList(tabID: number): Promise<Youtube[]> {
    const list: Youtube[] = [];
    const iter = kv.list<boolean>({ prefix: ["youtube", tabID] });

    for await (const entry of iter) {
        try {
            list.push(YoutubeSchema.parse(entry.value));
        } catch (e) {
            console.error("Invalid youtube entry in KV:", entry.key, entry.value);
        }
    }

    return list;
}
