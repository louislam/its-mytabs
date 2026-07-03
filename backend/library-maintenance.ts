import { db, withTransaction } from "./db.ts";
import { LibraryArtistAlias, LibrarySong, LibraryTab, upsertAlbum, upsertArtistAlias, upsertSong } from "./library.ts";

type SqlValue = string | number | bigint | null;
type SqlRow = Record<string, SqlValue>;

export interface ArtistMergeResult {
    targetArtistId: number;
    movedSongs: number;
    movedTabs: number;
    createdAliases: LibraryArtistAlias[];
}

export function createArtistAlias(artistId: number, alias: string): LibraryArtistAlias {
    return withTransaction(() => upsertArtistAlias(artistId, alias));
}

export function mergeArtists(sourceArtistId: number, targetArtistId: number): ArtistMergeResult {
    return withTransaction(() => {
        if (sourceArtistId === targetArtistId) {
            throw new Error("Source and target artists must be different");
        }

        const source = requireArtistRow(sourceArtistId);
        requireArtistRow(targetArtistId);

        const createdAliases: LibraryArtistAlias[] = [upsertArtistAlias(targetArtistId, readString(source, "name"))];
        for (const alias of getArtistAliases(sourceArtistId)) {
            createdAliases.push(upsertArtistAlias(targetArtistId, alias.alias));
        }

        const albumIdMap = mergeArtistAlbums(sourceArtistId, targetArtistId);
        const movedSongs = moveArtistSongs(sourceArtistId, targetArtistId, albumIdMap);
        const movedTabs = refreshArtistTabDenormalizedFields(targetArtistId);

        db.prepare("DELETE FROM artists WHERE id = ?").run(sourceArtistId);
        return { targetArtistId, movedSongs, movedTabs, createdAliases };
    });
}

export function moveSongToAlbum(songId: number, albumId: number | null): LibrarySong {
    return withTransaction(() => {
        const song = requireSongRow(songId);
        const artistId = readNumber(song, "artist_id");
        if (albumId !== null) {
            const album = requireAlbumRow(albumId);
            if (readNumber(album, "artist_id") !== artistId) {
                throw new Error("Album does not belong to the song artist");
            }
        }

        const normalizedTitle = readString(song, "normalized_title");
        const conflict = findSongByArtistTitleAlbum(artistId, normalizedTitle, albumId, songId);
        if (conflict) {
            const conflictSongId = readNumber(conflict, "id");
            preservePreferredTab(songId, conflictSongId);
            moveSongTabs(songId, conflictSongId);
            db.prepare("DELETE FROM songs WHERE id = ?").run(songId);
            refreshSongTabDenormalizedFields(conflictSongId);
            return mapSong(requireSongRow(conflictSongId));
        }

        db.prepare("UPDATE songs SET album_id = ?, updated_at = ? WHERE id = ?").run(albumId, new Date().toISOString(), songId);
        refreshSongTabDenormalizedFields(songId);
        return mapSong(requireSongRow(songId));
    });
}

export function moveTabVersion(tabId: string, targetSongId: number, versionLabel?: string | null): LibraryTab {
    return withTransaction(() => {
        const tab = requireTabRow(tabId);
        requireSongRow(targetSongId);
        const sourceSongId = readNumber(tab, "song_id");
        if (sourceSongId === targetSongId) {
            return mapTab(tab);
        }

        const nextVersion = nextTabVersion(targetSongId);
        const context = getSongContext(targetSongId);
        db.prepare(`
        UPDATE tabs
        SET song_id = ?, version = ?, version_label = COALESCE(?, version_label), title = ?, artist = ?, album = ?, updated_at = ?
        WHERE id = ? AND deleted_at IS NULL
    `).run(targetSongId, nextVersion, versionLabel ?? null, context.title, context.artist, context.album, new Date().toISOString(), tabId);
        clearInvalidPreferredTab(sourceSongId);
        return mapTab(requireTabRow(tabId));
    });
}

export function splitTabToSong(input: { tabId: string; artistId: number; title: string; albumId?: number | null; versionLabel?: string | null }): LibraryTab {
    return withTransaction(() => {
        const artistId = input.artistId;
        requireArtistRow(artistId);
        if (input.albumId !== undefined && input.albumId !== null) {
            const album = requireAlbumRow(input.albumId);
            if (readNumber(album, "artist_id") !== artistId) {
                throw new Error("Album does not belong to the target artist");
            }
        }

        const song = upsertSong(artistId, input.title, input.albumId ?? null);
        return moveTabVersion(input.tabId, song.id, input.versionLabel ?? null);
    });
}

export function assignSongAlbumByTitle(songId: number, albumTitle: string | null): LibrarySong {
    return withTransaction(() => {
        const song = requireSongRow(songId);
        if (albumTitle === null || albumTitle.trim() === "") {
            return moveSongToAlbum(songId, null);
        }
        const album = upsertAlbum(readNumber(song, "artist_id"), albumTitle);
        return moveSongToAlbum(songId, album.id);
    });
}

function mergeArtistAlbums(sourceArtistId: number, targetArtistId: number): Map<number, number | null> {
    const map = new Map<number, number | null>();
    for (const album of getArtistAlbums(sourceArtistId)) {
        const sourceAlbumId = readNumber(album, "id");
        const targetAlbum = findAlbumByArtistTitle(targetArtistId, readString(album, "normalized_title"));
        if (targetAlbum) {
            const targetAlbumId = readNumber(targetAlbum, "id");
            map.set(sourceAlbumId, targetAlbumId);
            db.prepare("UPDATE songs SET album_id = ?, updated_at = ? WHERE album_id = ?").run(targetAlbumId, new Date().toISOString(), sourceAlbumId);
            db.prepare("DELETE FROM albums WHERE id = ?").run(sourceAlbumId);
        } else {
            db.prepare("UPDATE albums SET artist_id = ?, updated_at = ? WHERE id = ?").run(targetArtistId, new Date().toISOString(), sourceAlbumId);
            map.set(sourceAlbumId, sourceAlbumId);
        }
    }
    return map;
}

function moveArtistSongs(sourceArtistId: number, targetArtistId: number, albumIdMap: Map<number, number | null>): number {
    let moved = 0;
    for (const song of getArtistSongs(sourceArtistId)) {
        const sourceSongId = readNumber(song, "id");
        const normalizedTitle = readString(song, "normalized_title");
        const sourceAlbumId = readNullableNumber(song, "album_id");
        const targetAlbumId = sourceAlbumId === null ? null : albumIdMap.get(sourceAlbumId) ?? sourceAlbumId;
        const conflict = findSongByArtistTitleAlbum(targetArtistId, normalizedTitle, targetAlbumId, sourceSongId);

        if (conflict) {
            const conflictSongId = readNumber(conflict, "id");
            preservePreferredTab(sourceSongId, conflictSongId);
            moveSongTabs(sourceSongId, conflictSongId);
            db.prepare("DELETE FROM songs WHERE id = ?").run(sourceSongId);
        } else {
            db.prepare("UPDATE songs SET artist_id = ?, album_id = ?, updated_at = ? WHERE id = ?").run(targetArtistId, targetAlbumId, new Date().toISOString(), sourceSongId);
        }
        moved++;
    }
    return moved;
}

function moveSongTabs(sourceSongId: number, targetSongId: number): number {
    let moved = 0;
    const context = getSongContext(targetSongId);
    for (const tab of getSongTabs(sourceSongId)) {
        db.prepare(`
            UPDATE tabs
            SET song_id = ?, version = ?, title = ?, artist = ?, album = ?, updated_at = ?
            WHERE id = ?
        `).run(targetSongId, nextTabVersion(targetSongId), context.title, context.artist, context.album, new Date().toISOString(), readString(tab, "id"));
        moved++;
    }
    clearInvalidPreferredTab(sourceSongId);
    return moved;
}

function refreshArtistTabDenormalizedFields(artistId: number): number {
    const rows = db.prepare("SELECT id FROM songs WHERE artist_id = ?").all(artistId) as SqlRow[];
    let count = 0;
    for (const row of rows) {
        count += refreshSongTabDenormalizedFields(readNumber(row, "id"));
    }
    return count;
}

function refreshSongTabDenormalizedFields(songId: number): number {
    const context = getSongContext(songId);
    const result = db.prepare("UPDATE tabs SET title = ?, artist = ?, album = ?, updated_at = ? WHERE song_id = ? AND deleted_at IS NULL").run(
        context.title,
        context.artist,
        context.album,
        new Date().toISOString(),
        songId,
    );
    return Number(result.changes);
}

function clearInvalidPreferredTab(songId: number): void {
    db.prepare(`
        UPDATE songs
        SET preferred_tab_id = NULL, updated_at = ?
        WHERE id = ? AND preferred_tab_id IS NOT NULL AND preferred_tab_id NOT IN (SELECT id FROM tabs WHERE song_id = ? AND deleted_at IS NULL)
    `).run(new Date().toISOString(), songId, songId);
}

function preservePreferredTab(sourceSongId: number, targetSongId: number): void {
    const target = requireSongRow(targetSongId);
    if (readNullableString(target, "preferred_tab_id") !== null) {
        return;
    }
    const source = requireSongRow(sourceSongId);
    const preferredTabId = readNullableString(source, "preferred_tab_id");
    if (preferredTabId === null) {
        return;
    }
    db.prepare(`
        UPDATE songs
        SET preferred_tab_id = ?, updated_at = ?
        WHERE id = ? AND preferred_tab_id IS NULL
    `).run(preferredTabId, new Date().toISOString(), targetSongId);
}

function getArtistAliases(artistId: number): Array<{ alias: string }> {
    return db.prepare("SELECT alias FROM artist_aliases WHERE artist_id = ? ORDER BY alias COLLATE NOCASE").all(artistId) as Array<{ alias: string }>;
}

function getArtistAlbums(artistId: number): SqlRow[] {
    return db.prepare("SELECT * FROM albums WHERE artist_id = ? ORDER BY id").all(artistId) as SqlRow[];
}

function getArtistSongs(artistId: number): SqlRow[] {
    return db.prepare("SELECT * FROM songs WHERE artist_id = ? ORDER BY id").all(artistId) as SqlRow[];
}

function getSongTabs(songId: number): SqlRow[] {
    return db.prepare("SELECT * FROM tabs WHERE song_id = ? AND deleted_at IS NULL ORDER BY version, id").all(songId) as SqlRow[];
}

function findAlbumByArtistTitle(artistId: number, normalizedTitle: string): SqlRow | undefined {
    return db.prepare("SELECT * FROM albums WHERE artist_id = ? AND normalized_title = ?").get(artistId, normalizedTitle) as SqlRow | undefined;
}

function findSongByArtistTitleAlbum(artistId: number, normalizedTitle: string, albumId: number | null, excludeSongId: number): SqlRow | undefined {
    if (albumId === null) {
        return db.prepare("SELECT * FROM songs WHERE artist_id = ? AND normalized_title = ? AND album_id IS NULL AND id != ?").get(artistId, normalizedTitle, excludeSongId) as SqlRow | undefined;
    }
    return db.prepare("SELECT * FROM songs WHERE artist_id = ? AND normalized_title = ? AND album_id = ? AND id != ?").get(artistId, normalizedTitle, albumId, excludeSongId) as SqlRow | undefined;
}

function nextTabVersion(songId: number): number {
    const row = db.prepare("SELECT COALESCE(MAX(version), 0) + 1 AS next_version FROM tabs WHERE song_id = ?").get(songId) as SqlRow | undefined;
    return row ? readNumber(row, "next_version") : 1;
}

function requireArtistRow(id: number): SqlRow {
    const row = db.prepare("SELECT * FROM artists WHERE id = ?").get(id) as SqlRow | undefined;
    if (!row) {
        throw new Error("Artist not found");
    }
    return row;
}

function requireAlbumRow(id: number): SqlRow {
    const row = db.prepare("SELECT * FROM albums WHERE id = ?").get(id) as SqlRow | undefined;
    if (!row) {
        throw new Error("Album not found");
    }
    return row;
}

function requireSongRow(id: number): SqlRow {
    const row = db.prepare("SELECT * FROM songs WHERE id = ?").get(id) as SqlRow | undefined;
    if (!row) {
        throw new Error("Song not found");
    }
    return row;
}

function requireTabRow(id: string): SqlRow {
    const row = db.prepare("SELECT * FROM tabs WHERE id = ? AND deleted_at IS NULL").get(id) as SqlRow | undefined;
    if (!row) {
        throw new Error("Tab not found");
    }
    return row;
}

function getSongContext(songId: number): { title: string; artist: string; album: string } {
    const row = db.prepare(`
        SELECT songs.title AS title, artists.name AS artist, COALESCE(albums.title, '') AS album
        FROM songs
        INNER JOIN artists ON artists.id = songs.artist_id
        LEFT JOIN albums ON albums.id = songs.album_id
        WHERE songs.id = ?
    `).get(songId) as SqlRow | undefined;
    if (!row) {
        throw new Error("Song not found");
    }
    return {
        title: readString(row, "title"),
        artist: readString(row, "artist"),
        album: readString(row, "album"),
    };
}

function mapSong(row: SqlRow): LibrarySong {
    return {
        id: readNumber(row, "id"),
        artistId: readNumber(row, "artist_id"),
        albumId: readNullableNumber(row, "album_id"),
        preferredTabId: readNullableString(row, "preferred_tab_id"),
        title: readString(row, "title"),
        normalizedTitle: readString(row, "normalized_title"),
        createdAt: readString(row, "created_at"),
        updatedAt: readString(row, "updated_at"),
    };
}

function mapTab(row: SqlRow): LibraryTab {
    return {
        id: readString(row, "id"),
        songId: readNumber(row, "song_id"),
        tabFileId: readNullableNumber(row, "tab_file_id"),
        version: readNumber(row, "version"),
        versionLabel: readNullableString(row, "version_label"),
        title: readString(row, "title"),
        artist: readString(row, "artist"),
        album: readString(row, "album"),
        filename: readString(row, "filename"),
        originalFilename: readString(row, "original_filename"),
        public: readBoolean(row, "public"),
        fav: readBoolean(row, "fav"),
        createdAt: readString(row, "created_at"),
        updatedAt: readString(row, "updated_at"),
        deletedAt: readNullableString(row, "deleted_at"),
    };
}

function readString(row: SqlRow, key: string): string {
    const value = row[key];
    if (typeof value !== "string") {
        throw new Error(`Expected ${key} to be a string`);
    }
    return value;
}

function readNullableString(row: SqlRow, key: string): string | null {
    const value = row[key];
    if (value === null) {
        return null;
    }
    if (typeof value !== "string") {
        throw new Error(`Expected ${key} to be a nullable string`);
    }
    return value;
}

function readNumber(row: SqlRow, key: string): number {
    const value = row[key];
    if (typeof value === "number") {
        return value;
    }
    if (typeof value === "bigint") {
        return Number(value);
    }
    throw new Error(`Expected ${key} to be a number`);
}

function readNullableNumber(row: SqlRow, key: string): number | null {
    const value = row[key];
    if (value === null) {
        return null;
    }
    if (typeof value === "number") {
        return value;
    }
    if (typeof value === "bigint") {
        return Number(value);
    }
    throw new Error(`Expected ${key} to be a nullable number`);
}

function readBoolean(row: SqlRow, key: string): boolean {
    return readNumber(row, key) === 1;
}
