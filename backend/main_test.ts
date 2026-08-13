import { assertEquals, assertExists } from "jsr:@std/assert@^1.0.17";
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

// Ensure minimal frontend dist/index.html exists so main() won't exit
const distDir = path.join("./", "dist");
await fs.ensureDir(distDir);
const indexPath = path.join(distDir, "index.html");
await Deno.writeTextFile(indexPath, "<html><head></head><body>test</body></html>");

// Now import functions after env setup
const { createTab, addAudio, getConfigJSON, updateConfigJSON } = await import("./tab.ts");
const { main, closeServer } = await import("./main.ts");

// Start the server
await main();
// Wait a moment for server to be ready
await new Promise((res) => setTimeout(res, 5000));

const baseURL = `http://127.0.0.1:47778`;

/**
 * Ensure a user exists and sign in, returning the session cookie header pair
 * (e.g. `{ Cookie: "..." }`) for use in authed requests. Sign-up is disabled
 * after the first user is created, so sign in first and only register when the
 * user does not exist yet.
 */
async function registerAndSignIn(email: string): Promise<Record<string, string>> {
    const credentials = {
        email,
        password: "password123",
    };

    let signInRes = await fetch(`${baseURL}/api/auth/sign-in/email`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(credentials),
    });

    if (signInRes.status !== 200) {
        const signupRes = await fetch(`${baseURL}/api/auth/sign-up/email`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                email,
                name: email.split("@")[0],
                password: "password123",
            }),
        });
        assertEquals(signupRes.ok, true, "signup failed: " + await signupRes.text());

        signInRes = await fetch(`${baseURL}/api/auth/sign-in/email`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(credentials),
        });
    }
    assertEquals(signInRes.status, 200, "sign-in failed");

    const setCookie = signInRes.headers.get("set-cookie");
    assertExists(setCookie, "No set-cookie header from sign-in");
    const cookiePair = setCookie!.split(";", 1)[0];
    return { Cookie: cookiePair };
}

Deno.test({
    name: "private tab endpoints require authentication (HTTP)",
    sanitizeOps: false,
    sanitizeResources: false,
    fn: async () => {
        // Create a private tab using internal API
        const tabData = new Uint8Array([200, 201, 202]);
        const id = await createTab(tabData, "gp", "Private Test", "Private Artist", "private.gp");

        const config = await getConfigJSON(id);
        assertExists(config);
        assertEquals(config!.tab.public, false);

        // 1) GET /api/tab/:id should require auth -> returns 400 with msg "Not logged in"
        const res1 = await fetch(`${baseURL}/api/tab/${encodeURIComponent(id)}`, { method: "GET" });
        const j1 = await res1.json();
        assertEquals(res1.status, 400);
        assertEquals(j1.ok, false);

        // 2) GET /api/tab/:id/audio/:filename should require auth for private tab
        // Add an audio file to the tab directory directly
        const { getTab } = await import("./tab.ts");
        const tab = await getTab(id);
        await addAudio(tab, new Uint8Array([1, 2, 3]), "a.mp3");

        const res2 = await fetch(`${baseURL}/api/tab/${encodeURIComponent(id)}/audio/${encodeURIComponent("a.mp3")}`, { method: "GET" });
        const j2text = await res2.text();
        // Should be JSON error body
        let j2: unknown = {};
        try {
            j2 = JSON.parse(j2text);
        } catch {
            j2 = null;
        }
        assertEquals(res2.status, 400);

        // 3) GET /api/tab/:id/file should require auth for private tab
        const res3 = await fetch(`${baseURL}/api/tab/${encodeURIComponent(id)}/file`, { method: "GET" });
        const j3 = await res3.json();
        assertEquals(res3.status, 400);
    },
});

Deno.test({
    name: "public tab endpoints accessible (HTTP)",
    sanitizeOps: false,
    sanitizeResources: false,
    fn: async () => {
        // Create a tab and make it public
        const tabData = new Uint8Array([220, 221, 222]);
        const id = await createTab(tabData, "gp", "Public Test", "Public Artist", "public.gp");

        // Make public via updateConfigJSON
        await updateConfigJSON(id, async (config) => {
            config.tab.public = true;
        });

        const config = await getConfigJSON(id);
        assertExists(config);
        assertEquals(config!.tab.public, true);

        // GET tab info should be accessible without auth
        const res1 = await fetch(`${baseURL}/api/tab/${encodeURIComponent(id)}`, { method: "GET" });
        const j1 = await res1.json();
        assertEquals(res1.status, 200, JSON.stringify(j1));
        assertEquals(j1.ok, true);

        // Add audio and request it without auth
        const { getTab } = await import("./tab.ts");
        const tab = await getTab(id);
        await addAudio(tab, new Uint8Array([9, 9, 9]), "pa.mp3");

        const res2 = await fetch(`${baseURL}/api/tab/${encodeURIComponent(id)}/audio/${encodeURIComponent("pa.mp3")}`, { method: "GET" });
        assertEquals(res2.status, 200);
        await res2.body?.cancel();

        // Obtain temp token for file access (public tab allows this without auth)
        const resToken = await fetch(`${baseURL}/api/tab/${encodeURIComponent(id)}/temp-token`, { method: "GET" });
        const tokenJson = await resToken.json();
        assertEquals(resToken.status, 200);
        assertEquals(!!tokenJson.token, true);
        const token = tokenJson.token;

        // Use temp token to fetch tab file
        const resFile = await fetch(`${baseURL}/api/tab/${encodeURIComponent(id)}/file?tempToken=${encodeURIComponent(token)}`, { method: "GET" });
        assertEquals(resFile.status, 200);
        // close it
        await resFile.body?.cancel();
    },
});

Deno.test({
    name: "opening a tab records last access and it appears in the tab list (HTTP)",
    sanitizeOps: false,
    sanitizeResources: false,
    fn: async () => {
        // The /api/tabs list requires login
        const authed = await registerAndSignIn("test+ci@example.com");

        // Create a tab, make it public so it can also be opened without auth
        const tabData = new Uint8Array([230, 231, 232]);
        const id = await createTab(tabData, "gp", "Recent Test", "Recent Artist", "recent.gp");
        await updateConfigJSON(id, async (config) => {
            config.tab.public = true;
        });

        // No last access yet (kv.list leaves missing keys undefined)
        let tabs = await (await fetch(`${baseURL}/api/tabs`, { headers: authed })).json();
        let tab = tabs.tabs.find((t: { id: string }) => t.id === id);
        assertExists(tab);
        assertEquals(tab.lastAccessAt, undefined);

        // Open the tab
        const res1 = await fetch(`${baseURL}/api/tab/${encodeURIComponent(id)}`, { method: "GET" });
        assertEquals(res1.status, 200);

        // lastAccessAt is now present on the tab in the list
        tabs = await (await fetch(`${baseURL}/api/tabs`, { headers: authed })).json();
        tab = tabs.tabs.find((t: { id: string }) => t.id === id);
        assertExists(tab);
        assertExists(tab.lastAccessAt);
        assertEquals(typeof tab.lastAccessAt, "string");
        assertEquals(Number.isNaN(new Date(tab.lastAccessAt).getTime()), false, "lastAccessAt is a valid date");
    },
});

Deno.test({
    name: "tab list with more than 10 tabs still returns last access times (HTTP)",
    sanitizeOps: false,
    sanitizeResources: false,
    fn: async () => {
        // The /api/tabs list requires login
        const authed = await registerAndSignIn("test+ci@example.com");

        // Create 12 tabs (one more than the kv.getMany 10-key limit)
        const ids: string[] = [];
        for (let i = 0; i < 12; i++) {
            const tabData = new Uint8Array([200 + i, 100, 50]);
            const id = await createTab(tabData, "gp", `Bulk ${i}`, "Bulk Artist", `bulk-${i}.gp`);
            ids.push(id);
            await updateConfigJSON(id, async (config) => {
                config.tab.public = true;
            });
        }

        // Open a handful of them so they get last access times
        for (const id of ids.slice(0, 5)) {
            const res = await fetch(`${baseURL}/api/tab/${encodeURIComponent(id)}`, { method: "GET" });
            assertEquals(res.status, 200);
        }

        // The list endpoint must not 400 even with >10 tabs; the opened tabs
        // carry a lastAccessAt.
        const tabs = await (await fetch(`${baseURL}/api/tabs`, { headers: authed })).json();
        assertEquals(Array.isArray(tabs.tabs), true);
        assertEquals(tabs.tabs.length >= 12, true, `expected >= 12 tabs, got ${tabs.tabs.length}`);

        const opened = tabs.tabs.filter((t: { lastAccessAt: unknown }) => t.lastAccessAt);
        assertEquals(opened.length >= 5, true, `expected >= 5 tabs with lastAccessAt, got ${opened.length}`);
    },
});

Deno.test({
    name: "logged-in user can access private resources (HTTP)",
    sanitizeOps: false,
    sanitizeResources: false,
    fn: async () => {
        const authed = await registerAndSignIn("test+ci@example.com");

        // Create a private tab
        const tabData = new Uint8Array([240, 241, 242]);
        const id = await createTab(tabData, "gp", "Private For Auth", "Auth Artist", "auth.gp");

        const config = await getConfigJSON(id);
        assertExists(config);
        assertEquals(config!.tab.public, false);

        // Access protected /api/tab/:id with cookie
        const resTab = await fetch(`${baseURL}/api/tab/${encodeURIComponent(id)}`, {
            method: "GET",
            headers: authed,
        });
        assertEquals(resTab.status, 200);
        const tabJson = await resTab.json();
        assertEquals(tabJson.ok, true);

        // Add audio and request it with cookie
        const { getTab } = await import("./tab.ts");
        const tab = await getTab(id);
        await addAudio(tab, new Uint8Array([5, 5, 5]), "auth.mp3");

        const resAudio = await fetch(`${baseURL}/api/tab/${encodeURIComponent(id)}/audio/${encodeURIComponent("auth.mp3")}`, {
            method: "GET",
            headers: authed,
        });
        assertEquals(resAudio.status, 200);
        await resAudio.body?.cancel();

        // Fetch the tab file with cookie
        const resFile = await fetch(`${baseURL}/api/tab/${encodeURIComponent(id)}/file`, {
            method: "GET",
            headers: authed,
        });
        assertEquals(resFile.status, 200);
        await resFile.body?.cancel();
    },
});

Deno.test.afterAll(async () => {
    closeServer();

    try {
        await Deno.remove(indexPath);
        await Deno.remove(distDir);
    } catch {
        // ignore
    }

    await fs.emptyDir(tempDir);
    await Deno.remove(tempDir);
});
