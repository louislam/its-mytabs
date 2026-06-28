# Font Asset Standards

Read this before changing files in `frontend/public/font/`, along with ancestor `AGENTS.md` files.

## Bravura Font Files

- These are vendored Bravura font artifacts and license/docs files.
- Preserve the OFL license, FAQ, and FONTLOG files.
- Do not regenerate, subset, rename, or replace font binaries unless the task explicitly targets font packaging.
- If a font file changes, verify every referenced format still works for browsers supported by the app.
