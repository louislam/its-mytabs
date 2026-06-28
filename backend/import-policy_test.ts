import { assert, assertEquals } from "jsr:@std/assert@^1.0.17";
import * as path from "@std/path";
import { checkImportPathAllowed, classifyImportExtension, createImportFileReport, getSupportedImportExtensions, loadImportRootPolicy } from "./import-policy.ts";

Deno.test("classifyImportExtension reuses supported format list and rejects gtp", () => {
    assertEquals(getSupportedImportExtensions(), ["gp", "gpx", "gp3", "gp4", "gp5", "musicxml", "capx"]);
    assertEquals(classifyImportExtension("song.GP5").supported, true);

    const gtp = classifyImportExtension("song.gtp");
    assertEquals(gtp.supported, false);
    assertEquals(gtp.reason, ".gtp is not supported by the current import policy.");

    const report = createImportFileReport("/private/path/song.txt");
    assertEquals(report.path, "song.txt");
    assertEquals(report.supported, false);
});

Deno.test("loadImportRootPolicy resolves real roots and allows paths under them", async () => {
    const root = await Deno.makeTempDir();
    const childDir = path.join(root, "tabs");
    await Deno.mkdir(childDir);
    const file = path.join(childDir, "song.gp");
    await Deno.writeTextFile(file, "not a real tab");

    try {
        const policy = await loadImportRootPolicy({ envValue: root, demoMode: false });
        assertEquals(policy.enabled, true);
        assertEquals(policy.errors, []);
        assertEquals(policy.roots.length, 1);

        const check = await checkImportPathAllowed(file, policy);
        assertEquals(check.ok, true);
        assertEquals(check.realPath, await Deno.realPath(file));
    } finally {
        await Deno.remove(root, { recursive: true });
    }
});

Deno.test("checkImportPathAllowed rejects outside roots without listing filesystem contents", async () => {
    const root = await Deno.makeTempDir();
    const outside = await Deno.makeTempFile();

    try {
        const policy = await loadImportRootPolicy({ envValue: root, demoMode: false });
        const check = await checkImportPathAllowed(outside, policy);

        assertEquals(check.ok, false);
        assertEquals(check.reason, "outside-import-roots");
        assertEquals(check.message, "Import path is outside the configured import roots.");
        assert(!check.message?.includes(path.dirname(outside)));
    } finally {
        await Deno.remove(root, { recursive: true });
        await Deno.remove(outside);
    }
});

Deno.test("loadImportRootPolicy disables server import in demo mode", async () => {
    const root = await Deno.makeTempDir();

    try {
        const policy = await loadImportRootPolicy({ envValue: root, demoMode: true });
        const check = await checkImportPathAllowed(root, policy);

        assertEquals(policy.enabled, false);
        assertEquals(check.ok, false);
        assertEquals(check.reason, "demo-mode");
    } finally {
        await Deno.remove(root, { recursive: true });
    }
});
