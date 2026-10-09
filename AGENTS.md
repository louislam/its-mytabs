# Repository Coding Standards

Read this file before changing anything in this repository. Also read any more specific `AGENTS.md` file in the directory you are editing.

## Project Shape

- This is a Deno 2 app with a Hono backend in `backend/`, a Vue 3/Vite frontend in `frontend/`, and build/runtime helper scripts in `extra/`.
- Do not edit generated or runtime output such as `dist/`, `data/`, `node_modules/`, coverage folders, or temporary build artifacts unless the task explicitly targets them.
- Keep backend/frontend contracts centralized through shared schemas and types. Prefer updating `backend/zod.ts`, `frontend/src/zod.ts`, and `backend/common.ts` over duplicating shape definitions.

## Formatting And Style

- Use the repository Deno formatter settings: 4-space indentation, semicolons, double quotes, and the configured 200-character line width.
- Preserve the existing TypeScript style: explicit imports, local helper functions, small modules, and direct Deno/std APIs where they are already used.
- Keep changes narrowly scoped. Do not reformat unrelated code or perform opportunistic refactors.
- Use ASCII in new text unless the existing file or domain content requires otherwise.

## Safety And Data Handling

- Validate external input with Zod or existing validators before using it.
- Treat filenames, tab IDs, uploaded files, and user-provided media metadata as untrusted. Reuse existing helpers such as `checkFilename`, `checkAudioFormat`, and schema parsers.
- Preserve authentication and privacy behavior. Private tab data must stay protected unless the code path explicitly handles public tabs or temp tokens.
- Avoid changing persistent data formats without migration/backward-compatibility handling.

## Verification

- Prefer focused checks for the touched area, then broader checks when behavior crosses backend/frontend boundaries.
- Useful commands:
  - `deno task check`
  - `deno task test`
  - `deno task build-frontend`
  - `cd frontend && deno task build`
- If a check cannot be run, document why and describe the residual risk.
