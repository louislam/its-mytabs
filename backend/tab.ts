import { tabDir } from "./util.ts";
import * as fs from "@std/fs";
import * as path from "@std/path";
import { AudioData, AudioDataSchema, TabInfo, TabInfoSchema, UpdateTabInfo, Youtube, YoutubeSaveRequest, YoutubeSchema } from "./zod.ts";
import { kv } from "./db.ts";
import sanitize from "sanitize-filename";
import { FLACDecoder } from "@wasm-audio-decoders/flac";
import { createOggEncoder } from "wasm-media-encoders";

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

// OGG Vorbis quality setting: 8 ≈ 256kbps for stereo
const DEFAULT_OGG_QUALITY = 8;

export async function addAudio(tab: TabInfo, audioFileData: Uint8Array, originalFilename: string) {
    // To avoid issues with special characters in filenames in different OS
    let filename = sanitize(originalFilename);

    // Check file extension
    const ext = filename.split(".").pop()?.toLowerCase();
    if (!ext) {
        throw new Error("File has no extension");
    }

    // Ensure tab directory exists
    const tabDirPath = path.join(tabDir, tab.id.toString());
    await fs.ensureDir(tabDirPath);

    // If it's a FLAC file, convert to OGG using WASM
    if (ext === "flac") {
        // Change filename extension to .ogg
        const lastDotIndex = filename.lastIndexOf(".");
        filename = filename.substring(0, lastDotIndex) + ".ogg";

        // Check if kv entry already exists
        const existing = await kv.get(["audio", tab.id, filename]);
        if (existing.value) {
            throw new Error("Audio file with the same name already exists");
        }

        const decoder = new FLACDecoder();
        try {
            await decoder.ready;

            // Decode the entire FLAC file
            const decoded = await decoder.decodeFile(audioFileData);

            if (!decoded || !decoded.channelData || decoded.channelData.length === 0) {
                throw new Error("Failed to decode FLAC: no audio data");
            }

            const { channelData, sampleRate } = decoded;
            const channels: 1 | 2 = channelData.length === 2 ? 2 : 1;

            // Create OGG encoder (Note: encoder doesn't require explicit cleanup, managed by GC)
            const encoder = await createOggEncoder();
            encoder.configure({
                sampleRate: sampleRate,
                channels: channels,
                vbrQuality: DEFAULT_OGG_QUALITY,
            });

            // Collect all encoded OGG data
            const oggChunks: Uint8Array[] = [];

            // Encode the PCM data
            const encoded = encoder.encode(channelData);
            if (encoded.length > 0) {
                // Copy the data as it's owned by the encoder
                oggChunks.push(new Uint8Array(encoded));
            }

            // Finalize encoding
            const finalChunk = encoder.finalize();
            if (finalChunk.length > 0) {
                oggChunks.push(new Uint8Array(finalChunk));
            }

            // Combine all chunks into single buffer
            const totalLength = oggChunks.reduce((sum, chunk) => sum + chunk.length, 0);
            const oggData = new Uint8Array(totalLength);
            let offset = 0;
            for (const chunk of oggChunks) {
                oggData.set(chunk, offset);
                offset += chunk.length;
            }

            // Write OGG file
            const oggPath = path.join(tabDirPath, filename);
            await Deno.writeFile(oggPath, oggData);
        } catch (error) {
            console.error("FLAC to OGG conversion failed:", error);
            throw new Error(`Failed to convert FLAC to OGG: ${error instanceof Error ? error.message : String(error)}`);
        } finally {
            // Always free decoder resources
            decoder.free();
        }
    } else {
        // Check if kv entry already exists
        const existing = await kv.get(["audio", tab.id, filename]);
        if (existing.value) {
            throw new Error("Audio file with the same name already exists");
        }

        const filePath = path.join(tabDirPath, filename);
        await Deno.writeFile(filePath, audioFileData);
    }

    await kv.set(
        ["audio", tab.id, filename],
        AudioDataSchema.parse({
            filename,
        }),
    );
}

export async function getAudio(tab: TabInfo, filename: string) {
    // Check if kv entry exists
    const res = await kv.get(["audio", tab.id, filename]);
    if (!res.value) {
        throw new Error("Audio file not found");
    }
    return AudioDataSchema.parse(res.value);
}

export async function removeAudio(tab: TabInfo, filename: string) {
    // Check if kv entry exists
    await getAudio(tab, filename);

    // Delete file
    const filePath = path.join(tabDir, tab.id.toString(), filename);
    await Deno.remove(filePath);

    // Delete from KV
    await kv.delete(["audio", tab.id, filename]);
}

export async function updateAudio(tab: TabInfo, filename: string, data: YoutubeSaveRequest) {
    await getAudio(tab, filename); // Check if exists
    await kv.set(
        ["audio", tab.id, filename],
        AudioDataSchema.parse({
            filename,
            ...data,
        }),
    );
}

export async function getAudioList(tabID: number): Promise<AudioData[]> {
    const list: AudioData[] = [];
    const iter = kv.list({ prefix: ["audio", tabID] });

    for await (const entry of iter) {
        try {
            list.push(AudioDataSchema.parse(entry.value));
        } catch (e) {
            console.error("Invalid AudioData entry in KV:", entry.key, entry.value);
        }
    }

    return list;
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
    const iter = kv.list({ prefix: ["youtube", tabID] });

    for await (const entry of iter) {
        try {
            list.push(YoutubeSchema.parse(entry.value));
        } catch (e) {
            console.error("Invalid youtube entry in KV:", entry.key, entry.value);
        }
    }

    return list;
}
