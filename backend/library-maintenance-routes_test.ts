import { assertEquals, assertExists } from "jsr:@std/assert@^1.0.17";
import * as fs from "@std/fs";
import { Hono } from "@hono/hono";

const tempDir = await Deno.makeTempDir();
Deno.env.set("DATA_DIR", tempDir);
Deno.env.set("MYTABS_PORT", "47781");
Deno.env.set("MYTABS_DEMO_MODE", "false");

const { db, kv } = await import("./db.ts");
const { registerLibraryMaintenanceRoutes } = await import("./library-maintenance-routes.ts");
const { upsertAlbum, upsertArtist, upsertLibraryTab, upsertSong } = await import("./library.ts");

Deno.test("library maintenance routes are disabled unless explicitly enabled", async () => {
    const app = new Hono();
    registerLibraryMaintenanceRoutes(app);

    const response = await app.request("/api/library-maintenance/artist-aliases", {
        method: "POST",
        body: JSON.stringify({ artistId: 1, alias: "Alias" }),
        headers: { "Content-Type": "application/json" },
    });
    assertEquals(response.status, 404);
});

Deno.test("enabled library maintenance routes require login by default", async () => {
    const app = new Hono();
    registerLibraryMaintenanceRoutes(app, { enabled: true });

    const response = await app.request("/api/library-maintenance/artist-aliases", {
        method: "POST",
        body: JSON.stringify({ artistId: 1, alias: "Alias" }),
        headers: { "Content-Type": "application/json" },
    });
    const body = await response.json();
    assertEquals(response.status, 401);
    assertEquals(body.ok, false);
    assertEquals(body.msg, "Not logged in");
});

Deno.test("library maintenance routes create aliases and merge artists", async () => {
    const app = authenticatedApp();
    const targetArtist = upsertArtist("Route Merge Target");
    const sourceArtist = upsertArtist("Route Merge Source");
    const sourceSong = upsertSong(sourceArtist.id, "Route Merge Song");
    const movedTab = upsertLibraryTab({ id: "route-merge-source-tab", songId: sourceSong.id });

    const aliasResponse = await app.request("/api/library-maintenance/artist-aliases", {
        method: "POST",
        body: JSON.stringify({ artistId: sourceArtist.id, alias: "Route Source Alias" }),
        headers: { "Content-Type": "application/json" },
    });
    const aliasBody = await aliasResponse.json();
    assertEquals(aliasResponse.status, 200);
    assertEquals(aliasBody.ok, true);
    assertEquals(aliasBody.alias.alias, "Route Source Alias");

    const mergeResponse = await app.request("/api/library-maintenance/artists/merge", {
        method: "POST",
        body: JSON.stringify({ sourceArtistId: sourceArtist.id, targetArtistId: targetArtist.id }),
        headers: { "Content-Type": "application/json" },
    });
    const mergeBody = await mergeResponse.json();
    assertEquals(mergeResponse.status, 200);
    assertEquals(mergeBody.ok, true);
    assertEquals(mergeBody.result.targetArtistId, targetArtist.id);
    assertEquals(mergeBody.result.movedSongs, 1);

    const moved = db.prepare("SELECT tabs.artist, songs.artist_id FROM tabs INNER JOIN songs ON songs.id = tabs.song_id WHERE tabs.id = ?").get(movedTab.id) as Record<string, unknown>;
    assertEquals(moved.artist, "Route Merge Target");
    assertEquals(moved.artist_id, targetArtist.id);
});

Deno.test("library maintenance routes move versions, split songs, and update albums", async () => {
    const app = authenticatedApp();
    const artist = upsertArtist("Route Maintenance Artist");
    const album = upsertAlbum(artist.id, "Route Maintenance Album");
    const firstSong = upsertSong(artist.id, "Route First Song", album.id);
    const secondSong = upsertSong(artist.id, "Route Second Song", album.id);
    const firstTab = upsertLibraryTab({ id: "route-maintenance-first", songId: firstSong.id, public: true });
    const movedTab = upsertLibraryTab({ id: "route-maintenance-move", songId: firstSong.id });

    const moveResponse = await app.request(`/api/library-maintenance/tabs/${movedTab.id}/move-version`, {
        method: "POST",
        body: JSON.stringify({ targetSongId: secondSong.id, versionLabel: "Route Moved" }),
        headers: { "Content-Type": "application/json" },
    });
    const moveBody = await moveResponse.json();
    assertEquals(moveResponse.status, 200);
    assertEquals(moveBody.tab.songId, secondSong.id);
    assertEquals(moveBody.tab.versionLabel, "Route Moved");

    const splitResponse = await app.request(`/api/library-maintenance/tabs/${movedTab.id}/split-song`, {
        method: "POST",
        body: JSON.stringify({ artistId: artist.id, title: "Route Split Song", albumId: album.id, versionLabel: "Route Split" }),
        headers: { "Content-Type": "application/json" },
    });
    const splitBody = await splitResponse.json();
    assertEquals(splitResponse.status, 200);
    assertEquals(splitBody.tab.title, "Route Split Song");
    assertEquals(splitBody.tab.album, "Route Maintenance Album");

    const albumResponse = await app.request(`/api/library-maintenance/songs/${firstSong.id}/album-title`, {
        method: "POST",
        body: JSON.stringify({ albumTitle: "Route Cleanup Album" }),
        headers: { "Content-Type": "application/json" },
    });
    const albumBody = await albumResponse.json();
    assertEquals(albumResponse.status, 200);
    assertEquals(albumBody.song.albumId !== null, true);

    const firstTabRow = db.prepare("SELECT album, public FROM tabs WHERE id = ?").get(firstTab.id) as Record<string, unknown>;
    assertEquals(firstTabRow.album, "Route Cleanup Album");
    assertEquals(firstTabRow.public, 1);

    const removeResponse = await app.request(`/api/library-maintenance/songs/${firstSong.id}/album`, {
        method: "POST",
        body: JSON.stringify({ albumId: null }),
        headers: { "Content-Type": "application/json" },
    });
    const removeBody = await removeResponse.json();
    assertEquals(removeResponse.status, 200);
    assertEquals(removeBody.song.albumId, null);
});

Deno.test("library maintenance MusicBrainz routes use injected fetch and explicit enrichment", async () => {
    const seenUrls: string[] = [];
    const fetcher = async (input: string | URL | Request): Promise<Response> => {
        const url = input instanceof Request ? input.url : String(input);
        seenUrls.push(url);
        if (url.includes("/artist?")) {
            return Response.json({ artists: [{ id: "mb-artist", name: "Route MB Artist", score: "100" }] });
        }
        return Response.json({
            recordings: [{
                id: "mb-recording",
                title: "Route MB Song",
                score: 90,
                "artist-credit": [{ name: "Route MB Artist" }],
                releases: [{ id: "mb-release", title: "Route MB Album", date: "2026", score: 90 }],
            }],
        });
    };
    const app = authenticatedApp({ baseUrl: "https://example.test/ws/2", fetcher, limit: 2 });
    const artist = upsertArtist("Route MB Artist");
    const song = upsertSong(artist.id, "Route MB Song");

    const lookupResponse = await app.request("/api/library-maintenance/musicbrainz/lookup", {
        method: "POST",
        body: JSON.stringify({ artist: "Route MB Artist", title: "Route MB Song", limit: 3 }),
        headers: { "Content-Type": "application/json" },
    });
    const lookupBody = await lookupResponse.json();
    assertEquals(lookupResponse.status, 200);
    assertEquals(lookupBody.lookup.artists[0].id, "mb-artist");
    assertEquals(lookupBody.lookup.recordings[0].releases[0].title, "Route MB Album");

    const enrichResponse = await app.request("/api/library-maintenance/musicbrainz/enrich-song", {
        method: "POST",
        body: JSON.stringify({ songId: song.id, applyBestReleaseAlbum: true }),
        headers: { "Content-Type": "application/json" },
    });
    const enrichBody = await enrichResponse.json();
    assertEquals(enrichResponse.status, 200);
    assertEquals(enrichBody.bestRecording.id, "mb-recording");
    assertEquals(enrichBody.applied, true);
    assertExists(enrichBody.song.albumId);
    assertEquals(seenUrls.some((url) => url.includes("limit=3")), true);
});

Deno.test.afterAll(async () => {
    kv.close();
    db.close();
    await fs.emptyDir(tempDir);
    await Deno.remove(tempDir);
});

function authenticatedApp(musicBrainz?: { baseUrl: string; fetcher: typeof fetch; limit?: number }): Hono {
    const app = new Hono();
    registerLibraryMaintenanceRoutes(app, {
        enabled: true,
        checkLogin: async () => {},
        musicBrainz: musicBrainz ? { userAgent: "its-mytabs-test/1.0 (test@example.com)", ...musicBrainz } : undefined,
    });
    return app;
}
