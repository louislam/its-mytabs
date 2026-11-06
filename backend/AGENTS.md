# Backend Coding Standards

Read this before changing files in `backend/`, along with the repository root `AGENTS.md`.

## Architecture

- Keep HTTP behavior in Hono routes, domain/file operations in modules such as `tab.ts`, persistence setup in `db.ts`, auth behavior in `auth.ts`, and environment/path helpers in `util.ts`.
- Prefer extending existing modules over adding new cross-cutting abstractions.
- Keep route responses consistent with the current `{ ok: true, ... }` and error JSON patterns.

## Validation And Security

- Parse request JSON and persisted config through schemas in `zod.ts`.
- Guard all path-derived values. Use `checkFilename` for IDs and filenames before composing paths under `dataDir` or `tabDir`.
- Keep private tab routes protected by `checkLogin`, `isLoggedIn`, public-tab checks, or temp-token logic as appropriate.
- Sanitize uploaded/original filenames and reject unsupported tab/audio extensions through `supportedFormatList` and `supportedAudioFormatList`.

## Persistence

- `config.json` is the canonical per-tab metadata file. Use `getConfigJSON` and `updateConfigJSON` for normal read/update flows.
- Avoid direct writes to `config.json` except in creation, migration, or narrowly controlled helpers.
- Preserve compatibility with existing user data under `DATA_DIR`; migrations must be idempotent and tolerate partial/manual files.

## Tests

- Tests that depend on env vars or filesystem state must set `DATA_DIR`, ports, and temporary directories before importing modules with top-level initialization.
- Use `Deno.test` and `@std/assert`. Clean up temp files and close servers in `afterAll` where applicable.
