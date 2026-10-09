# Extra Directory Standards

Read this before changing files in `extra/`, along with the repository root `AGENTS.md`.

## Purpose

- This directory contains build scripts, packaging helpers, Docker entrypoint support, controller utilities, demo assets, templates, and the seed database.
- Keep scripts runnable through the tasks defined in the root `deno.jsonc`.

## Practices

- Prefer Deno/Node APIs already used in the existing scripts; do not introduce a separate build framework for small helpers.
- Preserve executable behavior of shell scripts and Docker entrypoint assumptions.
- Treat `.gp` tab templates, demo files, and `config-template.db` as binary/runtime assets. Replace them only when the task explicitly calls for it.
- Keep Docker/build helper changes compatible with the root `Dockerfile` and `compose.yaml`.
