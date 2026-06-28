export interface LibraryBrowseVersion {
    id: string;
    songId: number;
    version: number;
    versionLabel: string | null;
    title: string;
    artist: string;
    album: string;
    filename: string;
    originalFilename: string;
    ext: string | null;
    public: boolean;
    fav: boolean;
    preferred: boolean;
    hasAudio: boolean;
    hasYoutube: boolean;
    createdAt: string;
    updatedAt: string;
}

export interface LibraryBrowseSong {
    id: number;
    title: string;
    preferredTabId: string | null;
    preferredVersion: LibraryBrowseVersion | null;
    versionCount: number;
    publicVersionCount: number;
    favVersionCount: number;
    versions: LibraryBrowseVersion[];
}

export interface LibraryBrowseAlbum {
    id: number | null;
    title: string;
    songCount: number;
    versionCount: number;
    songs: LibraryBrowseSong[];
}

export interface LibraryBrowseArtist {
    id: number;
    name: string;
    songCount: number;
    versionCount: number;
    albums: LibraryBrowseAlbum[];
    songs: LibraryBrowseSong[];
}

export interface LibraryBrowseResult {
    mode: "album" | "flat";
    artistCount: number;
    songCount: number;
    versionCount: number;
    artists: LibraryBrowseArtist[];
}

export interface LibraryBrowseRow {
    artistId: number;
    artistName: string;
    albumId: number | null;
    albumTitle: string | null;
    songId: number;
    songTitle: string;
    preferredTabId: string | null;
    tabId: string;
    tabFileId: number | null;
    version: number;
    versionLabel: string | null;
    tabTitle: string;
    tabArtist: string;
    tabAlbum: string;
    filename: string;
    originalFilename: string;
    ext: string | null;
    public: boolean;
    fav: boolean;
    hasAudio: boolean;
    hasYoutube: boolean;
    createdAt: string;
    updatedAt: string;
}

export function buildLibraryBrowse(rows: LibraryBrowseRow[], mode: "album" | "flat"): LibraryBrowseResult {
    const artists = buildLibraryBrowseArtists(rows, mode);
    const songIds = new Set<number>();
    let versionCount = 0;

    for (const artist of artists) {
        versionCount += artist.versionCount;
        for (const album of artist.albums) {
            for (const song of album.songs) {
                songIds.add(song.id);
            }
        }
        for (const song of artist.songs) {
            songIds.add(song.id);
        }
    }

    return {
        mode,
        artistCount: artists.length,
        songCount: songIds.size,
        versionCount,
        artists,
    };
}

export function buildLibraryBrowseArtists(rows: LibraryBrowseRow[], mode: "album" | "flat"): LibraryBrowseArtist[] {
    const artistMap = new Map<number, LibraryBrowseArtist>();

    for (const row of rows) {
        let artist = artistMap.get(row.artistId);
        if (!artist) {
            artist = {
                id: row.artistId,
                name: row.artistName,
                songCount: 0,
                versionCount: 0,
                albums: [],
                songs: [],
            };
            artistMap.set(row.artistId, artist);
        }

        const version = toLibraryBrowseVersion(row);
        const songList = mode === "album" && row.albumId !== null ? getOrCreateAlbum(artist, row).songs : artist.songs;
        const song = getOrCreateSong(songList, row);
        song.versions.push(version);
    }

    const artists = Array.from(artistMap.values());
    for (const artist of artists) {
        finalizeSongs(artist.songs);
        for (const album of artist.albums) {
            finalizeSongs(album.songs);
            album.songCount = album.songs.length;
            album.versionCount = album.songs.reduce((sum, song) => sum + song.versionCount, 0);
        }
        artist.songCount = artist.songs.length + artist.albums.reduce((sum, album) => sum + album.songCount, 0);
        artist.versionCount = artist.songs.reduce((sum, song) => sum + song.versionCount, 0) + artist.albums.reduce((sum, album) => sum + album.versionCount, 0);
    }

    return artists;
}

function getOrCreateAlbum(artist: LibraryBrowseArtist, row: LibraryBrowseRow): LibraryBrowseAlbum {
    let album = artist.albums.find((candidate) => candidate.id === row.albumId);
    if (!album) {
        album = {
            id: row.albumId,
            title: row.albumTitle ?? "",
            songCount: 0,
            versionCount: 0,
            songs: [],
        };
        artist.albums.push(album);
    }
    return album;
}

function getOrCreateSong(songs: LibraryBrowseSong[], row: LibraryBrowseRow): LibraryBrowseSong {
    let song = songs.find((candidate) => candidate.id === row.songId);
    if (!song) {
        song = {
            id: row.songId,
            title: row.songTitle,
            preferredTabId: row.preferredTabId,
            preferredVersion: null,
            versionCount: 0,
            publicVersionCount: 0,
            favVersionCount: 0,
            versions: [],
        };
        songs.push(song);
    }
    return song;
}

function finalizeSongs(songs: LibraryBrowseSong[]): void {
    for (const song of songs) {
        song.versions.sort((a, b) => a.version - b.version || a.id.localeCompare(b.id));
        song.versionCount = song.versions.length;
        song.publicVersionCount = song.versions.filter((version) => version.public).length;
        song.favVersionCount = song.versions.filter((version) => version.fav).length;
        song.preferredVersion = song.versions.find((version) => version.id === song.preferredTabId) ?? song.versions[0] ?? null;
    }
}

function toLibraryBrowseVersion(row: LibraryBrowseRow): LibraryBrowseVersion {
    return {
        id: row.tabId,
        songId: row.songId,
        version: row.version,
        versionLabel: row.versionLabel,
        title: row.tabTitle,
        artist: row.tabArtist,
        album: row.tabAlbum,
        filename: row.filename,
        originalFilename: row.originalFilename,
        ext: row.ext,
        public: row.public,
        fav: row.fav,
        preferred: row.preferredTabId === row.tabId,
        hasAudio: row.hasAudio,
        hasYoutube: row.hasYoutube,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
    };
}
