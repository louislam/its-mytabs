# Plan: Configurable Login Mode (email / single-password / none)

**Status:** Draft
**Target:** `projects/2026-07-mytabs-dev`, branch `dev`
**Goal:** Make the authentication model selectable via a single config flag, with three modes:

1. **`email`** — legacy behavior (mail + password, sign-up disabled after first user). Default.
2. **`password`** — a single shared password (configured in config) to hand out to friends; no email/account needed.
3. **`none`** — no login at all; the app is open.

---

## Design Decision (read first)

We introduce a **unified session abstraction** so every backend route that today calls
`checkLogin(c)` / `getCurrentSession(c)` keeps working unchanged, regardless of mode.

- **`email` mode** keeps `better-auth` exactly as-is (email + password, first-user signup lock).
- **`password` mode** does **not** reuse better-auth. We implement a tiny, self-contained
  cookie session (HMAC/KV-backed) so we don't have to juggle better-auth internal user rows.
  Login validates the single shared password and issues a session cookie.
- **`none` mode** short-circuits the session check: `getSession()` always returns a synthetic
  session (`userId = "anonymous"`), so every `checkLogin` passes and all routes are open.

Frontend learns the mode two ways:
1. Injected into `index.html` at boot (same pattern as `isDemo`) → `window.authMode`,
   `window.sharedPasswordSet` (boolean only, never the real password).
2. A small `GET /api/session` endpoint returning `{ loggedIn, mode }` for live checks.

> The shared password is **never** sent to the browser. The frontend only knows whether one
> is configured (`sharedPasswordSet`) so it can render the right form.

---

## Config Flag

Two equivalent sources, env wins over `config.json`:

| Source | Key / Var | Values | Notes |
|--------|-----------|--------|-------|
| env | `MYTABS_AUTH_MODE` | `email` (default) \| `password` \| `none` | easy for Docker |
| env | `MYTABS_SHARED_PASSWORD` | string | only used in `password` mode |
| config.json | `auth.mode` | same as above | persisted alternative |
| config.json | `auth.sharedPassword` | string | persisted alternative |

Example `config.json` snippet:
```jsonc
{
  "auth": {
    "mode": "password",
    "sharedPassword": "letmein"
  }
}
```

Example `compose.yaml` addition:
```yaml
environment:
  - MYTABS_AUTH_MODE=password
  - MYTABS_SHARED_PASSWORD=letmein
```

---

## Current State (what exists today)

- `backend/auth.ts`: `betterAuth({...})`, `isFinishSetup()`, `isDisableSignUp()`, `disableSignUp()`,
  `checkLogin()`, `isLoggedIn()`, `getCurrentSession()`. Session = better-auth session object
  `{ user: { id }, session }`.
- `backend/main.ts`: every protected route calls `await checkLogin(c)`. Public tabs bypass it
  (`if (!config.tab.public) await checkLogin(c)`). `/api/auth/*` mounted for better-auth.
  `index.html` is injected with `{ isDemo }` via cheerio.
- `backend/util.ts`: `isDemoMode` from env; this is where we add `authMode()` / `sharedPassword()`.
- `backend/db.ts`: `hasUser()` (count of `user` table) used by `isFinishSetup`.
- Frontend: `router.ts` redirects to `/login` when not logged in; `index.html` reads `app-config`
  JSON into `window.isDemo`; `Login.vue` / `Register.vue` are email+password forms;
  `Home.vue` `mounted` redirects to `/login` if not logged in; `Dashboard.vue` navbar shows
  Log in / Log out.

---

## Task 1 — Backend: config + helpers (`backend/util.ts`)

**Steps:**
1. Add constants:
   ```ts
   export type AuthMode = "email" | "password" | "none";
   const AUTH_MODE_ENV = Deno.env.get("MYTABS_AUTH_MODE");
   ```
2. Add `authMode(): AuthMode`:
   - If `MYTABS_AUTH_MODE` is one of the three valid values → return it.
   - Else read `config.json` (`path.join(dataDir, "config.json")`) → `auth.mode`.
   - Else default `"email"`.
   - Validate the value; fall back to `"email"` on anything unknown.
3. Add `sharedPassword(): string`:
   - `MYTABS_SHARED_PASSWORD` env, else `config.json` → `auth.sharedPassword`, else `""`.
4. Add `isAuthModeEmail()`, `isAuthModePassword()`, `isAuthModeNone()` convenience wrappers.

**Verification:**
- Add a quick inline check (or temporary `console.log`) in `main()` printing `authMode()` and
  `sharedPassword() ? "<set>" : "<empty>"` at startup. Confirm env override and config.json fallback.

---

## Task 2 — Backend: session abstraction (`backend/auth.ts`)

**Steps:**
1. Add session token helpers (used only in `password` mode):
   ```ts
   import { createHmac, timingSafeEqual } from "node:crypto";
   const SESSION_COOKIE = "mytabs_session";
   // issue: store random token in kv ["pw_session", token] = "shared", expireIn 30d
   // validate: read cookie, kv.get(["pw_session", token])
   ```
   - `issuePasswordSession(c)` → generate `crypto.randomUUID()`, `kv.set(["pw_session", token], "shared", { expireIn: 30*86400_000 })`, set `c.header("Set-Cookie", ...)` HttpOnly, SameSite=Lax, Path=/, (Secure if `!isDev()`).
   - `clearPasswordSession(c)` → read cookie, `kv.delete(["pw_session", token])`, clear cookie.
   - `getPasswordSession(c)` → returns `"shared"` userId or `null`.
2. Refactor `getSession(c)` (new exported function):
   ```ts
   export async function getSession(c: Context) {
       if (isAuthModeNone()) {
           return { user: { id: "anonymous" }, session: {} };
       }
       if (isAuthModePassword()) {
           const uid = await getPasswordSession(c);
           return uid ? { user: { id: uid }, session: {} } : null;
       }
       // email mode
       return await auth.api.getSession(c.req.raw);
   }
   ```
3. Rewrite `getCurrentSession(c)` to use `getSession`; throw only when result is `null`:
   ```ts
   export async function getCurrentSession(c: Context) {
       const s = await getSession(c);
       if (!s) throw new Error("Not logged in");
       return s;
   }
   ```
   (`none` mode never throws because `getSession` is never null there.)
4. Rewrite `isLoggedIn(c)` to return `!!(await getSession(c))`.
5. `checkLogin(c)` stays as `await getCurrentSession(c)` (now mode-aware automatically).
6. Make `isFinishSetup()` mode-aware:
   - `none` → `true`
   - `password` → `true` (single shared account, no registration needed)
   - `email` → `hasUser()` (unchanged)
7. `isDisableSignUp()` / `disableSignUp()`: keep as-is (only relevant in email mode).
8. Export `SESSION_COOKIE` name + `issuePasswordSession` / `clearPasswordSession` for `main.ts`.

**Verification:**
- In `none` mode, hit a protected route (e.g. `GET /api/tabs` without cookie) → `200`, returns tabs.
- In `password` mode without cookie → `400 "Not logged in"`.
- In `password` mode after login cookie → `200`.

---

## Task 3 — Backend: login/logout/session routes + index.html injection (`backend/main.ts`)

**Steps:**
1. Extend the cheerio injection (currently `{ isDemo }`) to also include auth info:
   ```ts
   $("head").append(`<script id="app-config" type="application/json">${JSON.stringify({
       isDemo: isDemoMode,
       authMode: authMode(),
       sharedPasswordSet: sharedPassword() !== "",
   })}</script>`);
   ```
2. Conditionally mount better-auth only in email mode:
   ```ts
   if (isAuthModeEmail()) {
       app.all("/api/auth/*", (c) => auth.handler(c.req.raw));
   }
   ```
   (In `password`/`none` modes the `/api/auth/*` routes are unused and omitted to avoid confusion.)
3. Add `POST /api/login` (password mode only):
   - Parse `{ password }`.
   - Constant-time compare against `sharedPassword()` (use `timingSafeEqual`,
     compare buffers of equal length; reject if shared password empty).
   - On match: `issuePasswordSession(c)` → `c.json({ ok: true })`.
   - On mismatch: `c.json({ error: "Wrong password" }, 401)`.
   - If mode !== `password`: return `404` (endpoint not applicable).
4. Add `POST /api/logout` (password mode only):
   - `clearPasswordSession(c)` → `c.json({ ok: true })`.
   - `none` mode: no-op `200`. `email` mode: `404` (frontend uses better-auth signOut).
5. Add `GET /api/session` (all modes):
   ```ts
   const s = await getSession(c);
   return c.json({ loggedIn: !!s, mode: authMode(), userId: s?.user.id ?? null });
   ```
6. Keep `/api/is-finish-setup` as-is (now mode-aware via Task 2).

**Verification:**
- `curl http://localhost:7778/api/session` → `{ loggedIn: false, mode: "password", userId: null }`
  before login; `loggedIn: true` after `POST /api/login` with cookie jar.
- `curl -X POST .../api/login -H 'Content-Type: application/json' -d '{"password":"wrong"}'` → 401.
- With `MYTABS_AUTH_MODE=none`, `GET /api/session` → `{ loggedIn: true, mode: "none", userId: "anonymous" }`.

---

## Task 4 — Frontend: read injected config (`index.html` + `vite-env.d.ts`)

**Steps:**
1. In `frontend/index.html`, extend the bootstrap script:
   ```html
   const config = JSON.parse(appConfigElement.textContent);
   window.isDemo = config.isDemo;
   window.authMode = config.authMode;            // "email" | "password" | "none"
   window.sharedPasswordSet = config.sharedPasswordSet;
   ```
2. In `frontend/src/vite-env.d.ts`, extend the `Window` interface:
   ```ts
   isDemo: boolean;
   authMode: "email" | "password" | "none";
   sharedPasswordSet: boolean;
   ```
   (Keep existing `isDemo`.)

**Verification:** `console.log(window.authMode)` in browser devtools matches backend `authMode()`.

---

## Task 5 — Frontend: auth helpers (`frontend/src/auth-client.ts`)

**Steps:**
1. Add `getAuthMode()` → `window.authMode`.
2. Rewrite `isLoggedIn()` to be mode-aware:
   ```ts
   export async function isLoggedIn(): Promise<boolean> {
       const mode = getAuthMode();
       if (mode === "none") return true;
       if (mode === "password") {
           const res = await fetch(baseURL + "/api/session", { credentials: "include" });
           const data = await res.json();
           return !!data.loggedIn;
       }
       // email
       const session = await authClient.getSession();
       return session.data !== null;
   }
   ```
3. Add `loginWithPassword(password: string)`:
   ```ts
   await fetch(baseURL + "/api/login", {
       method: "POST",
       credentials: "include",
       headers: { "Content-Type": "application/json" },
       body: JSON.stringify({ password }),
   });
   ```
4. Add `logout()`:
   ```ts
   const mode = getAuthMode();
   if (mode === "password") {
       await fetch(baseURL + "/api/logout", { method: "POST", credentials: "include" });
   } else if (mode === "email") {
       await authClient.signOut();
   }
   // none: nothing
   ```

**Verification:** In password mode, `loginWithPassword("letmein")` then `isLoggedIn()` → true;
`logout()` then `isLoggedIn()` → false.

---

## Task 6 — Frontend: router guard (`frontend/src/router.ts`)

**Steps:**
1. In `router.beforeEach`, after the existing `isDemo` block, add a mode-aware guard:
   ```ts
   const mode = window.authMode;
   if (mode !== "none") {
       const loggedIn = await isLoggedIn();
       if (!loggedIn && to.name !== "login" && to.name !== "register") {
           next("/login");
           return;
       }
       if (loggedIn && (to.name === "login" || to.name === "register")) {
           next("/");
           return;
       }
   }
   next();
   ```
   (`none` mode: no redirects at all.)
2. Reuse the existing `isLoggedIn` import from `auth-client.ts`.

**Verification:** In `none` mode, navigating to `/` shows the dashboard without redirect. In
`password` mode, unauthenticated `/` → `/login`; after login → `/`.

---

## Task 7 — Frontend: Login.vue (password-only form)

**Steps:**
1. In `data()` add `mode = window.authMode` and `showEmail = (window.authMode === "email")`.
2. In `mounted()`, also redirect away if `authMode === "none"` (should not happen via router, but safe).
3. UI: wrap the email `<input>`/`<label>` in `v-if="showEmail"`.
4. `submit()`:
   - If `mode === "password"`: call `loginWithPassword(this.password)`; on ok → `this.$router.push("/")`;
     on fail → `this.error = "Wrong password"`.
   - If `mode === "email"`: keep current `authClient.signIn.email` flow.
5. Update heading/subtext: if password mode, show "Enter the shared password" instead of email login.

**Verification:** With `authMode=password`, Login page shows only a password field; entering the
correct shared password lands on `/`; wrong password shows error and stays.

---

## Task 8 — Frontend: Register.vue (email setup only)

**Steps:**
1. In `mounted()`, if `window.authMode !== "email"` → `this.$router.push("/")` (no registration in
   password/none modes; setup is considered finished).
2. Keep the email signup flow for `email` mode.
3. The `is-finish-setup` check already uses backend `isFinishSetup()` (now mode-aware), so the
   redirect logic stays correct.

**Verification:** With `authMode=password` or `none`, visiting `/register` → redirected to `/`.

---

## Task 9 — Frontend: Dashboard.vue navbar (Login/Logout visibility)

**Steps:**
1. In `signOut()` use the new `logout()` helper from `auth-client.ts` (handles all modes).
2. Visibility:
   - `none` mode: hide **both** "Log out" and "Log in" links (app is open; nothing to toggle).
   - `password` mode: show "Log out" (clears cookie), hide "Log in" when logged in.
   - `email` mode: current behavior.
   Use `v-if` based on `window.authMode` and `isLoggedIn`.
3. Replace `authClient.signOut()` usage with `logout()`.

**Verification:** In `none` mode the navbar shows no auth links. In `password` mode, "Log out"
clears the session and returns to `/login`.

---

## Task 10 — Frontend: Home.vue (mode-aware redirect)

**Steps:**
1. In `mounted()`, replace:
   ```ts
   if (!this.isLoggedIn) { this.$router.push("/login"); return; }
   ```
   with the mode-aware `isLoggedIn()` helper (Task 5) which already returns `true` for `none` mode
   and does a real server check for `password` mode. The current code already calls
   `this.isLoggedIn = await isLoggedIn()` (from `auth-client.js`) — confirm it uses the updated
   mode-aware version. No extra change needed beyond Task 5, but verify the early-return logic
   still reads `this.isLoggedIn`.

**Verification:** In `none` mode, `/` loads the tab list directly. In `password` mode without a
cookie, the router guard already redirects; `Home` never reaches the fetch.

---

## Task 11 — Docs & Docker (`compose.yaml`, `DEV.md`)

**Steps:**
1. Document the env vars in `DEV.md` (a new "Auth Modes" section) with the three modes and examples.
2. Optionally show a commented `environment:` block in `compose.yaml` for `MYTABS_AUTH_MODE` /
   `MYTABS_SHARED_PASSWORD` (commented out so default `email` stays).
3. Note the security implication: in `password` mode anyone with the password has full admin
   access (by design — it's for sharing with friends). In `none` mode the instance is fully open.

**Verification:** Docs readable; copy-paste env block works.

---

## Task 12 — Build & End-to-End Test

**Steps:**
1. `cd ~/workspace/projects/2026-07-mytabs-dev && docker compose build && docker compose up -d`
2. **email mode (default):** confirm legacy login still works with `fox@home.local` / `foxfoxfox`.
3. **password mode:** set `MYTABS_AUTH_MODE=password` + `MYTABS_SHARED_PASSWORD=testpw`, rebuild/restart,
   confirm:
   - `/register` redirects to `/`
   - `/login` shows password-only field
   - wrong password → error; correct → dashboard
   - `GET /api/tabs` without cookie → 401; with cookie → 200
   - Log out returns to `/login`
4. **none mode:** set `MYTABS_AUTH_MODE=none`, rebuild/restart, confirm:
   - `/` loads directly, no redirect
   - no Login/Logout links in navbar
   - `GET /api/tabs` works without any cookie
5. Revert dev instance back to `email` (or leave as desired) and restart.

---

## Files to Modify (summary)

| File | Change |
|------|--------|
| `backend/util.ts` | `authMode()`, `sharedPassword()`, mode helpers |
| `backend/auth.ts` | `getSession()`, mode-aware `getCurrentSession`/`isLoggedIn`/`isFinishSetup`, password-session helpers |
| `backend/main.ts` | index.html injection, conditional `/api/auth/*`, `/api/login`, `/api/logout`, `/api/session` |
| `frontend/index.html` | read `authMode` / `sharedPasswordSet` into `window` |
| `frontend/src/vite-env.d.ts` | `Window` type additions |
| `frontend/src/auth-client.ts` | `getAuthMode()`, mode-aware `isLoggedIn()`, `loginWithPassword()`, `logout()` |
| `frontend/src/router.ts` | mode-aware `beforeEach` guard |
| `frontend/src/pages/Login.vue` | password-only form |
| `frontend/src/pages/Register.vue` | redirect away when not `email` mode |
| `frontend/src/pages/Dashboard.vue` | mode-aware auth links + `logout()` |
| `frontend/src/pages/Home.vue` | confirm mode-aware redirect (mostly via Task 5) |
| `compose.yaml` / `DEV.md` | docs + optional env block |

---

## Open Questions / Nice-to-Haves

1. **Set shared password via Settings UI?** Currently only env / `config.json`. A Settings field
   to update `auth.sharedPassword` (and persist to `config.json`) would be friendlier. Deferred.
2. **Session expiry in `password` mode:** 30-day KV TTL chosen; could be configurable.
3. **Multiple shared passwords / revocation list:** out of scope for v1 (single password by request).
4. **`none` mode settings identity:** all visitors share one settings profile keyed by `anonymous`.
   Acceptable; could namespace per-browser later.
5. **Secure cookie flag:** set `Secure` only when not `isDev()` (Docker dev on http://localhost).
