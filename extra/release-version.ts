import childProcess from "node:child_process";
import process from "node:process";
import * as jsonc from "@std/jsonc";
// @deno-types="npm:@types/semver@~7.7.0"
import semver from "npm:semver@~7.7.3";

// Release version helpers for .github/workflows/release.yml
// Usage:
//   deno run -A extra/release-version.ts validate 1.8.0
//   deno run -A extra/release-version.ts set 1.8.0
//   deno run -A extra/release-version.ts get

const denoJSONCPath = "deno.jsonc";

/**
 * Plain release semver only (1.8.0, not v1.8.0 or 1.8.0-rc.1)
 */
export function isValidVersion(version: string): boolean {
    return semver.valid(version) === version && semver.prerelease(version) === null;
}

/**
 * Compare two versions: -1 if a < b, 0 if equal, 1 if a > b
 */
export function compareVersion(a: string, b: string): number {
    if (!isValidVersion(a) || !isValidVersion(b)) {
        throw new Error(`Cannot compare invalid version: ${!isValidVersion(a) ? a : b}`);
    }
    return semver.compare(a, b);
}

/**
 * Highest version of a list, or null if the list has no valid version
 */
export function highestVersion(versions: string[]): string | null {
    const validVersions = versions.filter((version) => isValidVersion(version)).sort(semver.rcompare);
    return validVersions[0] ?? null;
}

/**
 * Throw if the next version is not a plain semver version or not greater than every known version
 */
export function validateVersion(next: string, knownVersions: string[]): string | null {
    if (!isValidVersion(next)) {
        throw new Error(`"${next}" is not a valid version. Expected MAJOR.MINOR.PATCH, e.g. 1.8.0`);
    }
    const previous = highestVersion(knownVersions);
    if (previous !== null && !semver.gt(next, previous)) {
        throw new Error(`Version ${next} must be greater than the previous version ${previous}`);
    }
    return previous;
}

export async function readVersion(file = denoJSONCPath): Promise<string> {
    const config = jsonc.parse(await Deno.readTextFile(file));
    const version = (config as { version?: unknown })?.version;
    if (typeof version !== "string") {
        throw new Error(`No version found in ${file}`);
    }
    return version;
}

/**
 * Rewrite the top-level version in deno.jsonc, keeping comments untouched
 */
export async function setVersion(version: string, file = denoJSONCPath): Promise<void> {
    if (!isValidVersion(version)) {
        throw new Error(`"${version}" is not a valid version. Expected MAJOR.MINOR.PATCH, e.g. 1.8.0`);
    }
    const text = await Deno.readTextFile(file);
    const updated = text.replace(/^(\s*"version"\s*:\s*")[^"]*(")/m, `$1${version}$2`);
    if (updated === text) {
        if (await readVersion(file) === version) {
            return;
        }
        throw new Error(`Could not find the version field in ${file}`);
    }
    await Deno.writeTextFile(file, updated);
}

/**
 * All git tags that look like a version
 */
export function gitVersions(): string[] {
    const output = childProcess.execFileSync("git", ["tag", "--list"], { encoding: "utf-8" });
    return output.split("\n").map((line) => line.trim()).filter((tag) => isValidVersion(tag));
}

export function gitTagExists(tag: string): boolean {
    const result = childProcess.spawnSync("git", ["rev-parse", "-q", "--verify", `refs/tags/${tag}`], { stdio: "ignore" });
    return result.status === 0;
}

if (import.meta.main) {
    const [command, arg] = process.argv.slice(2);
    try {
        if (command === "validate") {
            const current = await readVersion();
            const previous = validateVersion(arg, [...gitVersions(), current]);
            if (gitTagExists(arg)) {
                throw new Error(`Tag ${arg} already exists`);
            }
            console.log(`Version ${arg} is valid (previous: ${previous ?? "none"})`);
        } else if (command === "set") {
            await setVersion(arg);
            console.log(`Version set to ${arg}`);
        } else if (command === "get") {
            console.log(await readVersion());
        } else {
            console.error("Usage: deno run -A extra/release-version.ts <validate|set|get> [version]");
            process.exit(1);
        }
    } catch (error) {
        console.error(`error: ${error instanceof Error ? error.message : error}`);
        process.exit(1);
    }
}
