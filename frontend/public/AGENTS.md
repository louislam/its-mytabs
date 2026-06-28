# Public Asset Standards

Read this before changing files in `frontend/public/`, along with ancestor `AGENTS.md` files.

## Assets

- Files here are served as static frontend assets. Preserve stable filenames and paths unless all references are updated.
- Keep licenses, font metadata, and third-party asset documentation with the assets they describe.
- Avoid modifying binary assets unless the task explicitly requires it. Prefer adding a clearly named replacement over silently changing vendored files.

## References

- Check references from Vue components, Vite config, Docker/build scripts, and the README before moving or renaming assets.
