# Frontend Coding Standards

Read this before changing files in `frontend/`, along with the repository root `AGENTS.md`.

## Project Shape

- This is a Vue 3 + Vite frontend managed by Deno tasks. Build output goes to the repository-level `dist/` directory.
- Do not edit generated `dist/` output. Change source files under `src/` and rebuild instead.
- Keep dependencies declared in `package.json`; avoid adding packages unless they remove real complexity and fit the existing Vue/Bootstrap/alphaTab stack.

## Tooling

- Use `frontend/deno.jsonc` formatting rules: 4 spaces, semicolons, double quotes, 200-character line width.
- Prefer `cd frontend && deno task build` for frontend build verification and root `deno task check` for repository-level checks.

## Runtime Conventions

- Preserve Vite config behavior: app version comes from the root `deno.jsonc`, alphaTab plugin stays enabled, and built assets target `../dist`.
- Keep dev backend access routed through the existing base URL logic rather than hardcoding new origins.
