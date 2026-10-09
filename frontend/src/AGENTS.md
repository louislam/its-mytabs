# Frontend Source Standards

Read this before changing files in `frontend/src/`, along with ancestor `AGENTS.md` files.

## Vue And TypeScript

- Follow the existing Vue Options API style in `.vue` files unless a local file already uses another pattern.
- Keep reusable logic in `app.ts`, `util.ts`, `auth-client.ts`, or focused helpers rather than duplicating it across pages.
- Preserve current import style. Components often import local TypeScript modules through `.js` paths for Vite/Deno compatibility.

## User Experience

- Build functional UI first, not marketing copy. Keep controls compact and consistent with Bootstrap/Bootstrap Vue Next.
- Use FontAwesome icons where the app already uses icon buttons.
- Avoid visible instructional text that explains implementation details. User-facing text should describe app concepts and actions.

## API And Errors

- Use `baseURL`, `checkFetch`, `successMessage`, and `generalError` for fetch and notification flows.
- Keep frontend data validation aligned with Zod schemas and backend response shapes.
- Avoid direct global state mutation except existing app-level integration points such as `window.isDemo`.
