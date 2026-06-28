import { Context, Hono } from "@hono/hono";
import { ZodError } from "zod";
import { checkLogin } from "./auth.ts";
import { db } from "./db.ts";
import { assignSongAlbumByTitle, createArtistAlias, mergeArtists, moveSongToAlbum, moveTabVersion, splitTabToSong } from "./library-maintenance.ts";
import { chooseBestMusicBrainzRecording, lookupMusicBrainzMetadata, MusicBrainzLookupOptions } from "./musicbrainz.ts";
import {
    AssignSongAlbumByTitleSchema,
    CreateArtistAliasSchema,
    MergeArtistsSchema,
    MoveSongToAlbumSchema,
    MoveTabVersionSchema,
    MusicBrainzEnrichSongSchema,
    MusicBrainzLookupSchema,
    SplitTabToSongSchema,
} from "./zod.ts";

type LoginChecker = (c: Context) => Promise<void>;

interface RegisterLibraryMaintenanceRouteOptions {
    checkLogin?: LoginChecker;
    musicBrainz?: MusicBrainzLookupOptions;
}

type SqlValue = string | number | bigint | null;
type SqlRow = Record<string, SqlValue>;

export function registerLibraryMaintenanceRoutes(app: Hono, options: RegisterLibraryMaintenanceRouteOptions = {}): void {
    const requireLogin = options.checkLogin ?? checkLogin;

    app.post("/api/library-maintenance/artist-aliases", async (c) => {
        try {
            await requireLogin(c);
            const input = CreateArtistAliasSchema.parse(await c.req.json());
            const alias = createArtistAlias(input.artistId, input.alias);
            return c.json({ ok: true, alias });
        } catch (error) {
            return maintenanceRouteError(c, error);
        }
    });

    app.post("/api/library-maintenance/artists/merge", async (c) => {
        try {
            await requireLogin(c);
            const input = MergeArtistsSchema.parse(await c.req.json());
            const result = mergeArtists(input.sourceArtistId, input.targetArtistId);
            return c.json({ ok: true, result });
        } catch (error) {
            return maintenanceRouteError(c, error);
        }
    });

    app.post("/api/library-maintenance/tabs/:tabId/move-version", async (c) => {
        try {
            await requireLogin(c);
            const input = MoveTabVersionSchema.parse(await c.req.json());
            const tab = moveTabVersion(c.req.param("tabId"), input.targetSongId, input.versionLabel ?? null);
            return c.json({ ok: true, tab });
        } catch (error) {
            return maintenanceRouteError(c, error);
        }
    });

    app.post("/api/library-maintenance/tabs/:tabId/split-song", async (c) => {
        try {
            await requireLogin(c);
            const input = SplitTabToSongSchema.parse(await c.req.json());
            const tab = splitTabToSong({
                tabId: c.req.param("tabId"),
                artistId: input.artistId,
                title: input.title,
                albumId: input.albumId ?? null,
                versionLabel: input.versionLabel ?? null,
            });
            return c.json({ ok: true, tab });
        } catch (error) {
            return maintenanceRouteError(c, error);
        }
    });

    app.post("/api/library-maintenance/songs/:songId/album", async (c) => {
        try {
            await requireLogin(c);
            const songId = parsePositiveInteger(c.req.param("songId"), "Invalid song id");
            const input = MoveSongToAlbumSchema.parse(await c.req.json());
            const song = moveSongToAlbum(songId, input.albumId);
            return c.json({ ok: true, song });
        } catch (error) {
            return maintenanceRouteError(c, error);
        }
    });

    app.post("/api/library-maintenance/songs/:songId/album-title", async (c) => {
        try {
            await requireLogin(c);
            const songId = parsePositiveInteger(c.req.param("songId"), "Invalid song id");
            const input = AssignSongAlbumByTitleSchema.parse(await c.req.json());
            const song = assignSongAlbumByTitle(songId, input.albumTitle);
            return c.json({ ok: true, song });
        } catch (error) {
            return maintenanceRouteError(c, error);
        }
    });

    app.post("/api/library-maintenance/musicbrainz/lookup", async (c) => {
        try {
            await requireLogin(c);
            const input = MusicBrainzLookupSchema.parse(await c.req.json());
            const lookup = await lookupMusicBrainzMetadata(input, {
                ...options.musicBrainz,
                limit: input.limit ?? options.musicBrainz?.limit,
            });
            return c.json({ ok: true, lookup });
        } catch (error) {
            return maintenanceRouteError(c, error);
        }
    });

    app.post("/api/library-maintenance/musicbrainz/enrich-song", async (c) => {
        try {
            await requireLogin(c);
            const input = MusicBrainzEnrichSongSchema.parse(await c.req.json());
            const local = getSongLookupContext(input.songId);
            const lookupInput = {
                artist: input.artist ?? local.artist,
                title: input.title ?? local.title,
                album: input.album ?? local.album,
            };
            const lookup = await lookupMusicBrainzMetadata(lookupInput, {
                ...options.musicBrainz,
                limit: input.limit ?? options.musicBrainz?.limit,
            });
            const bestRecording = chooseBestMusicBrainzRecording(lookup.recordings, lookupInput);
            const bestRelease = bestRecording?.releases[0] ?? null;
            const song = input.applyBestReleaseAlbum && bestRelease ? assignSongAlbumByTitle(input.songId, bestRelease.title) : null;
            return c.json({ ok: true, lookup, bestRecording, applied: song !== null, song });
        } catch (error) {
            return maintenanceRouteError(c, error);
        }
    });
}

function parsePositiveInteger(value: string, message: string): number {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isInteger(parsed) || parsed <= 0) {
        throw new Error(message);
    }
    return parsed;
}

function getSongLookupContext(songId: number): { artist: string; title: string; album: string } {
    const row = db.prepare(`
        SELECT artists.name AS artist, songs.title AS title, COALESCE(albums.title, '') AS album
        FROM songs
        INNER JOIN artists ON artists.id = songs.artist_id
        LEFT JOIN albums ON albums.id = songs.album_id
        WHERE songs.id = ?
    `).get(songId) as SqlRow | undefined;
    if (!row) {
        throw new Error("Song not found");
    }
    return {
        artist: readString(row, "artist"),
        title: readString(row, "title"),
        album: readString(row, "album"),
    };
}

function readString(row: SqlRow, key: string): string {
    const value = row[key];
    if (typeof value !== "string") {
        throw new Error(`Expected ${key} to be a string`);
    }
    return value;
}

function maintenanceRouteError(c: Context, error: unknown) {
    if (error instanceof ZodError) {
        return c.json({
            ok: false,
            msg: error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("\n"),
        }, 400);
    }
    if (error instanceof Error) {
        return c.json({
            ok: false,
            msg: error.message,
        }, 400);
    }
    return c.json({
        ok: false,
        msg: "Unknown error",
    }, 400);
}
