# Page Standards

Read this before changing files in `frontend/src/pages/`, along with ancestor `AGENTS.md` files.

## Scope

- Pages own route-level workflows, API calls, and coordination between reusable components.
- Keep route params, query params, auth redirects, and public/private tab behavior explicit and easy to trace.
- For tab playback changes, preserve alphaTab lifecycle handling, socket behavior, wake-lock handling, keyboard shortcuts, and cleanup.

## Forms And API Calls

- Use existing helper functions for base URLs, fetch checks, notifications, and generic error display.
- Validate and normalize data before submitting it. Keep backend expectations and frontend form state in sync.
- Maintain mobile usability for the tab player and admin forms.
