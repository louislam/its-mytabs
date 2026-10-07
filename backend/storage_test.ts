import { assertEquals, assertRejects, assertThrows } from "jsr:@std/assert@^1.0.17";
import * as fs from "@std/fs";
import * as path from "@std/path";

const tempDir = await Deno.makeTempDir();
Deno.env.set("DATA_DIR", tempDir);
Deno.env.set("MYTABS_PORT", "47780");

const {
    checkStorageIntegrity,
    cleanupAbandonedTempFiles,
    getLibraryTmpDir,
    hashReadableStream,
    resolveStoredPath,
    storeLibraryFile,
} = await import("./storage.ts");
const { upsertTabFile } = await import("./library.ts");
const { db, kv } = await import("./db.ts");

Deno.test("storeLibraryFile hashes stream data and stores content by hash", async () => {
    const data = new TextEncoder().encode("example tab content");
    const stored = await storeLibraryFile(new Blob([data]).stream(), ".gp");

    const expectedHash = await hashReadableStream(new Blob([data]).stream());
    assertEquals(stored.sha256, expectedHash.sha256);
    assertEquals(stored.byteSize, data.byteLength);
    assertEquals(stored.ext, "gp");
    assertEquals(stored.storedPath, `files/${stored.sha256.slice(0, 2)}/${stored.sha256}.gp`);
    assertEquals(await fs.exists(stored.absolutePath), true);
    assertEquals(await Deno.readFile(stored.absolutePath), data);

    const duplicate = await storeLibraryFile(data, "gp");
    assertEquals(duplicate.sha256, stored.sha256);
    assertEquals(duplicate.absolutePath, stored.absolutePath);
});

Deno.test("resolveStoredPath rejects traversal and absolute paths", () => {
    const storedPath = "files/aa/" + "a".repeat(64) + ".gp";
    assertEquals(resolveStoredPath(storedPath), path.join(tempDir, "library", storedPath));

    assertThrows(
        () => resolveStoredPath("../outside.gp"),
        Error,
        "Stored path escapes library storage",
    );
    assertThrows(
        () => resolveStoredPath("/tmp/outside.gp"),
        Error,
        "Invalid stored path",
    );
    assertThrows(
        () => resolveStoredPath("files\\aa\\bad.gp"),
        Error,
        "Invalid stored path",
    );
});

Deno.test("checkStorageIntegrity reports missing DB files and orphaned stored files", async () => {
    const stored = await storeLibraryFile(new TextEncoder().encode("tracked tab"), "gp");
    upsertTabFile({
        sha256: stored.sha256,
        byteSize: stored.byteSize,
        ext: stored.ext,
        storedPath: stored.storedPath,
    });

    const missingHash = "b".repeat(64);
    upsertTabFile({
        sha256: missingHash,
        byteSize: 10,
        ext: "gp",
        storedPath: `files/bb/${missingHash}.gp`,
    });

    const orphanPath = path.join(tempDir, "library", "files", "cc", `${"c".repeat(64)}.gp`);
    await fs.ensureDir(path.dirname(orphanPath));
    await Deno.writeTextFile(orphanPath, "orphan");

    const report = await checkStorageIntegrity();
    assertEquals(report.missingFiles.some((file) => file.sha256 === missingHash), true);
    assertEquals(report.orphanedFiles.some((file) => file.storedPath === `files/cc/${"c".repeat(64)}.gp`), true);
    assertEquals(report.orphanedFiles.some((file) => file.storedPath === stored.storedPath), false);
});

Deno.test("cleanupAbandonedTempFiles removes only old temp files", async () => {
    const tmpDir = getLibraryTmpDir();
    await fs.ensureDir(tmpDir);
    const oldTmp = path.join(tmpDir, "old.tmp");
    const newTmp = path.join(tmpDir, "new.tmp");
    await Deno.writeTextFile(oldTmp, "old");
    await Deno.writeTextFile(newTmp, "new");

    const oldDate = new Date(Date.now() - 48 * 60 * 60 * 1000);
    await Deno.utime(oldTmp, oldDate, oldDate);

    const result = await cleanupAbandonedTempFiles(24 * 60 * 60 * 1000);
    assertEquals(result.removed.includes(oldTmp), true);
    assertEquals(result.skipped.includes(newTmp), true);
    assertEquals(await fs.exists(oldTmp), false);
    assertEquals(await fs.exists(newTmp), true);
});

Deno.test("storeLibraryFile rejects unsafe extensions and cleans temp output", async () => {
    await assertRejects(
        () => storeLibraryFile(new Uint8Array([1]), "../gp"),
        Error,
        "Invalid file extension",
    );
    assertEquals(await fs.exists(getLibraryTmpDir()), true);
});

Deno.test.afterAll(async () => {
    kv.close();
    db.close();
    await fs.emptyDir(tempDir);
    await Deno.remove(tempDir);
});
