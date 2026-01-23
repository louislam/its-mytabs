import { checkAudioFormat, checkFilename, flacToOgg, tabDir } from "./util.ts";
import * as fs from "@std/fs";
import * as path from "@std/path";
import { AudioData, AudioDataSchema, ConfigJSON, ConfigJSONSchema, SyncRequest, TabInfo, TabInfoSchema, UpdateTabFav, UpdateTabInfo, Youtube, YoutubeSchema } from "./zod.ts";
import { kv } from "./db.ts";
import sanitize from "sanitize-filename";
import { supportedAudioFormatList, supportedFormatList } from "./common.ts";

const updateQueues = new Map<string, Promise<void>>();

/**
 * Get the config.json path for a tab
 */
export function getConfigJSONPath(id: string): string {
    checkFilename(id);
    return path.join(tabDir, id, "config.json");
}

/**
 * Check if a tab exists (by checking if config.json exists)
 */
export async function tabExists(id: string): Promise<boolean> {
    const configPath = getConfigJSONPath(id);
    return await fs.exists(configPath);
}

/**
 * Check if a tab exists, throw error if not
 */
export async function checkTabExists(id: string): Promise<void> {
    if (!await tabExists(id)) {
        throw new Error("Tab not found");
    }
}

/**
 * Find a valid tab file in the directory
 * Returns the filename if found, null otherwise
 */
async function findTabFile(dirPath: string): Promise<string | null> {
    for await (const entry of Deno.readDir(dirPath)) {
        if (!entry.isFile) continue;
        const ext = path.extname(entry.name).slice(1).toLowerCase();
        if (supportedFormatList.includes(ext)) {
            return entry.name;
        }
    }
    return null;
}

/**
 * Find all audio files in the directory
 */
async function findAudioFiles(dirPath: string): Promise<string[]> {
    const audioFiles: string[] = [];
    for await (const entry of Deno.readDir(dirPath)) {
        if (!entry.isFile) continue;
        const ext = path.extname(entry.name).slice(1).toLowerCase();
        if (supportedAudioFormatList.includes(ext)) {
            audioFiles.push(entry.name);
        }
    }
    return audioFiles;
}

/**
 * Read the full config.json file
 * Audio list is populated from actual files in the directory, merged with stored metadata
 */
export async function getConfigJSON(id: string, excludeAudio = false): Promise<ConfigJSON | null> {
    const configPath = getConfigJSONPath(id);

    if (await fs.exists(configPath)) {
        try {
            const content = await Deno.readTextFile(configPath);
            const data = JSON.parse(content);
            const config = ConfigJSONSchema.parse(data);

            // Scan directory for audio files and merge with stored metadata
            if (!excludeAudio) {
                const dirPath = path.join(tabDir, id);
                const audioFiles = await findAudioFiles(dirPath);
                config.audio = audioFiles.map((filename) => {
                    const meta = config.audio.find((a: AudioData) => a.filename === filename);
                    if (meta) {
                        return meta;
                    }
                    return AudioDataSchema.parse({ filename });
                });
            }

            return config;
        } catch (e) {
            console.error(`Failed to read config.json for tab ${id}:`, e);
            return null;
        }
    }
    return null;
}

/**
 * Write the full config.json file
 * Directly overwrites existing file, you should use updateConfigJSON for safe updates
 */
async function writeConfigJSON(id: string, config: ConfigJSON): Promise<void> {
    const configPath = getConfigJSONPath(id);
    await Deno.writeTextFile(configPath, JSON.stringify(config, null, 2));
}

export async function getAllTabs(): Promise<TabInfo[]> {
    const tabs: TabInfo[] = [];

    // Scan the tabs folder
    for await (const entry of Deno.readDir(tabDir)) {
        // Only process directories, ignore "deleted" folder
        if (!entry.isDirectory || entry.name === "deleted") {
            continue;
        }

        const id = entry.name;
        const tab = await getOrCreateTab(id);

        if (tab) {
            tabs.push(tab);
        }
    }

    // Sort by createdAt (newest first)
    tabs.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    return tabs;
}

export async function createTab(tabFileData: Uint8Array, ext: string, title: string, artist: string, originalFilename: string) {
    const id = await getNextTabID();
    const dir = path.join(tabDir, id.toString());

    // Don't use fs.ensureDir, to avoid rarely case that two tabs get the same ID
    await Deno.mkdir(dir);

    const filename = "tab." + ext;
    await Deno.writeFile(path.join(dir, filename), tabFileData);

    // Create config.json
    const tab: TabInfo = TabInfoSchema.parse({
        id: id.toString(),
        title,
        artist,
        filename,
        originalFilename,
        createdAt: new Date().toISOString(),
        public: false,
        fav: false,
    });

    const info: ConfigJSON = {
        tab,
        audio: [],
        youtube: [],
    };

    await writeConfigJSON(id.toString(), info);

    return id.toString();
}

export async function writeTabInfo(tab: TabInfo) {
    await updateConfigJSON(tab.id, async (config) => {
        config.tab = tab;
    });
}

export async function getTab(id: string): Promise<TabInfo> {
    const configPath = getConfigJSONPath(id);

    // If config.json exists, read it
    if (await fs.exists(configPath)) {
        const config = await getConfigJSON(id, true);
        if (config) {
            return config.tab;
        } else {
            throw new Error("Failed to parse config.json");
        }
    }

    throw new Error("Tab not found");
}

/**
 * Should only be used by getAllTabs() to auto-create missing config.json
 * @param id
 */
export async function getOrCreateTab(id: string): Promise<TabInfo | null> {
    const dirPath = path.join(tabDir, id);

    try {
        return await getTab(id);
    } catch {
        // Continue to create
    }

    // No config.json, try to find a valid tab file and create config.json
    const tabFile = await findTabFile(dirPath);
    if (!tabFile) {
        // No valid tab file, skip this folder
        return null;
    }

    // Create a new config.json
    const tab: TabInfo = TabInfoSchema.parse({
        id,
        title: id,
        artist: "",
        filename: tabFile,
        originalFilename: tabFile,
        createdAt: new Date().toISOString(),
        public: false,
        fav: false,
    });

    const newConfig: ConfigJSON = {
        tab,
        audio: [],
        youtube: [],
    };

    await writeConfigJSON(id, newConfig);
    return tab;
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
    await writeTabInfo(tab);
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
    while (true) {
        const key = ["counter", "tab_id"];
        const res = await kv.get<Deno.KvU64>(key);
        const current = res.value || new Deno.KvU64(0n);
        const next = new Deno.KvU64(current.value + 1n);
        const commit = await kv.atomic()
            .check({ key, versionstamp: res.versionstamp })
            .mutate({ type: "set", key, value: next })
            .commit();
        if (commit.ok) {
            return Number(next.value);
        }
    }
}

export async function updateTab(tab: TabInfo, data: UpdateTabInfo) {
    tab.title = data.title;
    tab.artist = data.artist;
    tab.public = data.public;
    await writeTabInfo(tab);
}

export async function updateTabFav(tab: TabInfo, data: UpdateTabFav) {
    tab.fav = data.fav;
    await writeTabInfo(tab);
}

export function getTabFilePath(tab: TabInfo) {
    return path.join(tabDir, tab.id.toString(), tab.filename);
}

export function getTabFullFilePath(tab: TabInfo) {
    return path.join(Deno.cwd(), getTabFilePath(tab));
}

export async function deleteTab(id: string) {
    // Check if tab exists
    await checkTabExists(id);

    // Rename the directory to ./data/tabs/deleted/
    const oldPath = path.join(tabDir, id);
    const newPath = path.join(tabDir, "deleted", id + "-" + Date.now().toString());
    await fs.ensureDir(path.join(tabDir, "deleted"));
    await Deno.rename(oldPath, newPath);
}

export async function addAudio(tab: TabInfo, audioFileData: Uint8Array, originalFilename: string) {
    checkAudioFormat(originalFilename);
    checkFilename(originalFilename);

    // To avoid issues with special characters in filenames in different OS
    let filename = sanitize(originalFilename);
    const tabDirPath = path.join(tabDir, tab.id.toString());

    // If flac, will be converted to ogg, so change extension
    if (filename.toLowerCase().endsWith(".flac")) {
        const lastDotIndex = filename.lastIndexOf(".");
        filename = filename.substring(0, lastDotIndex) + ".ogg";

        // Convert flac to ogg
        audioFileData = await flacToOgg(audioFileData);
    }

    // Check if file already exists
    const filePath = path.join(tabDirPath, filename);
    if (await fs.exists(filePath)) {
        throw new Error("Audio file with the same name already exists");
    }

    await Deno.writeFile(filePath, audioFileData);
}

export async function removeAudio(tab: TabInfo, filename: string) {
    checkAudioFormat(filename);
    checkFilename(filename);

    // Check if file exists
    const filePath = path.join(tabDir, tab.id.toString(), filename);
    if (!await fs.exists(filePath)) {
        throw new Error("Audio file not found");
    }

    // Delete file
    await Deno.remove(filePath);

    // Remove metadata from config.json if exists
    await updateConfigJSON(tab.id, async (config) => {
        config.audio = config.audio.filter((a: AudioData) => a.filename !== filename);
    });
}

export async function updateConfigJSON(id: string, callback: (config: ConfigJSON) => Promise<void>) {
    const queue = updateQueues.get(id) || Promise.resolve();
    const newQueue = queue.then(async () => {
        const config = await getConfigJSON(id, true);
        if (!config) {
            throw new Error("Tab not found");
        }
        await callback(config);
        await writeConfigJSON(id, config);
    });
    updateQueues.set(id, newQueue);
    return newQueue;
}

export async function updateAudio(tab: TabInfo, filename: string, data: SyncRequest) {
    checkAudioFormat(filename);
    checkFilename(filename);

    // Check if file exists
    const filePath = path.join(tabDir, tab.id.toString(), filename);
    if (!await fs.exists(filePath)) {
        throw new Error("Audio file not found");
    }

    await updateConfigJSON(tab.id, async (config) => {
        // Find existing audio entry or create new one
        const existingIndex = config.audio.findIndex((a: AudioData) => a.filename === filename);
        const audioData = AudioDataSchema.parse({ filename, ...data });

        if (existingIndex >= 0) {
            config.audio[existingIndex] = audioData;
        } else {
            config.audio.push(audioData);
        }
    });
}

export async function addYoutube(id: string, videoID: string) {
    await updateConfigJSON(id, async (config) => {
        // Check if already exists
        if (config.youtube.some((y: Youtube) => y.videoID === videoID)) {
            throw new Error("YouTube video already exists");
        }

        config.youtube.push(YoutubeSchema.parse({ videoID }));
    });
}

export async function updateYoutube(id: string, videoID: string, data: SyncRequest) {
    await updateConfigJSON(id, async (config) => {
        const existingIndex = config.youtube.findIndex((y: Youtube) => y.videoID === videoID);
        const youtubeData = YoutubeSchema.parse({ videoID, ...data });

        if (existingIndex >= 0) {
            config.youtube[existingIndex] = youtubeData;
        } else {
            config.youtube.push(youtubeData);
        }
    });
}

export async function removeYoutube(id: string, videoID: string) {
    await updateConfigJSON(id, async (config) => {
        config.youtube = config.youtube.filter((y: Youtube) => y.videoID !== videoID);
    });
}
