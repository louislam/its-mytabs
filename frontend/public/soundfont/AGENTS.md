# Soundfont Asset Standards

Read this before changing files in `frontend/public/soundfont/`, along with ancestor `AGENTS.md` files.

## Soundfont Files

- These are vendored Sonivox soundfont assets used by playback.
- Preserve `README.md`, `LICENSE`, and existing filenames unless all alphaTab/playback references are updated.
- Treat `.sf2` and `.sf3` files as binary assets. Do not compress, normalize, or replace them as part of unrelated changes.
