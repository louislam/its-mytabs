# DEV — MyTabs (Entwicklungsinstanz)

**Projekt:** `2026-07-mytabs-dev`
**Basis:** Clone von [louislam/its-mytabs](https://github.com/louislam/its-mytabs), Stand **Tag `1.6.2`** (exakt wie Prod).
**URL:** <http://openclaw.fritz.box:7778> · <http://localhost:7778>
**Branch:** `dev` (von Tag `1.6.2` abgezweigt)
**Remote `upstream`:** `https://github.com/louislam/its-mytabs.git` (nur fetch/PR-Quelle)

> **Prod vs Dev (Stand 2026-07-14):**
> - **mytabs-prod** = alte Produktivinstanz, Port **7777**, Projekt `2026-06-mytabs`, läuft als fertiges Docker-Image `louislam/its-mytabs:1`. Doku: `2026-06-mytabs/onboard.md`.
> - **mytabs-dev** = diese Instanz, Port **7778**, Projekt `2026-07-mytabs-dev`, wird **aus Quelle gebaut** (Branch `dev`, Tag 1.6.2). Hier entwickeln wir; bei Bedarf wird nach Prod deployt.

## Warum aus Quelle gebaut?
Damit wir den Code ändern, committen, branches machen und PRs gegen Upstream
öffnen können. Prod nutzt das fertige Image; Dev baut lokal via `docker compose build`.

## Setup / Start

```bash
cd ~/workspace/projects/2026-07-mytabs-dev

# Erstaufbau (Image bauen + Container starten)
docker compose build
docker compose up -d

# Nur Container neu starten (nach Config-Änderungen)
docker compose restart

# Logs
docker compose logs

# Stoppen
docker compose down
```

**Wichtig:** `data/` ist in `.gitignore` und wurde beim Erstaufbau als
**Kopie der Prod-Daten** angelegt (sauberer Stop von Prod während des Copys,
damit die SQLite-WAL nicht zerrissen wird). Dev hat also eine eigene,
unabhängige Datenkopie — Änderungen in Dev berühren Prod nicht.

## Dev-Loop (Code ändern → testen)

1. Code im Repo editieren (Branch `dev`, oder Feature-Branch davon).
2. `docker compose build && docker compose up -d` (baut Image neu, ~1–2 Min).
3. Im Browser auf <http://localhost:7778> prüfen.
4. Committen: `git add -A && git commit -m "..."`

> Hinweis: Live-Reload (`deno task dev`) braucht Deno auf dem Host — hier
> nicht vorhanden. Daher der Rebuild-Loop über Docker. Wer es komfortabler
> will, kann später `./backend` und `./frontend` als Volume mounten und
> `deno task dev` im Container laufen lassen.

## Branch / Commit / PR Workflow

- `upstream` = louislam/its-mytabs (read-only für uns).
- Für einen Upstream-PR:
  1. Fork von louislam/its-mytabs auf GitHub anlegen (einmalig).
  2. `git remote add fork <dein-fork-url>` (oder `origin` umbenennen).
  3. Feature-Branch erstellen: `git checkout -b feat/xyz upstream/master`
     (sauber von Upstream abzweigen, nicht vom Dev-Setup-Branch).
  4. Änderungen committen, `git push fork feat/xyz`.
  5. PR auf GitHub von `fork/feat/xyz` → `louislam/its-mytabs:master` öffnen.
- Der `dev`-Branch hier enthält zusätzlich die Dev-Setup-Änderungen
  (Dockerfile/compose für Port 7778 + Local-Build), die **nicht** in den
  Upstream-PR gehören.

## Credentials (identisch zu Prod, da DB kopiert)
- **Benutzer:** `fox@home.local`
- **Passwort:** `foxfoxfox`
- **URL:** <http://localhost:7778>

## Gotchas
- Build schlägt fehl, wenn im Builder-Stage `deno.jsonc` fehlt (vite.config
  liest `../deno.jsonc` für `appVersion`). Ist im Dev-Dockerfile gefixt.
- Der Cache-Warmup `deno -A main.ts` im Release-Stage wirft einen harmlosen
  `Module not found "file:///app/main.ts"` (main.ts liegt in /app/backend) —
  durch `|| exit 0` abgefangen, wie im Upstream.
