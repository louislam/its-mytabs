import childProcess from "node:child_process";
import process from "node:process";
import * as jsonc from "@std/jsonc";
// @deno-types="npm:@types/semver@~7.7.0"
import semver from "npm:semver@~7.7.3";
import JSZip from "npm:jszip@~3.10.1";

// Standalone release script, also used by .github/workflows/release.yml
//
//   deno run -A extra/release.ts 1.8.0                 # check + windows + docker + publish
//   deno run -A extra/release.ts 1.8.0 --check         # validate the version only
//   deno run -A extra/release.ts 1.8.0 --windows       # build the Windows zip
//   deno run -A extra/release.ts 1.8.0 --docker        # build and push the Docker image
//   deno run -A extra/release.ts 1.8.0 --publish       # bump, tag, push and create the GitHub release

const denoJSONCPath = "deno.jsonc";
const exePath = "its-mytabs.exe";

export const releaseSteps = ["check", "windows", "docker", "publish"] as const;
export type ReleaseStep = (typeof releaseSteps)[number];

export function zipPath(version: string): string {
    return `its-mytabs-v${version}-windows.zip`;
}

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

export function gitOutput(...args: string[]): string {
    return childProcess.execFileSync("git", args, { encoding: "utf-8" }).trim();
}

export function run(command: string, args: string[]): void {
    console.log(`> ${command} ${args.join(" ")}`);
    const result = childProcess.spawnSync(command, args, { stdio: "inherit" });
    if (result.status !== 0) {
        throw new Error(`Command failed (${result.status}): ${command} ${args.join(" ")}`);
    }
}

export async function checkStep(version: string): Promise<void> {
    const current = await readVersion();
    const previous = validateVersion(version, [...gitVersions(), current]);
    if (gitTagExists(version)) {
        throw new Error(`Tag ${version} already exists`);
    }
    console.log(`Version ${version} is valid (previous: ${previous ?? "none"})`);
}

export async function windowsStep(version: string): Promise<string> {
    await setVersion(version);
    run("deno", ["task", "install-deps"]);
    run("deno", ["task", "build-binary"]);

    const zip = new JSZip();
    zip.file(exePath, await Deno.readFile(exePath));
    const data = await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
    await Deno.writeFile(zipPath(version), data);
    console.log(`Created ${zipPath(version)}`);
    return zipPath(version);
}

export async function dockerStep(version: string): Promise<void> {
    await setVersion(version);
    run("deno", ["task", "install-deps"]);
    run("deno", ["task", "build-frontend"]);

    const repoNames = (Deno.env.get("RELEASE_REPO_NAMES") ?? "louislam/its-mytabs,ghcr.io/louislam/its-mytabs")
        .split(",")
        .map((name) => name.trim())
        .filter(Boolean);
    const dockerHubNames = repoNames.filter((name) => !name.startsWith("ghcr.io/"));
    const ghcrNames = repoNames.filter((name) => name.startsWith("ghcr.io/"));

    // Docker Hub is the published image, its failure must fail the release
    if (dockerHubNames.length > 0) {
        pushImages(dockerHubNames);
    }

    // GHCR needs the package linked to the repo, or a PAT in GHCR_TOKEN
    for (const name of ghcrNames) {
        try {
            pushImages([name]);
        } catch (error) {
            console.warn(`::warning::Skipped ${name}: ${error instanceof Error ? error.message : error}`);
        }
    }
}

/**
 * build-docker.ts tags 1, latest and the version from deno.jsonc
 */
function pushImages(repoNames: string[]): void {
    const result = childProcess.spawnSync("deno", ["run", "--allow-all", "./extra/build-docker.ts"], {
        stdio: "inherit",
        env: { ...process.env, RELEASE_REPO_NAMES: repoNames.join(",") },
    });
    if (result.status !== 0) {
        throw new Error(`Docker build failed for ${repoNames.join(",")}`);
    }
}

export async function publishStep(version: string): Promise<void> {
    const branch = gitOutput("rev-parse", "--abbrev-ref", "HEAD");
    if (branch === "HEAD") {
        throw new Error("Cannot publish from a detached HEAD, check out a branch first");
    }
    if (await readVersion() !== version) {
        await setVersion(version);
    }
    if (gitOutput("status", "--porcelain", "--", denoJSONCPath) !== "") {
        run("git", ["commit", "-m", `Update to ${version}`, "--", denoJSONCPath]);
    }
    if (!gitTagExists(version)) {
        run("git", ["tag", version]);
    }
    run("git", ["push", "origin", `HEAD:${branch}`]);
    run("git", ["push", "origin", `refs/tags/${version}`]);

    const releasePath = zipPath(version);
    if (!(await Deno.stat(releasePath).catch(() => null))) {
        throw new Error(`${releasePath} not found, run the windows step first`);
    }
    run("gh", ["release", "create", version, "--title", version, "--verify-tag", "--generate-notes", releasePath]);
}

if (import.meta.main) {
    try {
        const args = process.argv.slice(2);
        const version = args.find((arg) => !arg.startsWith("--"));
        const selected = args.filter((arg) => arg.startsWith("--")).map((arg) => arg.slice(2));

        if (!version) {
            console.error("Usage: deno run -A extra/release.ts <version> [--check] [--windows] [--docker] [--publish]");
            process.exit(1);
        }

        const unknownStep = selected.find((step) => !releaseSteps.includes(step as ReleaseStep));
        if (unknownStep) {
            throw new Error(`Unknown step --${unknownStep}, expected one of: ${releaseSteps.join(", ")}`);
        }
        const steps = (selected.length > 0 ? selected : releaseSteps) as ReleaseStep[];

        for (const step of releaseSteps) {
            if (!steps.includes(step)) {
                continue;
            }
            if (step === "check") {
                await checkStep(version);
            } else if (step === "windows") {
                await windowsStep(version);
            } else if (step === "docker") {
                await dockerStep(version);
            } else if (step === "publish") {
                await publishStep(version);
            }
        }
    } catch (error) {
        console.error(`error: ${error instanceof Error ? error.message : error}`);
        process.exit(1);
    }
}
