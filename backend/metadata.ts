import * as path from "@std/path";

export interface MetadataNormalizationResult {
    artist?: string;
    title?: string;
    album?: string;
    reasons: string[];
}

export interface FilenamePathInferenceResult {
    confidence: number;
    artist?: string;
    title?: string;
    album?: string;
    versionLabel?: string;
    pathShape: "letter-artist-file" | "letter-artist-album-file" | "artist-file" | "artist-album-file" | "filename-only" | "unknown";
    reasons: string[];
}

const artistAliasMap = new Map<string, string>([
    ["acdc", "AC/DC"],
    ["ac dc", "AC/DC"],
    ["ac-dc", "AC/DC"],
    ["ac/dc", "AC/DC"],
]);

const genericFolderNames = new Set([
    "album",
    "albums",
    "artist",
    "artists",
    "band",
    "bands",
    "collection",
    "collections",
    "discography",
    "download",
    "downloads",
    "favorite",
    "favorites",
    "guitar",
    "guitar pro",
    "guitar tabs",
    "misc",
    "miscellaneous",
    "music",
    "song",
    "songs",
    "tab",
    "tabs",
    "tablature",
    "tablatures",
    "unknown",
    "various",
    "various artists",
]);

const versionLabelPatterns: Array<{ pattern: RegExp; label: string }> = [
    { pattern: /\bintro\b/i, label: "intro" },
    { pattern: /\boutro\b/i, label: "outro" },
    { pattern: /\bsolo\b/i, label: "solo" },
    { pattern: /\bacoustic\b/i, label: "acoustic" },
    { pattern: /\blive\b/i, label: "live" },
    { pattern: /\bbass\b/i, label: "bass" },
    { pattern: /\bver(?:sion)?\.?\s*([0-9]+)\b/i, label: "version $1" },
    { pattern: /\bv(?:er)?\.?\s*([0-9]+)\b/i, label: "version $1" },
    { pattern: /\(([0-9]+)\)/, label: "version $1" },
];

export function normalizeMetadata(input: { artist?: string | null; title?: string | null; album?: string | null }): MetadataNormalizationResult {
    const reasons: string[] = [];
    const artist = normalizeArtist(input.artist, reasons);
    const title = normalizeTextField(input.title, "title", reasons);
    const album = normalizeTextField(input.album, "album", reasons);

    return {
        ...(artist ? { artist } : {}),
        ...(title ? { title } : {}),
        ...(album ? { album } : {}),
        reasons,
    };
}

export function inferMetadataFromPath(filePath: string): FilenamePathInferenceResult {
    const reasons: string[] = [];
    const normalizedPath = filePath.replace(/\\/g, "/");
    const parsed = path.parse(normalizedPath);
    const filenameTitle = parsed.name;
    const ext = parsed.ext;
    const rawSegments = normalizedPath.split("/").filter((segment) => segment.length > 0);
    const segments = rawSegments.length > 0 ? rawSegments : [filePath];
    const fileSegment = segments.at(-1) ?? filePath;
    const folderSegments = segments.slice(0, -1);

    let confidence = 0.2;
    let artist: string | undefined;
    let title: string | undefined;
    let album: string | undefined;
    let pathShape: FilenamePathInferenceResult["pathShape"] = "filename-only";

    const filenameParts = parseArtistTitleFromFilename(fileSegment);
    if (filenameParts) {
        artist = filenameParts.artist;
        title = filenameParts.title;
        confidence += 0.4;
        reasons.push('Parsed artist and title from filename pattern "Artist - Title".');
    } else {
        title = filenameTitle;
        confidence += 0.1;
        reasons.push("Used filename stem as title.");
    }

    const contentFolders = stripAlphabeticBucket(folderSegments, reasons);
    if (contentFolders.length >= 2) {
        const maybeAlbum = contentFolders.at(-1);
        const maybeArtist = contentFolders.at(-2);
        if (maybeArtist && !artist) {
            artist = maybeArtist;
            confidence += 0.25;
            reasons.push("Inferred artist from parent folder.");
        }
        if (maybeAlbum && !isGenericFolderName(maybeAlbum)) {
            album = maybeAlbum;
            confidence += 0.15;
            reasons.push("Inferred album from folder path.");
        } else if (maybeAlbum) {
            reasons.push(`Rejected generic folder "${maybeAlbum}" as album.`);
        }
        pathShape = folderSegments.length !== contentFolders.length ? "letter-artist-album-file" : "artist-album-file";
    } else if (contentFolders.length === 1) {
        if (!artist) {
            artist = contentFolders[0];
            confidence += 0.2;
            reasons.push("Inferred artist from parent folder.");
        }
        pathShape = folderSegments.length !== contentFolders.length ? "letter-artist-file" : "artist-file";
    } else if (folderSegments.length > 0) {
        pathShape = "unknown";
    }

    const version = extractVersionLabel(title ?? filenameTitle);
    if (version) {
        title = removeVersionLabel(title ?? filenameTitle, version.raw).trim();
        confidence += 0.05;
        reasons.push(`Extracted version label "${version.label}".`);
    }

    const normalized = normalizeMetadata({ artist, title, album });
    reasons.push(...normalized.reasons);

    return {
        confidence: clampConfidence(confidence),
        ...(normalized.artist ? { artist: normalized.artist } : {}),
        ...(normalized.title ? { title: normalized.title } : {}),
        ...(normalized.album ? { album: normalized.album } : {}),
        ...(version ? { versionLabel: version.label } : {}),
        pathShape,
        reasons: ext ? [...reasons, `Ignored file extension "${ext}".`] : reasons,
    };
}

export function isAlphabeticBucket(segment: string): boolean {
    return /^[a-z]$/i.test(segment.trim());
}

export function isGenericFolderName(segment: string): boolean {
    return genericFolderNames.has(normalizeComparable(segment));
}

function parseArtistTitleFromFilename(filename: string): { artist: string; title: string } | null {
    const stem = path.parse(filename).name;
    const match = stem.match(/^(.+?)\s+-\s+(.+)$/);
    if (!match) {
        return null;
    }
    const artist = cleanupText(match[1]);
    const title = cleanupText(match[2]);
    if (!artist || !title) {
        return null;
    }
    return { artist, title };
}

function stripAlphabeticBucket(segments: string[], reasons: string[]): string[] {
    if (segments.length >= 2 && isAlphabeticBucket(segments.at(-2) ?? "")) {
        reasons.push(`Ignored alphabetic bucket folder "${segments.at(-2)}".`);
        return [segments.at(-1)!];
    }
    if (segments.length >= 3 && isAlphabeticBucket(segments.at(-3) ?? "")) {
        reasons.push(`Ignored alphabetic bucket folder "${segments.at(-3)}".`);
        return segments.slice(-2);
    }
    return segments.slice(-2);
}

function normalizeArtist(value: string | null | undefined, reasons: string[]): string | undefined {
    const cleaned = normalizeTextField(value, "artist", reasons);
    if (!cleaned) {
        return undefined;
    }

    const alias = artistAliasMap.get(normalizeComparable(cleaned));
    if (alias) {
        if (alias !== cleaned) {
            reasons.push(`Normalized artist alias "${cleaned}" to "${alias}".`);
        }
        return alias;
    }

    const articleInverted = cleaned.match(/^(.+),\s*(the|a|an)$/i);
    if (articleInverted) {
        const normalized = `${titleCaseArticle(articleInverted[2])} ${articleInverted[1]}`;
        reasons.push(`Normalized inverted article artist "${cleaned}" to "${normalized}".`);
        return normalized;
    }

    const leadingArticle = cleaned.match(/^(the|a|an)\s+(.+)$/i);
    if (leadingArticle) {
        const normalized = leadingArticle[2];
        reasons.push(`Removed leading article from artist "${cleaned}".`);
        return normalized;
    }

    return cleaned;
}

function normalizeTextField(value: string | null | undefined, fieldName: string, reasons: string[]): string | undefined {
    if (value === null || value === undefined) {
        return undefined;
    }
    const cleaned = cleanupText(value);
    if (!cleaned) {
        return undefined;
    }
    if (cleaned !== value) {
        reasons.push(`Normalized whitespace in ${fieldName}.`);
    }
    return cleaned;
}

function cleanupText(value: string): string {
    return value.replace(/[_]+/g, " ").replace(/\s+/g, " ").trim();
}

function normalizeComparable(value: string): string {
    return cleanupText(value).toLowerCase().replace(/&/g, "and");
}

function titleCaseArticle(value: string): string {
    return value.slice(0, 1).toUpperCase() + value.slice(1).toLowerCase();
}

function extractVersionLabel(value: string): { label: string; raw: string } | null {
    for (const item of versionLabelPatterns) {
        const match = value.match(item.pattern);
        if (match) {
            return {
                label: item.label.replace("$1", match[1] ?? ""),
                raw: match[0],
            };
        }
    }
    return null;
}

function removeVersionLabel(value: string, raw: string): string {
    return value.replace(raw, "").replace(/\s+-\s*$/, "").replace(/\s+/g, " ").replace(/\(\s*\)/g, "").trim();
}

function clampConfidence(value: number): number {
    return Math.max(0, Math.min(1, Number(value.toFixed(2))));
}
