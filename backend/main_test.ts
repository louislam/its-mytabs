import { assertEquals, assertExists, assertRejects } from "jsr:@std/assert@^1.0.17";
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

Deno.test("private tab endpoints require authentication (HTTP)", async () => {
    // Create a private tab using internal API
    const tabData = new Uint8Array([200, 201, 202]);
    const id = await createTab(tabData, "gp", "Private Test", "Private Artist", "private.gp");

    const config = await getConfigJSON(id);
    assertExists(config);
    assertEquals(config!.tab.public, false);

    // 1) GET /api/tab/:id should require auth -> returns 400 with msg "Not logged in"
    const res1 = await fetch(`${baseURL}/api/tab/${encodeURIComponent(id)}`, { method: 'GET' });
    const j1 = await res1.json();
    assertEquals(res1.status, 400);
    assertEquals(j1.ok, false);

    // 2) GET /api/tab/:id/audio/:filename should require auth for private tab
    // Add an audio file to the tab directory directly
    const { getTab } = await import("./tab.ts");
    const tab = await getTab(id);
    await addAudio(tab, new Uint8Array([1,2,3]), "a.mp3");

    const res2 = await fetch(`${baseURL}/api/tab/${encodeURIComponent(id)}/audio/${encodeURIComponent('a.mp3')}`, { method: 'GET' });
    const j2text = await res2.text();
    // Should be JSON error body
    let j2: unknown = {};
    try { j2 = JSON.parse(j2text); } catch { j2 = null; }
    assertEquals(res2.status, 400);

    // 3) GET /api/tab/:id/file should require auth for private tab
    const res3 = await fetch(`${baseURL}/api/tab/${encodeURIComponent(id)}/file`, { method: 'GET' });
    const j3 = await res3.json();
    assertEquals(res3.status, 400);
});

Deno.test("public tab endpoints accessible (HTTP)", async () => {
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
    const res1 = await fetch(`${baseURL}/api/tab/${encodeURIComponent(id)}`, { method: 'GET' });
    const j1 = await res1.json();
    assertEquals(res1.status, 200);
    assertEquals(j1.ok, true);


    // Add audio and request it without auth
    const { getTab } = await import("./tab.ts");
    const tab = await getTab(id);
    await addAudio(tab, new Uint8Array([9,9,9]), "pa.mp3");

    const res2 = await fetch(`${baseURL}/api/tab/${encodeURIComponent(id)}/audio/${encodeURIComponent('pa.mp3')}`, { method: 'GET' });
    assertEquals(res2.status, 200);
    await res2.body?.cancel();

    // Obtain temp token for file access (public tab allows this without auth)
    const resToken = await fetch(`${baseURL}/api/tab/${encodeURIComponent(id)}/temp-token`, { method: 'GET' });
    const tokenJson = await resToken.json();
    assertEquals(resToken.status, 200);
    assertEquals(!!tokenJson.token, true);
    const token = tokenJson.token;

    // Use temp token to fetch tab file
    const resFile = await fetch(`${baseURL}/api/tab/${encodeURIComponent(id)}/file?tempToken=${encodeURIComponent(token)}`, { method: 'GET' });
    assertEquals(resFile.status, 200);
    // close it
    await resFile.body?.cancel();
});

Deno.test("logged-in user can access private resources (HTTP)", async () => {
    // Register a new user
    const signupRes = await fetch(`${baseURL}/api/auth/sign-up/email`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "test+ci@example.com", name: "CI Test", password: "password123" }),
    });
    const signupJson = await signupRes.json();
    // sign up should succeed
    assertEquals(signupRes.ok, true, "signup failed: " + JSON.stringify(signupJson));

    // Sign in via auth handler
    const signInRes = await fetch(`${baseURL}/api/auth/sign-in/email`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "test+ci@example.com", password: "password123" }),
    });

    console.log("Sign-in response status:", signInRes.status);
    assertEquals(signInRes.status, 200, "sign-in failed");
    const signInJson = await signInRes.json();
    console.log("Sign-in response JSON:", signInJson);

    // Extract Set-Cookie
    const setCookie = signInRes.headers.get("set-cookie");
    assertExists(setCookie, "No set-cookie header from sign-in");
    // Use only the cookie pair before the first semicolon
    const cookiePair = setCookie!.split(";", 1)[0];

    // Create a private tab
    const tabData = new Uint8Array([240,241,242]);
    const id = await createTab(tabData, "gp", "Private For Auth", "Auth Artist", "auth.gp");

    const config = await getConfigJSON(id);
    assertExists(config);
    assertEquals(config!.tab.public, false);

    // Access protected /api/tab/:id with cookie
    const resTab = await fetch(`${baseURL}/api/tab/${encodeURIComponent(id)}`, {
        method: 'GET',
        headers: { Cookie: cookiePair },
    });
    assertEquals(resTab.status, 200);
    const tabJson = await resTab.json();
    assertEquals(tabJson.ok, true);

    // Add audio and request it with cookie
    const { getTab } = await import("./tab.ts");
    const tab = await getTab(id);
    await addAudio(tab, new Uint8Array([5,5,5]), "auth.mp3");

    const resAudio = await fetch(`${baseURL}/api/tab/${encodeURIComponent(id)}/audio/${encodeURIComponent('auth.mp3')}`, {
        method: 'GET',
        headers: { Cookie: cookiePair },
    });
    assertEquals(resAudio.status, 200);
    await resAudio.body?.cancel();

    // Fetch the tab file with cookie
    const resFile = await fetch(`${baseURL}/api/tab/${encodeURIComponent(id)}/file`, {
        method: 'GET',
        headers: { Cookie: cookiePair },
    });
    assertEquals(resFile.status, 200);
    await resFile.body?.cancel();
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
