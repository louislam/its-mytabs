import { db } from "./db.ts";
import { ConfigJSON, TabInfo, TabInfoSchema } from "./zod.ts";

type SqlValue = string | number | bigint | null;
type SqlRow = Record<string, SqlValue>;

export interface LibraryArtist {
    id: number;
    name: string;
    normalizedName: string;
    createdAt: string;
    updatedAt: string;
}

export interface LibraryArtistAlias {
    id: number;
    artistId: number;
    alias: string;
    normalizedAlias: string;
    createdAt: string;
}

export interface LibraryAlbum {
    id: number;
    artistId: number;
    title: string;
    normalizedTitle: string;
    releaseYear: number | null;
    createdAt: string;
    updatedAt: string;
}

export interface LibrarySong {
    id: number;
    artistId: number;
    albumId: number | null;
    preferredTabId: string | null;
    title: string;
    normalizedTitle: string;
    createdAt: string;
    updatedAt: string;
}

export interface LibraryTabFile {
    id: number;
    sha256: string;
    byteSize: number;
    ext: string;
    storedPath: string;
    createdAt: string;
}

export interface LibraryTabFileSource {
    id: number;
    tabFileId: number;
    sourceType: string;
    sourcePath: string;
    originalFilename: string;
    importedAt: string;
    metadataJson: string;
}

export interface LibraryTab {
    id: string;
    songId: number;
    tabFileId: number | null;
    version: number;
    versionLabel: string | null;
    title: string;
    artist: string;
    album: string;
    filename: string;
    originalFilename: string;
    public: boolean;
    fav: boolean;
    createdAt: string;
    updatedAt: string;
    deletedAt: string | null;
}

export interface ImportCreatedTabSummary {
    id: string;
    title: string;
    artist: string;
}

export interface UpsertLibraryTabInput {
    id?: string;
    songId: number;
    tabFileId?: number | null;
    version?: number;
    versionLabel?: string | null;
    title?: string;
    artist?: string;
    album?: string;
    filename?: string;
    originalFilename?: string;
    public?: boolean;
    fav?: boolean;
    createdAt?: string;
}

export interface LibraryTabListOptions {
    includePrivate?: boolean;
    publicOnly?: boolean;
    favOnly?: boolean;
}

interface SongContext {
    title: string;
    artist: string;
    album: string;
}

export function normalizeLibraryText(value: string): string {
    return value.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
}

export function upsertArtist(name: string): LibraryArtist {
    const trimmedName = name.trim();
    if (!trimmedName) {
        throw new Error("Artist name is required");
    }

    const now = new Date().toISOString();
    const normalizedName = normalizeLibraryText(trimmedName);
    db.prepare(`
        INSERT INTO artists (name, normalized_name, created_at, updated_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(normalized_name) DO UPDATE SET
            name = excluded.name,
            updated_at = excluded.updated_at
    `).run(trimmedName, normalizedName, now, now);

    return requireArtistByNormalizedName(normalizedName);
}

export function getArtist(id: number): LibraryArtist | null {
    const row = db.prepare("SELECT * FROM artists WHERE id = ?").get(id) as SqlRow | undefined;
    return row ? mapArtist(row) : null;
}

export function findArtistByName(name: string): LibraryArtist | null {
    const normalizedName = normalizeLibraryText(name);
    const row = db.prepare("SELECT * FROM artists WHERE normalized_name = ?").get(normalizedName) as SqlRow | undefined;
    return row ? mapArtist(row) : null;
}

export function upsertArtistAlias(artistId: number, alias: string): LibraryArtistAlias {
    requireArtist(artistId);

    const trimmedAlias = alias.trim();
    if (!trimmedAlias) {
        throw new Error("Artist alias is required");
    }

    const now = new Date().toISOString();
    const normalizedAlias = normalizeLibraryText(trimmedAlias);
    db.prepare(`
        INSERT INTO artist_aliases (artist_id, alias, normalized_alias, created_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(normalized_alias) DO UPDATE SET
            artist_id = excluded.artist_id,
            alias = excluded.alias
    `).run(artistId, trimmedAlias, normalizedAlias, now);

    const row = db.prepare("SELECT * FROM artist_aliases WHERE normalized_alias = ?").get(normalizedAlias) as SqlRow | undefined;
    if (!row) {
        throw new Error("Failed to upsert artist alias");
    }
    return mapArtistAlias(row);
}

export function upsertAlbum(artistId: number, title: string, releaseYear: number | null = null): LibraryAlbum {
    requireArtist(artistId);

    const trimmedTitle = title.trim();
    if (!trimmedTitle) {
        throw new Error("Album title is required");
    }

    const now = new Date().toISOString();
    const normalizedTitle = normalizeLibraryText(trimmedTitle);
    db.prepare(`
        INSERT INTO albums (artist_id, title, normalized_title, release_year, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(artist_id, normalized_title) DO UPDATE SET
            title = excluded.title,
            release_year = COALESCE(excluded.release_year, albums.release_year),
            updated_at = excluded.updated_at
    `).run(artistId, trimmedTitle, normalizedTitle, releaseYear, now, now);

    const row = db.prepare("SELECT * FROM albums WHERE artist_id = ? AND normalized_title = ?").get(artistId, normalizedTitle) as SqlRow | undefined;
    if (!row) {
        throw new Error("Failed to upsert album");
    }
    return mapAlbum(row);
}

export function getAlbum(id: number): LibraryAlbum | null {
    const row = db.prepare("SELECT * FROM albums WHERE id = ?").get(id) as SqlRow | undefined;
    return row ? mapAlbum(row) : null;
}

export function upsertSong(artistId: number, title: string, albumId: number | null = null): LibrarySong {
    requireArtist(artistId);
    if (albumId !== null) {
        const album = getAlbum(albumId);
        if (!album || album.artistId !== artistId) {
            throw new Error("Album not found for artist");
        }
    }

    const trimmedTitle = title.trim();
    if (!trimmedTitle) {
        throw new Error("Song title is required");
    }

    const now = new Date().toISOString();
    const normalizedTitle = normalizeLibraryText(trimmedTitle);
    const existing = findSongByArtistTitleAlbum(artistId, normalizedTitle, albumId);
    if (existing) {
        db.prepare(`
            UPDATE songs
            SET title = ?, updated_at = ?
            WHERE id = ?
        `).run(trimmedTitle, now, existing.id);
        return requireSong(existing.id);
    }

    db.prepare(`
        INSERT INTO songs (artist_id, album_id, title, normalized_title, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
    `).run(artistId, albumId, trimmedTitle, normalizedTitle, now, now);

    const row = findSongRowByArtistTitleAlbum(artistId, normalizedTitle, albumId);
    if (!row) {
        throw new Error("Failed to upsert song");
    }
    return mapSong(row);
}

export function getSong(id: number): LibrarySong | null {
    const row = db.prepare("SELECT * FROM songs WHERE id = ?").get(id) as SqlRow | undefined;
    return row ? mapSong(row) : null;
}

export function upsertTabFile(input: { sha256: string; byteSize: number; ext: string; storedPath: string }): LibraryTabFile {
    const sha256 = input.sha256.toLowerCase();
    if (!/^[a-f0-9]{64}$/.test(sha256)) {
        throw new Error("Invalid SHA-256 hash");
    }
    if (input.byteSize < 0) {
        throw new Error("File size cannot be negative");
    }

    const ext = input.ext.toLowerCase().replace(/^\./, "");
    if (!/^[a-z0-9]+$/.test(ext)) {
        throw new Error("Invalid file extension");
    }

    const now = new Date().toISOString();
    db.prepare(`
        INSERT INTO tab_files (sha256, byte_size, ext, stored_path, created_at)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(sha256) DO UPDATE SET
            byte_size = excluded.byte_size
    `).run(sha256, input.byteSize, ext, input.storedPath, now);

    return requireTabFileByHash(sha256);
}

export function getTabFile(id: number): LibraryTabFile | null {
    const row = db.prepare("SELECT * FROM tab_files WHERE id = ?").get(id) as SqlRow | undefined;
    return row ? mapTabFile(row) : null;
}

export function getTabFileByHash(sha256: string): LibraryTabFile | null {
    const row = db.prepare("SELECT * FROM tab_files WHERE sha256 = ?").get(sha256.toLowerCase()) as SqlRow | undefined;
    return row ? mapTabFile(row) : null;
}

export function upsertTabFileSource(input: { tabFileId: number; sourceType: string; sourcePath: string; originalFilename?: string; metadata?: unknown }): LibraryTabFileSource {
    requireTabFile(input.tabFileId);

    const sourceType = input.sourceType.trim();
    const sourcePath = input.sourcePath.trim();
    if (!sourceType || !sourcePath) {
        throw new Error("Tab file source type and path are required");
    }

    const importedAt = new Date().toISOString();
    const metadataJson = JSON.stringify(input.metadata ?? {});
    db.prepare(`
        INSERT INTO tab_file_sources (tab_file_id, source_type, source_path, original_filename, imported_at, metadata_json)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(tab_file_id, source_type, source_path) DO UPDATE SET
            original_filename = excluded.original_filename,
            metadata_json = excluded.metadata_json
    `).run(input.tabFileId, sourceType, sourcePath, input.originalFilename ?? "", importedAt, metadataJson);

    const row = db.prepare(`
        SELECT * FROM tab_file_sources
        WHERE tab_file_id = ? AND source_type = ? AND source_path = ?
    `).get(input.tabFileId, sourceType, sourcePath) as SqlRow | undefined;
    if (!row) {
        throw new Error("Failed to upsert tab file source");
    }
    return mapTabFileSource(row);
}

export function upsertLibraryTab(input: UpsertLibraryTabInput): LibraryTab {
    const context = getSongContext(input.songId);
    if (input.tabFileId !== undefined && input.tabFileId !== null) {
        requireTabFile(input.tabFileId);
    }

    const id = input.id ?? crypto.randomUUID();
    const existing = getLibraryTab(id);
    const version = input.version ?? existing?.version ?? getNextTabVersion(input.songId);
    const versionLabel = input.versionLabel ?? existing?.versionLabel ?? null;
    const now = new Date().toISOString();
    const createdAt = existing?.createdAt ?? input.createdAt ?? now;
    const title = (input.title ?? context.title).trim() || context.title;
    const artist = (input.artist ?? context.artist).trim();
    const album = (input.album ?? context.album).trim();
    const filename = input.filename ?? `tab.${getTabFileExtension(input.tabFileId) ?? "gp"}`;
    const originalFilename = input.originalFilename ?? filename;
    const isPublic = input.public ?? existing?.public ?? false;
    const fav = input.fav ?? existing?.fav ?? false;

    db.prepare(`
        INSERT INTO tabs (id, song_id, tab_file_id, version, version_label, title, artist, album, filename, original_filename, public, fav, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
            song_id = excluded.song_id,
            tab_file_id = excluded.tab_file_id,
            version = excluded.version,
            version_label = excluded.version_label,
            title = excluded.title,
            artist = excluded.artist,
            album = excluded.album,
            filename = excluded.filename,
            original_filename = excluded.original_filename,
            public = excluded.public,
            fav = excluded.fav,
            updated_at = excluded.updated_at,
            deleted_at = NULL
    `).run(id, input.songId, input.tabFileId ?? null, version, versionLabel, title, artist, album, filename, originalFilename, isPublic ? 1 : 0, fav ? 1 : 0, createdAt, now);

    const tab = getLibraryTab(id);
    if (!tab) {
        throw new Error("Failed to upsert library tab");
    }
    return tab;
}

export function getLibraryTab(id: string): LibraryTab | null {
    const row = db.prepare("SELECT * FROM tabs WHERE id = ? AND deleted_at IS NULL").get(id) as SqlRow | undefined;
    return row ? mapTab(row) : null;
}

export function getCreatedImportTabSummaries(jobId: string): ImportCreatedTabSummary[] {
    const rows = db.prepare(`
        SELECT tabs.id AS id, songs.title AS title, artists.name AS artist
        FROM import_items
        INNER JOIN tabs ON tabs.id = import_items.created_tab_id
        INNER JOIN songs ON songs.id = tabs.song_id
        INNER JOIN artists ON artists.id = songs.artist_id
        WHERE import_items.job_id = ? AND import_items.created_tab_id IS NOT NULL
        ORDER BY artists.name COLLATE NOCASE, songs.title COLLATE NOCASE, tabs.version
    `).all(jobId) as SqlRow[];

    return rows.map(mapImportCreatedTabSummary);
}

export function deleteLibraryTab(id: string): void {
    db.prepare("UPDATE tabs SET deleted_at = ?, updated_at = ? WHERE id = ?").run(new Date().toISOString(), new Date().toISOString(), id);
}

export function updateLibraryTabVisibility(id: string, isPublic: boolean): LibraryTab {
    db.prepare("UPDATE tabs SET public = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL").run(isPublic ? 1 : 0, new Date().toISOString(), id);
    return requireLibraryTab(id);
}

export function updateLibraryTabFav(id: string, fav: boolean): LibraryTab {
    db.prepare("UPDATE tabs SET fav = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL").run(fav ? 1 : 0, new Date().toISOString(), id);
    return requireLibraryTab(id);
}

export function getLibraryTabInfo(id: string): TabInfo | null {
    const tab = getLibraryTab(id);
    return tab ? toTabInfo(tab) : null;
}

export function getLibraryConfigJSON(id: string): ConfigJSON | null {
    const tab = getLibraryTabInfo(id);
    if (!tab) {
        return null;
    }
    return {
        tab,
        audio: [],
        youtube: [],
    };
}

export function getAllLibraryTabInfos(options: LibraryTabListOptions = {}): TabInfo[] {
    const clauses = ["deleted_at IS NULL"];
    if (options.publicOnly || options.includePrivate === false) {
        clauses.push("public = 1");
    }
    if (options.favOnly) {
        clauses.push("fav = 1");
    }

    const rows = db.prepare(`
        SELECT * FROM tabs
        WHERE ${clauses.join(" AND ")}
        ORDER BY datetime(created_at) DESC, id DESC
    `).all() as SqlRow[];

    return rows.map((row) => toTabInfo(mapTab(row)));
}

export function canReadLibraryTab(id: string, loggedIn: boolean): boolean {
    const tab = getLibraryTab(id);
    if (!tab) {
        return false;
    }
    return tab.public || loggedIn;
}

export function setPreferredSongTab(songId: number, tabId: string | null): LibrarySong {
    if (tabId !== null) {
        const tab = requireLibraryTab(tabId);
        if (tab.songId !== songId) {
            throw new Error("Preferred tab does not belong to song");
        }
    }
    db.prepare("UPDATE songs SET preferred_tab_id = ?, updated_at = ? WHERE id = ?").run(tabId, new Date().toISOString(), songId);
    return requireSong(songId);
}

function requireArtist(id: number): LibraryArtist {
    const artist = getArtist(id);
    if (!artist) {
        throw new Error("Artist not found");
    }
    return artist;
}

function requireArtistByNormalizedName(normalizedName: string): LibraryArtist {
    const row = db.prepare("SELECT * FROM artists WHERE normalized_name = ?").get(normalizedName) as SqlRow | undefined;
    if (!row) {
        throw new Error("Artist not found after upsert");
    }
    return mapArtist(row);
}

function requireTabFile(id: number): LibraryTabFile {
    const tabFile = getTabFile(id);
    if (!tabFile) {
        throw new Error("Tab file not found");
    }
    return tabFile;
}

function requireTabFileByHash(sha256: string): LibraryTabFile {
    const tabFile = getTabFileByHash(sha256);
    if (!tabFile) {
        throw new Error("Tab file not found after upsert");
    }
    return tabFile;
}

function requireLibraryTab(id: string): LibraryTab {
    const tab = getLibraryTab(id);
    if (!tab) {
        throw new Error("Tab not found");
    }
    return tab;
}

function requireSong(id: number): LibrarySong {
    const song = getSong(id);
    if (!song) {
        throw new Error("Song not found");
    }
    return song;
}

function findSongByArtistTitleAlbum(artistId: number, normalizedTitle: string, albumId: number | null): LibrarySong | null {
    const row = findSongRowByArtistTitleAlbum(artistId, normalizedTitle, albumId);
    return row ? mapSong(row) : null;
}

function findSongRowByArtistTitleAlbum(artistId: number, normalizedTitle: string, albumId: number | null): SqlRow | undefined {
    if (albumId === null) {
        return db.prepare("SELECT * FROM songs WHERE artist_id = ? AND normalized_title = ? AND album_id IS NULL").get(artistId, normalizedTitle) as SqlRow | undefined;
    }
    return db.prepare("SELECT * FROM songs WHERE artist_id = ? AND normalized_title = ? AND album_id = ?").get(artistId, normalizedTitle, albumId) as SqlRow | undefined;
}

function getSongContext(songId: number): SongContext {
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

function getTabFileExtension(tabFileId: number | null | undefined): string | null {
    if (tabFileId === undefined || tabFileId === null) {
        return null;
    }
    return getTabFile(tabFileId)?.ext ?? null;
}

function getNextTabVersion(songId: number): number {
    const row = db.prepare("SELECT COALESCE(MAX(version), 0) + 1 AS next_version FROM tabs WHERE song_id = ?").get(songId) as SqlRow | undefined;
    return row ? readNumber(row, "next_version") : 1;
}

function toTabInfo(tab: LibraryTab): TabInfo {
    return TabInfoSchema.parse({
        id: tab.id,
        title: tab.title,
        artist: tab.artist,
        filename: tab.filename,
        originalFilename: tab.originalFilename,
        createdAt: tab.createdAt,
        public: tab.public,
        fav: tab.fav,
    });
}

function mapArtist(row: SqlRow): LibraryArtist {
    return {
        id: readNumber(row, "id"),
        name: readString(row, "name"),
        normalizedName: readString(row, "normalized_name"),
        createdAt: readString(row, "created_at"),
        updatedAt: readString(row, "updated_at"),
    };
}

function mapArtistAlias(row: SqlRow): LibraryArtistAlias {
    return {
        id: readNumber(row, "id"),
        artistId: readNumber(row, "artist_id"),
        alias: readString(row, "alias"),
        normalizedAlias: readString(row, "normalized_alias"),
        createdAt: readString(row, "created_at"),
    };
}

function mapAlbum(row: SqlRow): LibraryAlbum {
    return {
        id: readNumber(row, "id"),
        artistId: readNumber(row, "artist_id"),
        title: readString(row, "title"),
        normalizedTitle: readString(row, "normalized_title"),
        releaseYear: readNullableNumber(row, "release_year"),
        createdAt: readString(row, "created_at"),
        updatedAt: readString(row, "updated_at"),
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

function mapTabFile(row: SqlRow): LibraryTabFile {
    return {
        id: readNumber(row, "id"),
        sha256: readString(row, "sha256"),
        byteSize: readNumber(row, "byte_size"),
        ext: readString(row, "ext"),
        storedPath: readString(row, "stored_path"),
        createdAt: readString(row, "created_at"),
    };
}

function mapTabFileSource(row: SqlRow): LibraryTabFileSource {
    return {
        id: readNumber(row, "id"),
        tabFileId: readNumber(row, "tab_file_id"),
        sourceType: readString(row, "source_type"),
        sourcePath: readString(row, "source_path"),
        originalFilename: readString(row, "original_filename"),
        importedAt: readString(row, "imported_at"),
        metadataJson: readString(row, "metadata_json"),
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

function mapImportCreatedTabSummary(row: SqlRow): ImportCreatedTabSummary {
    return {
        id: readString(row, "id"),
        title: readString(row, "title"),
        artist: readString(row, "artist"),
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
