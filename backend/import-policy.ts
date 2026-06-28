import * as fs from "@std/fs";
import * as path from "@std/path";
import { supportedFormatList } from "./common.ts";

export interface ImportRootPolicy {
    enabled: boolean;
    roots: string[];
    errors: string[];
}

export interface ImportPathCheck {
    ok: boolean;
    realPath?: string;
    reason?: "demo-mode" | "no-import-roots" | "outside-import-roots" | "path-not-found";
    message?: string;
}

export interface ImportExtensionPolicy {
    extension: string;
    supported: boolean;
    reason: string;
}

export interface ImportFileReport {
    path: string;
    extension: string;
    supported: boolean;
    reason: string;
}

export function getSupportedImportExtensions(): string[] {
    return [...supportedFormatList];
}

export function getSupportedImportExtensionList(): string {
    return supportedFormatList.map((ext) => `.${ext}`).join(", ");
}

export function classifyImportExtension(filename: string): ImportExtensionPolicy {
    const extension = path.extname(filename).slice(1).toLowerCase();
    if (!extension) {
        return {
            extension: "",
            supported: false,
            reason: "File has no extension.",
        };
    }
    if (supportedFormatList.includes(extension)) {
        return {
            extension,
            supported: true,
            reason: "Supported import format.",
        };
    }
    if (extension === "gtp") {
        return {
            extension,
            supported: false,
            reason: ".gtp is not supported by the current import policy.",
        };
    }
    return {
        extension,
        supported: false,
        reason: `Unsupported import format ".${extension}".`,
    };
}

export function createImportFileReport(filePath: string): ImportFileReport {
    const policy = classifyImportExtension(filePath);
    return {
        path: path.basename(filePath),
        extension: policy.extension,
        supported: policy.supported,
        reason: policy.reason,
    };
}

export async function loadImportRootPolicy(options: { envValue?: string | null; demoMode?: boolean } = {}): Promise<ImportRootPolicy> {
    const demoMode = options.demoMode ?? Deno.env.get("MYTABS_DEMO_MODE") === "true";
    if (demoMode) {
        return {
            enabled: false,
            roots: [],
            errors: ["Server-side import is disabled in demo mode."],
        };
    }

    const envValue = options.envValue ?? Deno.env.get("MYTABS_IMPORT_ROOTS");
    if (!envValue || !envValue.trim()) {
        return {
            enabled: false,
            roots: [],
            errors: [],
        };
    }

    const roots: string[] = [];
    const errors: string[] = [];
    for (const rawRoot of envValue.split(path.DELIMITER)) {
        const root = rawRoot.trim();
        if (!root) {
            continue;
        }
        try {
            const realRoot = await Deno.realPath(root);
            const stat = await Deno.stat(realRoot);
            if (!stat.isDirectory) {
                errors.push("Configured import root is not a directory.");
                continue;
            }
            if (!roots.includes(realRoot)) {
                roots.push(realRoot);
            }
        } catch {
            errors.push("Configured import root is not accessible.");
        }
    }

    return {
        enabled: roots.length > 0,
        roots,
        errors,
    };
}

export async function checkImportPathAllowed(inputPath: string, policy: ImportRootPolicy): Promise<ImportPathCheck> {
    if (!policy.enabled && policy.errors.some((error) => error.includes("demo mode"))) {
        return {
            ok: false,
            reason: "demo-mode",
            message: "Server-side import is disabled.",
        };
    }
    if (!policy.enabled || policy.roots.length === 0) {
        return {
            ok: false,
            reason: "no-import-roots",
            message: "Server-side import is not configured.",
        };
    }

    if (!await fs.exists(inputPath)) {
        return {
            ok: false,
            reason: "path-not-found",
            message: "Import path is not accessible.",
        };
    }

    const realPath = await Deno.realPath(inputPath);
    if (policy.roots.some((root) => isWithinRoot(realPath, root))) {
        return {
            ok: true,
            realPath,
        };
    }

    return {
        ok: false,
        reason: "outside-import-roots",
        message: "Import path is outside the configured import roots.",
    };
}

function isWithinRoot(candidate: string, root: string): boolean {
    const relative = path.relative(root, candidate);
    return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}
