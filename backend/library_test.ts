import { assertEquals, assertExists } from "jsr:@std/assert@^1.0.17";
import * as fs from "@std/fs";

const tempDir = await Deno.makeTempDir();
Deno.env.set("DATA_DIR", tempDir);
Deno.env.set("MYTABS_PORT", "47779");

const {
    assignSongAlbumByTitle,
    createArtistAlias,
    mergeArtists,
    moveTabVersion,
    splitTabToSong,
} = await import("./library-maintenance.ts");
const {
    canReadLibraryTab,
    findArtistByName,
    getAllLibraryTabInfos,
    getLibraryConfigJSON,
    getLibraryTabInfo,
    getTabFileByHash,
    normalizeLibraryText,
    updateLibraryTabFav,
    updateLibraryTabVisibility,
    upsertAlbum,
    upsertArtist,
    upsertArtistAlias,
    upsertLibraryTab,
    setPreferredSongTab,
    upsertSong,
    upsertTabFile,
    upsertTabFileSource,
} = await import("./library.ts");
const { db, kv } = await import("./db.ts");

Deno.test("library schema migration creates idempotent tables and indexes", () => {
    const tableNames = db.prepare(`
        SELECT name FROM sqlite_master
        WHERE type = 'table'
        ORDER BY name
    `).all().map((row) => (row as { name: string }).name);

    for (const expected of ["artists", "artist_aliases", "albums", "songs", "tabs", "tab_files", "tab_file_sources", "import_jobs", "import_items"]) {
        assertEquals(tableNames.includes(expected), true, `${expected} table is missing`);
    }

    const indexNames = db.prepare(`
        SELECT name FROM sqlite_master
        WHERE type = 'index'
        ORDER BY name
    `).all().map((row) => (row as { name: string }).name);

    for (const expected of ["idx_artists_normalized_name", "idx_songs_artist_title", "idx_tab_files_sha256", "idx_import_items_job_status_selected"]) {
        assertEquals(indexNames.includes(expected), true, `${expected} index is missing`);
    }
});

Deno.test("library repository upserts normalized artist album song data", () => {
    assertEquals(normalizeLibraryText("  Example   Artist  "), "example artist");

    const artist = upsertArtist("Example Artist");
    const sameArtist = upsertArtist(" example   artist ");
    assertEquals(sameArtist.id, artist.id);
    assertEquals(findArtistByName("EXAMPLE ARTIST")?.id, artist.id);

    const alias = upsertArtistAlias(artist.id, "Example Alias");
    const sameAlias = upsertArtistAlias(artist.id, " example   alias ");
    assertEquals(sameAlias.id, alias.id);

    const album = upsertAlbum(artist.id, "First Album", 2026);
    const sameAlbum = upsertAlbum(artist.id, " first   album ");
    assertEquals(sameAlbum.id, album.id);
    assertEquals(sameAlbum.releaseYear, 2026);

    const song = upsertSong(artist.id, "First Song", album.id);
    const sameSong = upsertSong(artist.id, " first song ", album.id);
    assertEquals(sameSong.id, song.id);
    assertEquals(sameSong.albumId, album.id);

    const flatSong = upsertSong(artist.id, "First Song");
    assertEquals(flatSong.id === song.id, false);
    assertEquals(flatSong.albumId, null);
});

Deno.test("library tabs preserve exact ids, denormalized fields, versions, and visibility adapter behavior", () => {
    const artist = upsertArtist("Adapter Artist");
    const album = upsertAlbum(artist.id, "Adapter Album");
    const song = upsertSong(artist.id, "Adapter Song", album.id);
    const hash = "a".repeat(64);
    const file = upsertTabFile({
        sha256: hash,
        byteSize: 12,
        ext: "gp",
        storedPath: `files/aa/${hash}.gp`,
    });
    const sameFile = upsertTabFile({
        sha256: hash,
        byteSize: 12,
        ext: "gp",
        storedPath: `files/aa/${hash}.gp`,
    });
    assertEquals(sameFile.id, file.id);
    assertEquals(getTabFileByHash(hash)?.id, file.id);

    const source = upsertTabFileSource({
        tabFileId: file.id,
        sourceType: "import",
        sourcePath: "/music/adapter-song.gp",
        originalFilename: "adapter-song.gp",
        metadata: { selected: true },
    });
    const sameSource = upsertTabFileSource({
        tabFileId: file.id,
        sourceType: "import",
        sourcePath: "/music/adapter-song.gp",
        originalFilename: "adapter-song.gp",
        metadata: { selected: false },
    });
    assertEquals(sameSource.id, source.id);

    const firstTab = upsertLibraryTab({
        id: "legacy-100",
        songId: song.id,
        tabFileId: file.id,
        filename: "tab.gp",
        originalFilename: "adapter-song.gp",
        versionLabel: "Version 1",
        public: false,
    });
    const secondTab = upsertLibraryTab({
        id: "legacy-101",
        songId: song.id,
        tabFileId: file.id,
        filename: "tab.gp",
        originalFilename: "adapter-song-alt.gp",
        versionLabel: "Version 2",
        public: true,
        fav: true,
    });

    assertEquals(firstTab.version, 1);
    assertEquals(firstTab.versionLabel, "Version 1");
    assertEquals(secondTab.version, 2);
    assertEquals(secondTab.versionLabel, "Version 2");
    assertEquals(firstTab.title, "Adapter Song");
    assertEquals(firstTab.artist, "Adapter Artist");
    assertEquals(firstTab.album, "Adapter Album");

    const tabInfo = getLibraryTabInfo("legacy-101");
    assertExists(tabInfo);
    assertEquals(tabInfo.id, "legacy-101");
    assertEquals(tabInfo.public, true);
    assertEquals(tabInfo.fav, true);

    const config = getLibraryConfigJSON("legacy-101");
    assertExists(config);
    assertEquals(config.tab.id, "legacy-101");
    assertEquals(config.audio, []);
    assertEquals(config.youtube, []);

    assertEquals(canReadLibraryTab("legacy-100", false), false);
    assertEquals(canReadLibraryTab("legacy-100", true), true);
    assertEquals(canReadLibraryTab("legacy-101", false), true);

    const preferredSong = setPreferredSongTab(song.id, "legacy-101");
    assertEquals(preferredSong.preferredTabId, "legacy-101");

    updateLibraryTabVisibility("legacy-100", true);
    updateLibraryTabFav("legacy-100", true);
    assertEquals(getLibraryTabInfo("legacy-100")?.public, true);
    assertEquals(getLibraryTabInfo("legacy-100")?.fav, true);

    const publicTabs = getAllLibraryTabInfos({ publicOnly: true });
    assertEquals(publicTabs.some((tab) => tab.id === "legacy-100"), true);
    assertEquals(publicTabs.some((tab) => tab.id === "legacy-101"), true);

    const favTabs = getAllLibraryTabInfos({ favOnly: true });
    assertEquals(favTabs.every((tab) => tab.fav), true);
});

Deno.test("artist merge preserves aliases, songs, and tab versions", () => {
    const targetArtist = upsertArtist("Merge Target Artist");
    const sourceArtist = upsertArtist("Merge Source Artist");
    createArtistAlias(sourceArtist.id, "Source Alias");

    const targetAlbum = upsertAlbum(targetArtist.id, "Shared Album");
    const sourceAlbum = upsertAlbum(sourceArtist.id, "Shared Album");
    const targetSong = upsertSong(targetArtist.id, "Shared Song", targetAlbum.id);
    const sourceSong = upsertSong(sourceArtist.id, "Shared Song", sourceAlbum.id);
    const sourceOnlySong = upsertSong(sourceArtist.id, "Source Only Song");

    const firstTab = upsertLibraryTab({ id: "merge-target-tab", songId: targetSong.id, originalFilename: "target.gp", public: true, fav: true });
    const movedVersion = upsertLibraryTab({ id: "merge-source-version", songId: sourceSong.id, originalFilename: "source.gp", public: true, fav: true });
    const movedSongTab = upsertLibraryTab({ id: "merge-source-song", songId: sourceOnlySong.id, originalFilename: "source-only.gp" });

    const result = mergeArtists(sourceArtist.id, targetArtist.id);
    assertEquals(result.targetArtistId, targetArtist.id);
    assertEquals(result.movedSongs, 2);
    assertEquals(result.movedTabs >= 3, true);

    const aliases = db.prepare("SELECT alias FROM artist_aliases WHERE artist_id = ? ORDER BY alias COLLATE NOCASE").all(targetArtist.id) as Array<{ alias: string }>;
    assertEquals(aliases.some((alias) => alias.alias === "Merge Source Artist"), true);
    assertEquals(aliases.some((alias) => alias.alias === "Source Alias"), true);

    const movedVersionRow = db.prepare("SELECT song_id, version, artist, album, public, fav FROM tabs WHERE id = ?").get(movedVersion.id) as Record<string, unknown>;
    assertEquals(movedVersionRow.song_id, targetSong.id);
    assertEquals(movedVersionRow.version, firstTab.version + 1);
    assertEquals(movedVersionRow.artist, "Merge Target Artist");
    assertEquals(movedVersionRow.album, "Shared Album");
    assertEquals(movedVersionRow.public, 1);
    assertEquals(movedVersionRow.fav, 1);

    const movedSongRow = db.prepare("SELECT songs.artist_id, tabs.artist FROM songs INNER JOIN tabs ON tabs.song_id = songs.id WHERE tabs.id = ?").get(movedSongTab.id) as Record<string, unknown>;
    assertEquals(movedSongRow.artist_id, targetArtist.id);
    assertEquals(movedSongRow.artist, "Merge Target Artist");
});

Deno.test("maintenance tools move versions, split songs, and clean album assignments", () => {
    const artist = upsertArtist("Maintenance Artist");
    const album = upsertAlbum(artist.id, "Maintenance Album");
    const firstSong = upsertSong(artist.id, "Maintenance Song", album.id);
    const secondSong = upsertSong(artist.id, "Maintenance Alternate", album.id);
    const firstTab = upsertLibraryTab({ id: "maintenance-first", songId: firstSong.id, public: true, fav: true });
    const movedTab = upsertLibraryTab({ id: "maintenance-move", songId: firstSong.id, versionLabel: "Alt" });

    const moved = moveTabVersion(movedTab.id, secondSong.id, "Moved Version");
    assertEquals(moved.songId, secondSong.id);
    assertEquals(moved.version, 1);
    assertEquals(moved.versionLabel, "Moved Version");
    assertEquals(moved.public, false);
    assertEquals(moved.fav, false);

    const split = splitTabToSong({ tabId: movedTab.id, artistId: artist.id, title: "Maintenance Split", albumId: album.id, versionLabel: "Split" });
    assertEquals(split.title, "Maintenance Split");
    assertEquals(split.album, "Maintenance Album");
    assertEquals(split.versionLabel, "Split");

    const assigned = assignSongAlbumByTitle(firstSong.id, "Cleanup Album");
    assertEquals(assigned.albumId !== null, true);
    const firstTabRow = db.prepare("SELECT public, fav, album FROM tabs WHERE id = ?").get(firstTab.id) as Record<string, unknown>;
    assertEquals(firstTabRow.public, 1);
    assertEquals(firstTabRow.fav, 1);
    assertEquals(firstTabRow.album, "Cleanup Album");

    const removed = assignSongAlbumByTitle(firstSong.id, null);
    assertEquals(removed.albumId, null);
    const noAlbumRow = db.prepare("SELECT album FROM tabs WHERE id = ?").get(firstTab.id) as Record<string, unknown>;
    assertEquals(noAlbumRow.album, "");
});

Deno.test.afterAll(async () => {
    kv.close();
    db.close();
    await fs.emptyDir(tempDir);
    await Deno.remove(tempDir);
});
