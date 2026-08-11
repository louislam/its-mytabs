import childProcess from "node:child_process";

buildWindows();

export function buildWindows() {
    try {
        childProcess.spawnSync("deno", [
            "compile",
            "--include",
            "./dist",
            "--include",
            "./deno.jsonc",
            "--include",
            "./extra",
            // this worker in a worker thread. Deno compile only embeds statically-imported modules, so the worker must be included explicitly.
            "--include",
            "./backend/separate_worker.ts",
            //  "--no-check",
            "--allow-all",
            "--output",
            "its-mytabs.exe",
            "--node-modules-dir=none",
            "--target",
            "x86_64-pc-windows-msvc",
            "--icon",
            "./frontend/public/favicon.ico",
            "./backend/main.ts",
        ], {
            stdio: "inherit",
        });
    } catch (error) {
        console.error("Error while building the backend", error);
    }
}
