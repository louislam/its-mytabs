import { normalizeLibraryText } from "./library.ts";

export interface MusicBrainzLookupOptions {
    baseUrl?: string;
    fetcher?: typeof fetch;
    userAgent?: string;
    limit?: number;
}

export interface MusicBrainzArtistCandidate {
    id: string;
    name: string;
    disambiguation: string;
    country: string;
    score: number;
}

export interface MusicBrainzReleaseCandidate {
    id: string;
    title: string;
    date: string;
    score: number;
}

export interface MusicBrainzRecordingCandidate {
    id: string;
    title: string;
    artist: string;
    releases: MusicBrainzReleaseCandidate[];
    score: number;
}

export interface MusicBrainzLookupResult {
    artists: MusicBrainzArtistCandidate[];
    recordings: MusicBrainzRecordingCandidate[];
}

export async function lookupMusicBrainzMetadata(
    input: { artist?: string | null; title?: string | null; album?: string | null },
    options: MusicBrainzLookupOptions = {},
): Promise<MusicBrainzLookupResult> {
    const artist = input.artist?.trim() ?? "";
    const title = input.title?.trim() ?? "";
    const album = input.album?.trim() ?? "";
    if (!artist && !title && !album) {
        return { artists: [], recordings: [] };
    }

    const fetcher = options.fetcher ?? fetch;
    const limit = options.limit ?? 5;
    const [artistResponse, recordingResponse] = await Promise.all([
        artist ? searchMusicBrainz("artist", `artist:${quoteQuery(artist)}`, limit, fetcher, options) : Promise.resolve(null),
        title ? searchMusicBrainz("recording", buildRecordingQuery({ artist, title, album }), limit, fetcher, options) : Promise.resolve(null),
    ]);

    return {
        artists: artistResponse ? mapArtists(artistResponse) : [],
        recordings: recordingResponse ? mapRecordings(recordingResponse) : [],
    };
}

export function buildRecordingQuery(input: { artist?: string; title: string; album?: string }): string {
    const clauses = [`recording:${quoteQuery(input.title)}`];
    if (input.artist) {
        clauses.push(`artist:${quoteQuery(input.artist)}`);
    }
    if (input.album) {
        clauses.push(`release:${quoteQuery(input.album)}`);
    }
    return clauses.join(" AND ");
}

async function searchMusicBrainz(entity: "artist" | "recording", query: string, limit: number, fetcher: typeof fetch, options: MusicBrainzLookupOptions): Promise<unknown> {
    const baseUrl = options.baseUrl ?? "https://musicbrainz.org/ws/2";
    const url = new URL(`${baseUrl.replace(/\/$/, "")}/${entity}`);
    url.searchParams.set("query", query);
    url.searchParams.set("fmt", "json");
    url.searchParams.set("limit", String(limit));

    const response = await fetcher(url, {
        headers: {
            "Accept": "application/json",
            "User-Agent": options.userAgent ?? "its-mytabs-batch-import-spike/0.0",
        },
    });
    if (!response.ok) {
        throw new Error(`MusicBrainz ${entity} lookup failed with HTTP ${response.status}`);
    }
    return await response.json();
}

function quoteQuery(value: string): string {
    return `"${value.replaceAll('"', '\\"')}"`;
}

function mapArtists(data: unknown): MusicBrainzArtistCandidate[] {
    if (!isRecord(data) || !Array.isArray(data.artists)) {
        return [];
    }
    return data.artists.filter(isRecord).map((artist) => ({
        id: readString(artist, "id"),
        name: readString(artist, "name"),
        disambiguation: readString(artist, "disambiguation"),
        country: readString(artist, "country"),
        score: readScore(artist),
    })).filter((artist) => artist.id && artist.name);
}

function mapRecordings(data: unknown): MusicBrainzRecordingCandidate[] {
    if (!isRecord(data) || !Array.isArray(data.recordings)) {
        return [];
    }
    return data.recordings.filter(isRecord).map((recording) => ({
        id: readString(recording, "id"),
        title: readString(recording, "title"),
        artist: readCredit(recording["artist-credit"]),
        releases: Array.isArray(recording.releases) ? recording.releases.filter(isRecord).map(mapRelease).filter((release) => release.id && release.title) : [],
        score: readScore(recording),
    })).filter((recording) => recording.id && recording.title);
}

function mapRelease(release: Record<string, unknown>): MusicBrainzReleaseCandidate {
    return {
        id: readString(release, "id"),
        title: readString(release, "title"),
        date: readString(release, "date"),
        score: readScore(release),
    };
}

function readCredit(value: unknown): string {
    if (!Array.isArray(value)) {
        return "";
    }
    return value.filter(isRecord).map((credit) => {
        if (typeof credit.name === "string") {
            return credit.name;
        }
        return isRecord(credit.artist) ? readString(credit.artist, "name") : "";
    }).filter(Boolean).join(", ");
}

function readScore(row: Record<string, unknown>): number {
    const value = row.score;
    if (typeof value === "number") {
        return value;
    }
    if (typeof value === "string") {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : 0;
    }
    return 0;
}

function readString(row: Record<string, unknown>, key: string): string {
    const value = row[key];
    return typeof value === "string" ? value : "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null;
}

export function chooseBestMusicBrainzRecording(
    candidates: MusicBrainzRecordingCandidate[],
    input: { artist?: string | null; title?: string | null; album?: string | null },
): MusicBrainzRecordingCandidate | null {
    const expectedArtist = normalizeLibraryText(input.artist ?? "");
    const expectedTitle = normalizeLibraryText(input.title ?? "");
    const expectedAlbum = normalizeLibraryText(input.album ?? "");
    const ranked = candidates.map((candidate) => ({
        candidate,
        rank: candidate.score + (normalizeLibraryText(candidate.title) === expectedTitle ? 25 : 0) + (normalizeLibraryText(candidate.artist).includes(expectedArtist) ? 15 : 0) +
            (expectedAlbum && candidate.releases.some((release) => normalizeLibraryText(release.title) === expectedAlbum) ? 10 : 0),
    })).sort((left, right) => right.rank - left.rank);
    return ranked[0]?.candidate ?? null;
}
