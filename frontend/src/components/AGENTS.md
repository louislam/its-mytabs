# Component Standards

Read this before changing files in `frontend/src/components/`, along with ancestor `AGENTS.md` files.

## Scope

- Components should be reusable UI pieces, not route-level workflow containers.
- Keep props, emits, and internal state explicit. Maintain existing `defineComponent` and Options API patterns.
- Avoid direct router navigation, broad API orchestration, or persistent storage changes from generic components unless the component already owns that responsibility.

## UI

- Prefer Bootstrap/Bootstrap Vue Next controls and FontAwesome icons used elsewhere in the app.
- Keep scoped styles local to the component. Move shared styling to `src/styles/` only when multiple components need it.
