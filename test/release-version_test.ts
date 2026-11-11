import { assertEquals, assertRejects, assertThrows } from "jsr:@std/assert@^1.0.17";
import { compareVersion, highestVersion, isValidVersion, readVersion, setVersion, validateVersion } from "../extra/release-version.ts";

Deno.test("isValidVersion accepts plain semver only", () => {
    assertEquals(isValidVersion("1.8.0"), true);
    assertEquals(isValidVersion("10.20.30"), true);
    assertEquals(isValidVersion("1.8"), false);
    assertEquals(isValidVersion("v1.8.0"), false);
    assertEquals(isValidVersion("1.8.0-beta.1"), false);
    assertEquals(isValidVersion("1.8.0.1"), false);
    assertEquals(isValidVersion(""), false);
});

Deno.test("compareVersion orders by numeric parts", () => {
    assertEquals(compareVersion("1.8.0", "1.8.0"), 0);
    assertEquals(compareVersion("1.8.0", "1.7.9"), 1);
    assertEquals(compareVersion("1.7.9", "1.8.0"), -1);
    assertEquals(compareVersion("1.10.0", "1.9.9"), 1);
    assertEquals(compareVersion("2.0.0", "1.99.99"), 1);
    assertEquals(compareVersion("1.9.0", "1.10.0"), -1);
});

Deno.test("compareVersion rejects invalid versions", () => {
    assertThrows(() => compareVersion("1.8", "1.8.0"));
});

Deno.test("highestVersion ignores invalid versions", () => {
    assertEquals(highestVersion([]), null);
    assertEquals(highestVersion(["1.6.2", "1.7.0", "nightly", "1.10.0"]), "1.10.0");
});

Deno.test("validateVersion rejects older, equal and invalid versions", () => {
    assertThrows(() => validateVersion("1.6.0", ["1.7.0"]), Error, "must be greater than the previous version 1.7.0");
    assertThrows(() => validateVersion("1.7.0", ["1.7.0"]), Error, "must be greater than");
    assertThrows(() => validateVersion("v1.8.0", ["1.7.0"]), Error, "not a valid version");
    assertThrows(() => validateVersion("1.8", ["1.7.0"]), Error, "not a valid version");
});

Deno.test("validateVersion accepts a newer version", () => {
    assertEquals(validateVersion("1.8.0", ["1.6.2", "1.7.0"]), "1.7.0");
    assertEquals(validateVersion("1.8.0", []), null);
});

Deno.test("setVersion rewrites only the version field and keeps comments", async () => {
    const dir = await Deno.makeTempDir();
    try {
        const file = `${dir}/deno.jsonc`;
        await Deno.writeTextFile(file, `{\n    // app version\n    "version": "1.7.0",\n\n    "tasks": {}\n}\n`);
        await setVersion("1.8.0", file);
        assertEquals(await readVersion(file), "1.8.0");
        assertEquals(await Deno.readTextFile(file), `{\n    // app version\n    "version": "1.8.0",\n\n    "tasks": {}\n}\n`);
    } finally {
        await Deno.remove(dir, { recursive: true });
    }
});

Deno.test("setVersion rejects invalid versions", async () => {
    const dir = await Deno.makeTempDir();
    try {
        const file = `${dir}/deno.jsonc`;
        await Deno.writeTextFile(file, `{"version": "1.7.0"}`);
        await assertRejects(() => setVersion("1.8", file));
        assertEquals(await readVersion(file), "1.7.0");
    } finally {
        await Deno.remove(dir, { recursive: true });
    }
});
