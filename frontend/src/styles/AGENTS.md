# Style Standards

Read this before changing files in `frontend/src/styles/`, along with ancestor `AGENTS.md` files.

## SCSS

- Keep global styles intentional. Component-only rules belong in scoped component styles.
- Reuse variables from `vars.scss` and Bootstrap color-mode mixins where appropriate.
- Preserve alphaTab selector behavior for cursor, highlight, and selection styles.
- Avoid broad overrides that change all Bootstrap controls unless the change is deliberate and tested across light/dark modes.
