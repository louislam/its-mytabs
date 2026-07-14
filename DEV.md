# DEV — MyTabs (Development Instance)

**Project:** `2026-07-mytabs-dev`
**Base:** Clone of [louislam/its-mytabs](https://github.com/louislam/its-mytabs), at **tag `1.6.2`** (exactly like Prod).
**URL:** <http://openclaw.fritz.box:7778> · <http://localhost:7778>
**Branch:** `dev` (branched from tag `1.6.2`)
**Remote `upstream`:** `https://github.com/louislam/its-mytabs.git` (PR source only)

> **Prod vs Dev (as of 2026-07-14):**
> - **mytabs-prod** = production instance, port **7777**, project `2026-06-mytabs`, runs as a prebuilt Docker image `louislam/its-mytabs:1`. Docs: `2026-06-mytabs/onboard.md`.
> - **mytabs-dev** = this instance, port **7778**, project `2026-07-mytabs-dev`, **built from source** (branch `dev`, tag 1.6.2). This is where we develop; deploy to Prod when ready.

## Why built from source?
So we can modify the code, commit, create branches, and open PRs against
upstream. Prod uses the prebuilt image; Dev builds locally via `docker compose build`.

## Setup / Start

```bash
cd ~/workspace/projects/2026-07-mytabs-dev

# First-time setup (build image + start container)
docker compose build
docker compose up -d

# Only restart container (after config changes)
docker compose restart

# Logs
docker compose logs

# Stop
docker compose down
```

**Important:** `data/` is in `.gitignore` and was created as a **copy of the
Prod data** on first setup (clean stop of Prod during copy so the SQLite WAL
would not be torn). Dev thus has its own, independent data copy — changes in
Dev do not affect Prod.

## Dev Loop (change code → test)

1. Edit code in the repo (branch `dev`, or a feature branch from it).
2. `docker compose build && docker compose up -d` (rebuilds the image, ~1–2 min).
3. Check in browser at <http://localhost:7778>.
4. Commit: `git add -A && git commit -m "..."`

> Note: Live reload (`deno task dev`) would need Deno on the host — not
> available here. Hence the rebuild loop via Docker. For a more comfortable
> setup, `./backend` and `./frontend` could be mounted as volumes and
> `deno task dev` run inside the container.

## Branch / Commit / PR Workflow

- `upstream` = louislam/its-mytabs (read-only for us).
- For an upstream PR:
  1. Create a fork of louislam/its-mytabs on GitHub (once).
  2. `git remote add fork <your-fork-url>` (or rename `origin`).
  3. Create a feature branch: `git checkout -b feat/xyz upstream/master`
     (branched cleanly from upstream, not from the Dev setup branch).
  4. Commit changes, `git push fork feat/xyz`.
  5. Open a PR on GitHub from `fork/feat/xyz` → `louislam/its-mytabs:master`.
- The `dev` branch here additionally contains the Dev setup changes
  (Dockerfile/compose for port 7778 + local build), which do **not** belong in
  the upstream PR.

## Credentials (same as Prod, since DB was copied)
- **User:** `fox@home.local`
- **Password:** `foxfoxfox`
- **URL:** <http://localhost:7778>

## Gotchas
- Build fails if the root `deno.jsonc` is missing in the builder stage
  (vite.config reads `../deno.jsonc` for `appVersion`). Fixed in the Dev
  Dockerfile.
- The cache warmup `deno -A main.ts` in the release stage throws a harmless
  `Module not found "file:///app/main.ts"` (main.ts lives in /app/backend) —
  caught by `|| exit 0`, same as upstream.
