import childProcess from "node:child_process";
import process from "node:process";
import { appVersion } from "../backend/util.ts";

export const dryRun = process.env.RELEASE_DRY_RUN === "1";

if (import.meta.main) {
    // Check if docker is running
    checkDocker();

    console.log("Release version:", appVersion);

    buildImages(getRepoNames(), ["1", "latest", appVersion], "release");
}

export function buildImages(repoNames: string[], tags: string[], target: string, buildArgs = "", dockerfile = "Dockerfile", platform = "linux/amd64,linux/arm64") {
    let args = [
        "buildx",
        "build",
        "-f",
        dockerfile,
        "--platform",
        platform,
    ];

    for (let repoName of repoNames) {
        // Add tags
        for (let tag of tags) {
            args.push("-t", `${repoName}:${tag}`);
        }
    }

    args = [
        ...args,
        "--target",
        target,
    ];

    // Add build args
    if (buildArgs) {
        args.push("--build-arg", buildArgs);
    }

    args = [
        ...args,
        ".",
        "--push",
    ];

    if (!dryRun) {
        childProcess.spawnSync("docker", args, { stdio: "inherit" });
    } else {
        console.log(`[DRY RUN] docker ${args.join(" ")}`);
    }
}

/**
 * Get Docker Hub repository name
 */
export function getRepoNames() {
    if (process.env.RELEASE_REPO_NAMES) {
        // Split by comma
        return process.env.RELEASE_REPO_NAMES.split(",").map((name) => name.trim());
    }
    return [
        "louislam/its-mytabs",
        "ghcr.io/louislam/its-mytabs",
    ];
}

/**
 * Check if docker is running
 */
export function checkDocker(): void {
    try {
        childProcess.execSync("docker ps");
    } catch (error) {
        console.error("Docker is not running. Please start docker and try again.");
        process.exit(1);
    }
}
