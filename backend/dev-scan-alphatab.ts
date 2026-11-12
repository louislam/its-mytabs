import * as fs from "@std/fs";
import * as path from "@std/path";
import { parseAlphaTabFile } from "./alphatab-parser.ts";
import { classifyImportExtension } from "./import-policy.ts";

const defaultRoot = "/home/mateuszpsujek/SynologyDrive/taby";
const root = Deno.args[0] ?? defaultRoot;
const maxFiles = Number(Deno.args[1] ?? "50");

if (!import.meta.main) {
    throw new Error("This script is intended to be run directly.");
}

if (!await fs.exists(root)) {
    console.log(JSON.stringify({ root, available: false, message: "Sample root is not available." }, null, 2));
    Deno.exit(0);
}

const files: string[] = [];
for await (const entry of fs.walk(root, { includeDirs: false, followSymlinks: false })) {
    const policy = classifyImportExtension(entry.path);
    if (policy.supported) {
        files.push(entry.path);
    }
    if (files.length >= maxFiles) {
        break;
    }
}

const results = [];
for (const file of files) {
    const result = await parseAlphaTabFile(file);
    results.push({
        relativePath: path.relative(root, file),
        ...result,
    });
}

const successes = results.filter((result) => result.ok);
const failures = results.filter((result) => !result.ok);
const elapsedValues = results.map((result) => result.elapsedMs).sort((a, b) => a - b);

console.log(JSON.stringify(
    {
        root,
        available: true,
        sampled: results.length,
        successCount: successes.length,
        failureCount: failures.length,
        elapsedMs: {
            min: elapsedValues[0] ?? 0,
            median: elapsedValues[Math.floor(elapsedValues.length / 2)] ?? 0,
            max: elapsedValues.at(-1) ?? 0,
        },
        failures: failures.slice(0, 20),
    },
    null,
    2,
));
