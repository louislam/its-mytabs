// "deno task test" to run this test

import { assertEquals, assertExists, assertRejects, assertThrows } from "jsr:@std/assert@^1.0.17";
import * as fs from "@std/fs";
import * as path from "@std/path";

async function setupTest() {
    // Set up temporary directory for tests
    const tempDir = await Deno.makeTempDir();
    Deno.env.set("DATA_DIR", tempDir);
    Deno.env.set("MYTABS_PORT", "47778");
    return tempDir;
}

const tempDir = await setupTest();

// Now import after setting env
const {
    tabExists,
    getConfigJSON,
    createTab,
    getTab,
    deleteTab,
    updateConfigJSON,
    getConfigJSONPath,
    getAllTabs,
    replaceTab,
    updateTab,
    updateTabFav,
    addAudio,
    removeAudio,
    updateAudio,
    addYoutube,
    updateYoutube,
    removeYoutube,
} = await import("./tab.ts");
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
    assertRejects(
        async () => {
            await getTab("../invalid");
        },
        Error,
        "Invalid filename",
    );

    assertRejects(
        async () => {
            await getTab("invalid/../name");
        },
        Error,
        "Invalid filename",
    );
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

Deno.test("updateConfigJSON - queuing", async () => {
    const tabData = new Uint8Array([13, 14, 15]);
    const id = await createTab(tabData, "gp", "Queue Test", "Queue Artist", "queue.gp");

    // Start multiple updates without awaiting
    const promises = [];
    for (let i = 0; i < 10; i++) {
        promises.push(updateConfigJSON(id, async (config) => {
            // Simulate async work
            await new Promise((resolve) => setTimeout(resolve, 10));
            config.tab.title += i.toString();
        }));
    }

    // Wait for all to complete
    await Promise.all(promises);

    // Check that updates were applied sequentially
    const tab = await getTab(id);
    assertEquals(tab.title, "Queue Test0123456789");
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

Deno.test("getConfigJSONPath", () => {
    const expectedPath = path.join(tempDir, "tabs", "123", "config.json");
    const actualPath = getConfigJSONPath("123");
    assertEquals(actualPath, expectedPath);

    // Test path traversal protection
    assertThrows(
        () => {
            getConfigJSONPath("../invalid");
        },
        Error,
        "Invalid filename",
    );
});

Deno.test("getAllTabs", async () => {
    // Create multiple tabs
    const tabData1 = new Uint8Array([16, 17, 18]);
    const id1 = await createTab(tabData1, "gp", "Tab 1", "Artist 1", "tab1.gp");

    const tabData2 = new Uint8Array([19, 20, 21]);
    const id2 = await createTab(tabData2, "gpx", "Tab 2", "Artist 2", "tab2.gpx");

    const tabData3 = new Uint8Array([22, 23, 24]);
    const id3 = await createTab(tabData3, "gp", "Tab 3", "Artist 3", "tab3.gp");

    // Get all tabs
    const tabs = await getAllTabs();

    // 5 (from previous tests) + 3 = 8 tabs total
    assertEquals(tabs.length, 8);
    assertEquals(tabs[0].id, id3); // Newest
    assertEquals(tabs[1].id, id2);
    assertEquals(tabs[2].id, id1); // Oldest

    // Check titles
    assertEquals(tabs[0].title, "Tab 3");
    assertEquals(tabs[1].title, "Tab 2");
    assertEquals(tabs[2].title, "Tab 1");
});

Deno.test("replaceTab", async () => {
    const originalData = new Uint8Array([1, 2, 3]);
    const id = await createTab(originalData, "gp", "Replace Test", "Replace Artist", "replace.gp");

    let tab = await getTab(id);
    const tabDirPath = path.join(tempDir, "tabs", id);

    // Check original file exists with correct data
    const originalFilePath = path.join(tabDirPath, "tab.gp");
    assertEquals(await fs.exists(originalFilePath), true);
    const originalFileData = await Deno.readFile(originalFilePath);
    assertEquals(originalFileData, originalData);

    // Replace with same ext
    const newData1 = new Uint8Array([4, 5, 6]);
    await replaceTab(tab, newData1, "gp", "new.gp");

    // Check old file is renamed
    const entries = [];
    for await (const entry of Deno.readDir(tabDirPath)) {
        entries.push(entry.name);
    }
    const renamedOld = entries.find((name) => name.startsWith("tab.gp.") && name !== "tab.gp");
    assertExists(renamedOld);
    const renamedData = await Deno.readFile(path.join(tabDirPath, renamedOld));
    assertEquals(renamedData, originalData);

    // Check new file
    const newFileData1 = await Deno.readFile(originalFilePath);
    assertEquals(newFileData1, newData1);

    // Check tab info updated
    tab = await getTab(id);
    assertEquals(tab.filename, "tab.gp");
    assertEquals(tab.originalFilename, "new.gp");

    // Replace with different ext
    const newData2 = new Uint8Array([7, 8, 9]);
    await replaceTab(tab, newData2, "gpx", "another.gpx");

    // Check old file renamed again
    const entries2 = [];
    for await (const entry of Deno.readDir(tabDirPath)) {
        entries2.push(entry.name);
    }
    const renamedOld2 = entries2.find((name) => name.startsWith("tab.gp.") && name !== renamedOld && name !== "tab.gp");
    assertExists(renamedOld2);
    const renamedData2 = await Deno.readFile(path.join(tabDirPath, renamedOld2));
    assertEquals(renamedData2, newData1);

    // Check new file with new ext
    const newFilePath2 = path.join(tabDirPath, "tab.gpx");
    assertEquals(await fs.exists(newFilePath2), true);
    const newFileData2 = await Deno.readFile(newFilePath2);
    assertEquals(newFileData2, newData2);

    // Check tab info updated
    tab = await getTab(id);
    assertEquals(tab.filename, "tab.gpx");
    assertEquals(tab.originalFilename, "another.gpx");
});

Deno.test("updateTab", async () => {
    const tabData = new Uint8Array([25, 26, 27]);
    const id = await createTab(tabData, "gp", "Update Test", "Update Artist", "update.gp");

    let tab = await getTab(id);
    assertEquals(tab.title, "Update Test");
    assertEquals(tab.artist, "Update Artist");
    assertEquals(tab.public, false);

    // Update tab info
    await updateTab(tab, {
        title: "Updated Title",
        artist: "Updated Artist",
        public: true,
    });

    // Check updated
    tab = await getTab(id);
    assertEquals(tab.title, "Updated Title");
    assertEquals(tab.artist, "Updated Artist");
    assertEquals(tab.public, true);
});

Deno.test("updateTabFav", async () => {
    const tabData = new Uint8Array([28, 29, 30]);
    const id = await createTab(tabData, "gp", "Fav Test", "Fav Artist", "fav.gp");

    let tab = await getTab(id);
    assertEquals(tab.fav, false);

    // Update fav to true
    await updateTabFav(tab, { fav: true });

    // Check updated
    tab = await getTab(id);
    assertEquals(tab.fav, true);

    // Update fav to false
    await updateTabFav(tab, { fav: false });

    // Check updated
    tab = await getTab(id);
    assertEquals(tab.fav, false);
});

Deno.test("addAudio", async () => {
    const tabData = new Uint8Array([31, 32, 33]);
    const id = await createTab(tabData, "gp", "Audio Test", "Audio Artist", "audio.gp");

    const tab = await getTab(id);
    const tabDirPath = path.join(tempDir, "tabs", id);

    // Add audio file
    const audioData = new Uint8Array([1, 2, 3, 4]);
    await addAudio(tab, audioData, "test.mp3");

    // Check file exists
    const audioFilePath = path.join(tabDirPath, "test.mp3");
    assertEquals(await fs.exists(audioFilePath), true);

    // Check content
    const writtenData = await Deno.readFile(audioFilePath);
    assertEquals(writtenData, audioData);

    // Try to add the same file again, should throw
    await assertRejects(
        async () => {
            await addAudio(tab, audioData, "test.mp3");
        },
        Error,
        "Audio file with the same name already exists",
    );

    // Test path traversal protection
    await assertRejects(
        async () => {
            await addAudio(tab, audioData, "../invalid.mp3");
        },
        Error,
        "Invalid filename",
    );
});

Deno.test("removeAudio", async () => {
    const tabData = new Uint8Array([34, 35, 36]);
    const id = await createTab(tabData, "gp", "Remove Audio Test", "Audio Artist", "remove_audio.gp");

    const tab = await getTab(id);
    const tabDirPath = path.join(tempDir, "tabs", id);

    // Add audio file
    const audioData = new Uint8Array([1, 2, 3, 4]);
    await addAudio(tab, audioData, "test.mp3");

    // Check file exists
    const audioFilePath = path.join(tabDirPath, "test.mp3");
    assertEquals(await fs.exists(audioFilePath), true);

    // Remove audio file
    await removeAudio(tab, "test.mp3");

    // Check file no longer exists
    assertEquals(await fs.exists(audioFilePath), false);

    // Try to remove non-existent file, should throw
    await assertRejects(
        async () => {
            await removeAudio(tab, "test.mp3");
        },
        Error,
        "Audio file not found",
    );

    // Test path traversal protection
    await assertRejects(
        async () => {
            await removeAudio(tab, "../invalid.mp3");
        },
        Error,
        "Invalid filename",
    );
});

Deno.test("updateAudio", async () => {
    const tabData = new Uint8Array([37, 38, 39]);
    const id = await createTab(tabData, "gp", "Update Audio Test", "Audio Artist", "update_audio.gp");

    const tab = await getTab(id);

    // Add audio file
    const audioData = new Uint8Array([1, 2, 3, 4]);
    await addAudio(tab, audioData, "test.mp3");

    // Update audio metadata
    await updateAudio(tab, "test.mp3", {
        syncMethod: "advanced",
        simpleSync: 0,
        advancedSync: "adv-sync",
    });

    // Check config has the updated metadata
    const config = await getConfigJSON(id);
    assertExists(config);
    assertEquals(config!.audio.length, 1);
    assertEquals(config!.audio[0].filename, "test.mp3");
    assertEquals(config!.audio[0].syncMethod, "advanced");
    assertEquals(config!.audio[0].advancedSync, "adv-sync");

    // Update again to change to simple sync
    await updateAudio(tab, "test.mp3", {
        syncMethod: "simple",
        simpleSync: 2500,
        advancedSync: "",
    });

    // Check updated
    const config2 = await getConfigJSON(id);
    assertExists(config2);
    assertEquals(config2!.audio[0].syncMethod, "simple");
    assertEquals(config2!.audio[0].simpleSync, 2500);

    // Try to update non-existent file, should throw
    await assertRejects(
        async () => {
            await updateAudio(tab, "nonexistent.mp3", { syncMethod: "simple", simpleSync: 0, advancedSync: "" });
        },
        Error,
        "Audio file not found",
    );

    // Test path traversal protection
    await assertRejects(
        async () => {
            await updateAudio(tab, "../invalid.mp3", { syncMethod: "simple", simpleSync: 0, advancedSync: "" });
        },
        Error,
        "Invalid filename",
    );
});

Deno.test("addYoutube", async () => {
    const tabData = new Uint8Array([40, 41, 42]);
    const id = await createTab(tabData, "gp", "YouTube Test", "YT Artist", "yt.gp");

    // Add a YouTube video
    await addYoutube(id, "video-123");

    // Verify it's in config
    const config = await getConfigJSON(id);
    assertExists(config);
    assertEquals(config!.youtube.length, 1);
    assertEquals(config!.youtube[0].videoID, "video-123");

    // Adding the same video should throw
    await assertRejects(
        async () => {
            await addYoutube(id, "video-123");
        },
        Error,
        "YouTube video already exists",
    );
});

Deno.test("updateYoutube", async () => {
    const tabData = new Uint8Array([43, 44, 45]);
    const id = await createTab(tabData, "gp", "Update YT Test", "YT Artist", "yt2.gp");

    // Use updateYoutube to create a new entry
    await updateYoutube(id, "vid-1", {
        syncMethod: "advanced",
        simpleSync: 0,
        advancedSync: "adv-1",
    });

    let config = await getConfigJSON(id);
    assertExists(config);
    assertEquals(config!.youtube.length, 1);
    assertEquals(config!.youtube[0].videoID, "vid-1");
    assertEquals(config!.youtube[0].syncMethod, "advanced");
    assertEquals(config!.youtube[0].advancedSync, "adv-1");

    // Update the existing entry
    await updateYoutube(id, "vid-1", {
        syncMethod: "simple",
        simpleSync: 3000,
        advancedSync: "",
    });

    config = await getConfigJSON(id);
    assertExists(config);
    assertEquals(config!.youtube.length, 1);
    assertEquals(config!.youtube[0].videoID, "vid-1");
    assertEquals(config!.youtube[0].syncMethod, "simple");
    assertEquals(config!.youtube[0].simpleSync, 3000);

    // Create another entry with updateYoutube (should push new)
    await updateYoutube(id, "vid-2", {
        syncMethod: "simple",
        simpleSync: 1000,
        advancedSync: "",
    });

    config = await getConfigJSON(id);
    assertExists(config);
    assertEquals(config!.youtube.length, 2);
    const vids = config!.youtube.map((y) => y.videoID).sort();
    assertEquals(vids, ["vid-1", "vid-2"].sort());
});

Deno.test("removeYoutube", async () => {
    const tabData = new Uint8Array([46, 47, 48]);
    const id = await createTab(tabData, "gp", "Remove YT Test", "YT Artist", "yt3.gp");

    // Add two videos
    await addYoutube(id, "rv-1");
    await addYoutube(id, "rv-2");

    let config = await getConfigJSON(id);
    assertExists(config);
    assertEquals(config!.youtube.length, 2);

    // Remove one
    await removeYoutube(id, "rv-1");
    config = await getConfigJSON(id);
    assertExists(config);
    assertEquals(config!.youtube.length, 1);
    assertEquals(config!.youtube[0].videoID, "rv-2");

    // Removing a non-existent video should be a no-op (not throw)
    await removeYoutube(id, "does-not-exist");
    config = await getConfigJSON(id);
    assertExists(config);
    assertEquals(config!.youtube.length, 1);

    // Remove the last one
    await removeYoutube(id, "rv-2");
    config = await getConfigJSON(id);
    assertExists(config);
    assertEquals(config!.youtube.length, 0);
});

// Clean up
Deno.test.afterAll(async () => {
    // close db
    kv.close();
    db.close();
    await fs.emptyDir(tempDir);
    await Deno.remove(tempDir);
});
