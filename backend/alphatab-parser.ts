import * as path from "@std/path";
import { classifyImportExtension } from "./import-policy.ts";

export interface AlphaTabParseSummary {
    title?: string;
    artist?: string;
    album?: string;
    trackCount: number;
    masterBarCount: number;
}

export interface AlphaTabParseError {
    category: "unsupported-extension" | "unsupported-format" | "file-too-large" | "parser-error" | "io-error";
    name: string;
    message: string;
}

export type AlphaTabParseResult = {
    ok: true;
    filename: string;
    extension: string;
    elapsedMs: number;
    summary: AlphaTabParseSummary;
} | {
    ok: false;
    filename: string;
    extension: string;
    elapsedMs: number;
    error: AlphaTabParseError;
};

interface ScoreLike {
    title?: string;
    artist?: string;
    album?: string;
    tracks?: unknown[];
    masterBars?: unknown[];
}

interface AlphaTabModule {
    Logger: {
        logLevel: unknown;
    };
    LogLevel: {
        None: unknown;
    };
    importer: {
        ScoreLoader: {
            loadScoreFromBytes(data: Uint8Array, settings?: unknown): unknown;
        };
        UnsupportedFormatError: new (...args: never[]) => Error;
    };
    Settings: new () => unknown;
}

let alphaTabModulePromise: Promise<AlphaTabModule> | undefined;

export async function parseAlphaTabFile(filePath: string): Promise<AlphaTabParseResult> {
    const startedAt = performance.now();
    const filename = path.basename(filePath);
    const extensionPolicy = classifyImportExtension(filename);

    if (!extensionPolicy.supported) {
        return {
            ok: false,
            filename,
            extension: extensionPolicy.extension,
            elapsedMs: elapsedSince(startedAt),
            error: {
                category: "unsupported-extension",
                name: "UnsupportedImportExtension",
                message: extensionPolicy.reason,
            },
        };
    }

    try {
        const stat = await Deno.stat(filePath);
        const maxBytes = maxParseBytes();
        if (stat.size > maxBytes) {
            throw new AlphaTabFileTooLargeError(stat.size, maxBytes);
        }
        const data = await Deno.readFile(filePath);
        return await parseAlphaTabBytes(data, filename, startedAt);
    } catch (error) {
        return {
            ok: false,
            filename,
            extension: extensionPolicy.extension,
            elapsedMs: elapsedSince(startedAt),
            error: toStructuredAlphaTabError(error, undefined, "io-error"),
        };
    }
}

export async function parseAlphaTabBytes(data: Uint8Array, filename: string, startedAt = performance.now()): Promise<AlphaTabParseResult> {
    const extensionPolicy = classifyImportExtension(filename);
    if (!extensionPolicy.supported) {
        return {
            ok: false,
            filename: path.basename(filename),
            extension: extensionPolicy.extension,
            elapsedMs: elapsedSince(startedAt),
            error: {
                category: "unsupported-extension",
                name: "UnsupportedImportExtension",
                message: extensionPolicy.reason,
            },
        };
    }

    try {
        const maxBytes = maxParseBytes();
        if (data.byteLength > maxBytes) {
            throw new AlphaTabFileTooLargeError(data.byteLength, maxBytes);
        }
        const alphaTab = await loadAlphaTab();
        const score = alphaTab.importer.ScoreLoader.loadScoreFromBytes(data, new alphaTab.Settings()) as ScoreLike;
        return {
            ok: true,
            filename: path.basename(filename),
            extension: extensionPolicy.extension,
            elapsedMs: elapsedSince(startedAt),
            summary: summarizeScore(score),
        };
    } catch (error) {
        return {
            ok: false,
            filename: path.basename(filename),
            extension: extensionPolicy.extension,
            elapsedMs: elapsedSince(startedAt),
            error: toStructuredAlphaTabError(error, await getLoadedAlphaTabModule()),
        };
    }
}

function maxParseBytes(): number {
    const configured = Number(Deno.env.get("MYTABS_MAX_PARSE_BYTES") ?? 20 * 1024 * 1024);
    return Number.isFinite(configured) && configured > 0 ? configured : 20 * 1024 * 1024;
}

class AlphaTabFileTooLargeError extends Error {
    constructor(size: number, maxBytes: number) {
        super(`File is too large to parse (${size} bytes, max ${maxBytes} bytes).`);
        this.name = "AlphaTabFileTooLargeError";
    }
}

async function loadAlphaTab(): Promise<AlphaTabModule> {
    installAlphaTabDenoGlobals();
    alphaTabModulePromise ??= import("@coderline/alphatab") as Promise<AlphaTabModule>;
    const alphaTab = await alphaTabModulePromise;
    alphaTab.Logger.logLevel = alphaTab.LogLevel.None;
    return alphaTab;
}

async function getLoadedAlphaTabModule(): Promise<AlphaTabModule | undefined> {
    try {
        return alphaTabModulePromise ? await alphaTabModulePromise : undefined;
    } catch {
        return undefined;
    }
}

function installAlphaTabDenoGlobals(): void {
    class AlphaTabPlaceholderElement {}
    class AlphaTabPlaceholderDocument {}
    class AlphaTabPlaceholderDocumentFragment {}

    const global = globalThis as unknown as {
        window?: { devicePixelRatio?: number };
        Element?: typeof AlphaTabPlaceholderElement;
        Document?: typeof AlphaTabPlaceholderDocument;
        DocumentFragment?: typeof AlphaTabPlaceholderDocumentFragment;
    };
    global.window ??= {};
    global.window.devicePixelRatio ??= 1;
    global.Element ??= AlphaTabPlaceholderElement;
    global.Document ??= AlphaTabPlaceholderDocument;
    global.DocumentFragment ??= AlphaTabPlaceholderDocumentFragment;
}

function summarizeScore(score: ScoreLike): AlphaTabParseSummary {
    return {
        ...(cleanScoreText(score.title) ? { title: cleanScoreText(score.title) } : {}),
        ...(cleanScoreText(score.artist) ? { artist: cleanScoreText(score.artist) } : {}),
        ...(cleanScoreText(score.album) ? { album: cleanScoreText(score.album) } : {}),
        trackCount: Array.isArray(score.tracks) ? score.tracks.length : 0,
        masterBarCount: Array.isArray(score.masterBars) ? score.masterBars.length : 0,
    };
}

function cleanScoreText(value: string | undefined): string | undefined {
    const trimmed = value?.trim();
    return trimmed ? trimmed : undefined;
}

function toStructuredAlphaTabError(error: unknown, alphaTab?: AlphaTabModule, fallbackCategory: AlphaTabParseError["category"] = "parser-error"): AlphaTabParseError {
    if (error instanceof AlphaTabFileTooLargeError) {
        return {
            category: "file-too-large",
            name: error.name,
            message: safeErrorMessage(error),
        };
    }
    if (alphaTab && error instanceof alphaTab.importer.UnsupportedFormatError) {
        return {
            category: "unsupported-format",
            name: error.name || "UnsupportedFormatError",
            message: safeErrorMessage(error),
        };
    }
    if (error instanceof Error) {
        return {
            category: fallbackCategory,
            name: error.name || "Error",
            message: safeErrorMessage(error),
        };
    }
    return {
        category: fallbackCategory,
        name: "NonErrorThrow",
        message: String(error),
    };
}

function safeErrorMessage(error: Error): string {
    return error.message || error.name || "Unknown alphaTab parser error.";
}

function elapsedSince(startedAt: number): number {
    return Number((performance.now() - startedAt).toFixed(2));
}
