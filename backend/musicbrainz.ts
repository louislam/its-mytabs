export interface MusicBrainzLookupOptions {
    baseUrl?: string;
    fetcher?: typeof fetch;
    userAgent?: string;
    limit?: number;
    timeoutMs?: number;
    rateLimitMs?: number;
    fallbackOnNoRecording?: boolean;
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
    status: string;
    primaryType: string;
    secondaryTypes: string[];
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

let requestQueue = Promise.resolve();
let lastRequestAt = 0;

export async function lookupMusicBrainzMetadata(
    input: { artist?: string | null; title?: string | null; album?: string | null },
    options: MusicBrainzLookupOptions = {},
): Promise<MusicBrainzLookupResult> {
    const artist = cleanLookupText(input.artist ?? "");
    const title = cleanLookupText(input.title ?? "");
    const album = cleanLookupText(input.album ?? "");
    if (!artist && !title && !album) {
        return { artists: [], recordings: [] };
    }

    const limit = options.limit ?? 5;
    const artistResponse = artist ? await searchMusicBrainz("artist", `artist:${quoteQuery(artist)}`, limit, options) : null;
    const recordingResponse = title ? await searchMusicBrainz("recording", buildRecordingQuery({ artist, title, album }), limit, options) : null;
    let recordings = recordingResponse ? mapRecordings(recordingResponse) : [];
    if (options.fallbackOnNoRecording && title && recordings.length === 0 && album) {
        const fallbackRecordingResponse = await searchMusicBrainz("recording", buildRecordingQuery({ artist, title }), limit, options);
        recordings = mapRecordings(fallbackRecordingResponse);
    }
    if (options.fallbackOnNoRecording && title && recordings.length === 0 && artist) {
        const fallbackRecordingResponse = await searchMusicBrainz("recording", buildRecordingQuery({ title }), limit, options);
        recordings = mapRecordings(fallbackRecordingResponse);
    }

    return {
        artists: artistResponse ? mapArtists(artistResponse) : [],
        recordings,
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

async function searchMusicBrainz(entity: "artist" | "recording", query: string, limit: number, options: MusicBrainzLookupOptions): Promise<unknown> {
    const baseUrl = options.baseUrl ?? "https://musicbrainz.org/ws/2";
    const fetcher = options.fetcher ?? fetch;
    const userAgent = options.userAgent ?? "its-mytabs/unknown (contact unavailable)";
    if (userAgent.includes("spike/0.0") || userAgent.includes("Placeholder") || userAgent.includes("contact unavailable")) {
        throw new Error("MusicBrainz user agent must identify this application and a contact.");
    }
    const url = new URL(`${baseUrl.replace(/\/$/, "")}/${entity}`);
    url.searchParams.set("query", query);
    url.searchParams.set("fmt", "json");
    url.searchParams.set("limit", String(limit));

    await waitForMusicBrainzSlot(options);
    const response = await fetcher(url, {
        signal: AbortSignal.timeout(options.timeoutMs ?? 10_000),
        headers: {
            "Accept": "application/json",
            "User-Agent": userAgent,
        },
    });
    if (!response.ok) {
        throw new Error(`MusicBrainz ${entity} lookup failed with HTTP ${response.status}`);
    }
    return await response.json();
}

async function waitForMusicBrainzSlot(options: MusicBrainzLookupOptions): Promise<void> {
    const rateLimitMs = options.rateLimitMs ?? (options.fetcher ? 0 : 1100);
    if (rateLimitMs <= 0) {
        return;
    }

    const wait = requestQueue.then(async () => {
        const delayMs = Math.max(0, lastRequestAt + rateLimitMs - Date.now());
        if (delayMs > 0) {
            await new Promise((resolve) => setTimeout(resolve, delayMs));
        }
        lastRequestAt = Date.now();
    });
    requestQueue = wait.catch(() => {});
    await wait;
}

function quoteQuery(value: string): string {
    return `"${value.replaceAll('"', '\\"')}"`;
}

function cleanLookupText(value: string): string {
    return value
        .trim()
        .replaceAll("_", " ")
        .replace(/\s+/g, " ")
        .replace(/^[!"#$%&()*+,./:;<=>?@[\\\]^_`{|}~\s-]+|[!"#$%&()*+,./:;<=>?@[\\\]^_`{|}~\s-]+$/g, "");
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
    const releaseGroup = isRecord(release["release-group"]) ? release["release-group"] : {};
    return {
        id: readString(release, "id"),
        title: readString(release, "title"),
        date: readString(release, "date"),
        status: readString(release, "status"),
        primaryType: readString(releaseGroup, "primary-type"),
        secondaryTypes: Array.isArray(releaseGroup["secondary-types"]) ? releaseGroup["secondary-types"].filter((value): value is string => typeof value === "string") : [],
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

export function chooseBestMusicBrainzRelease(
    recording: MusicBrainzRecordingCandidate | null | undefined,
    input: { album?: string | null } = {},
): MusicBrainzReleaseCandidate | null {
    if (!recording || recording.releases.length === 0) {
        return null;
    }

    const expectedAlbum = normalizeLibraryText(input.album ?? "");
    const ranked = recording.releases.map((release, index) => ({
        release,
        rank: release.score + releaseQualityScore(release, expectedAlbum) - (index * 0.01),
    })).sort((left, right) => right.rank - left.rank);
    return ranked[0]?.release ?? null;
}

function releaseQualityScore(release: MusicBrainzReleaseCandidate, expectedAlbum: string): number {
    const title = normalizeLibraryText(release.title);
    const secondaryTypes = release.secondaryTypes.map(normalizeLibraryText);
    let score = 0;
    if (expectedAlbum && title === expectedAlbum) {
        score += 120;
    }
    if (normalizeLibraryText(release.status) === "official") {
        score += 20;
    }
    if (normalizeLibraryText(release.primaryType) === "album") {
        score += 30;
    } else if (normalizeLibraryText(release.primaryType) === "single" || normalizeLibraryText(release.primaryType) === "ep") {
        score += 8;
    }
    if (secondaryTypes.includes("live")) {
        score += 5;
    }
    if (secondaryTypes.includes("compilation")) {
        score -= 10;
    }
    if (secondaryTypes.includes("demo")) {
        score -= 30;
    }
    if (secondaryTypes.includes("bootleg")) {
        score -= 45;
    }
    if (/^\d{4}([-\s:]|$)/.test(title) || /^\d{4}-\d{2}-\d{2}/.test(title)) {
        score -= 35;
    }
    if (/\b(demo|demos|bootleg|outtake|rehearsal|session|sessions|soundboard|audience|studio)\b/.test(title)) {
        score -= 25;
    }
    score -= Math.min(25, Math.max(0, release.title.length - 32) * 0.35);
    return score;
}

function normalizeLibraryText(value: string): string {
    return cleanLookupText(value).toLowerCase().replace(/\s+/g, " ");
}
