// "deno task test" to run this test

import { assertEquals, assertExists, assertThrows, assertRejects } from "jsr:@std/assert@^1.0.17";
import * as fs from "@std/fs";

// Set up temporary directory for tests
const tempDir = await Deno.makeTempDir();
Deno.env.set("DATA_DIR", tempDir);

// Now import after setting env
const { tabExists, getConfigJSON, createTab, getTab, deleteTab } = await import("./tab.ts");
const { db, kv } = await import("./db.ts");

Deno.test("tabExists - non-existent tab", async () => {
    console.log("Running test: tabExists - non-existent tab");
    const exists = await tabExists("nonexistent");
    assertEquals(exists, false);
});

Deno.test("createTab and getTab", async () => {
    const tabData = new Uint8Array([1, 2, 3]);
    const id = await createTab(tabData, "gp", "Test Title", "Test Artist", "test.gp");

    const tab = await getTab(id.toString());
    assertExists(tab);
    assertEquals(tab.title, "Test Title");
    assertEquals(tab.artist, "Test Artist");
    assertEquals(tab.filename, "tab.gp");
    assertEquals(tab.originalFilename, "test.gp");
});

Deno.test("getTab - path traversal protection", async () => {
    assertRejects(async () => {
        await getTab("../invalid");
    }, Error, "Invalid filename");

    assertRejects(async () => {
        await getTab("invalid/../name");
    }, Error, "Invalid filename");
});

Deno.test("tabExists - existing tab", async () => {
    const tabData = new Uint8Array([4, 5, 6]);
    const id = await createTab(tabData, "gpx", "Another Title", "Another Artist", "another.gpx");

    const exists = await tabExists(id);
    assertEquals(exists, true);
});

Deno.test("getConfigJSON - existing tab", async () => {
    const tabData = new Uint8Array([7, 8, 9]);
    const id = await createTab(tabData, "gp", "Config Test", "Config Artist", "config.gp");

    const config = await getConfigJSON(id);
    assertExists(config);
    assertEquals(config!.tab.title, "Config Test");
    assertEquals(config!.audio.length, 0);
    assertEquals(config!.youtube.length, 0);
});

Deno.test("deleteTab", async () => {
    const tabData = new Uint8Array([10, 11, 12]);
    const id = await createTab(tabData, "gp", "Delete Test", "Delete Artist", "delete.gp");

    // Verify it exists
    let exists = await tabExists(id.toString());
    assertEquals(exists, true);

    // Delete it
    await deleteTab(id.toString());

    // Verify it no longer exists
    exists = await tabExists(id.toString());
    assertEquals(exists, false);
});

// Clean up
Deno.test.afterAll(async () => {
    // close db
    kv.close();
    db.close();
    await fs.emptyDir(tempDir);
    await Deno.remove(tempDir);
});
