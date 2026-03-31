import { kv } from "./db.ts";
import { CreatePlaylist, CreatePlaylistSchema, Playlist, PlaylistSchema, UpdatePlaylist } from "./zod.ts";

/**
 * Get the next playlist ID using atomic counter in Deno KV.
 */
async function getNextPlaylistID(): Promise<string> {
    while (true) {
        const key = ["counter", "playlist_id"];
        const res = await kv.get<Deno.KvU64>(key);
        const current = res.value || new Deno.KvU64(0n);
        const next = new Deno.KvU64(current.value + 1n);
        const commit = await kv.atomic()
            .check({ key, versionstamp: res.versionstamp })
            .mutate({ type: "set", key, value: next })
            .commit();
        if (commit.ok) {
            return String(next.value);
        }
    }
}

/**
 * Create a new playlist.
 */
export async function createPlaylist(data: CreatePlaylist): Promise<Playlist> {
    const id = await getNextPlaylistID();
    const playlist = PlaylistSchema.parse({
        id,
        name: data.name,
        tabIds: [],
        createdAt: new Date().toISOString(),
    });
    await kv.set(["playlist", id], playlist);
    return playlist;
}

/**
 * Get a single playlist by ID.
 */
export async function getPlaylist(id: string): Promise<Playlist> {
    const entry = await kv.get(["playlist", id]);
    if (!entry.value) {
        throw new Error("Playlist not found");
    }
    return PlaylistSchema.parse(entry.value);
}

/**
 * Get all playlists.
 */
export async function getAllPlaylists(): Promise<Playlist[]> {
    const playlists: Playlist[] = [];
    const iter = kv.list({ prefix: ["playlist"] });
    for await (const entry of iter) {
        try {
            playlists.push(PlaylistSchema.parse(entry.value));
        } catch {
            // Skip invalid entries
        }
    }
    // Sort by createdAt (newest first)
    playlists.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    return playlists;
}

/**
 * Update a playlist (name and/or tab order).
 */
export async function updatePlaylist(id: string, data: UpdatePlaylist): Promise<Playlist> {
    const playlist = await getPlaylist(id);
    if (data.name !== undefined) {
        playlist.name = data.name;
    }
    if (data.tabIds !== undefined) {
        playlist.tabIds = data.tabIds;
    }
    await kv.set(["playlist", id], playlist);
    return playlist;
}

/**
 * Delete a playlist.
 */
export async function deletePlaylist(id: string): Promise<void> {
    const entry = await kv.get(["playlist", id]);
    if (!entry.value) {
        throw new Error("Playlist not found");
    }
    await kv.delete(["playlist", id]);
}

/**
 * Add a tab to a playlist. Does nothing if already present.
 */
export async function addTabToPlaylist(playlistId: string, tabId: string): Promise<void> {
    const playlist = await getPlaylist(playlistId);
    if (!playlist.tabIds.includes(tabId)) {
        playlist.tabIds.push(tabId);
        await kv.set(["playlist", playlistId], playlist);
    }
}

/**
 * Remove a tab from a playlist.
 */
export async function removeTabFromPlaylist(playlistId: string, tabId: string): Promise<void> {
    const playlist = await getPlaylist(playlistId);
    playlist.tabIds = playlist.tabIds.filter((id) => id !== tabId);
    await kv.set(["playlist", playlistId], playlist);
}
