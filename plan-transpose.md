# Plan: Transpose Control for MyTabs (Dev)

**Status:** Draft
**Target:** `projects/2026-07-mytabs-dev`, branch `dev`

## Goal

Add a transposition control to the MyTabs player UI, analogous to the existing
"Speed" control. The control lets the user shift the pitch of all tracks up or
down in semitone steps, applied live during playback.

## Current State

- alphaTab 1.8.0 **already provides** audio transposition via
  `api.changeTrackTranspositionPitch(tracks, semitones)`.
- This API sets the **absolute** transposition for the given tracks in semitones
  (not a delta). It works live during playback.
- MyTabs currently does **not** expose this feature in the GUI. There is no
  transpose slider, button, or setting anywhere in `Tab.vue`.

## Proposed Design

### UI Layout

Place the transpose control directly after the "Speed" control in the player
toolbar (line ~1511 of `Tab.vue`):

```
Speed:  [number input] (%)    [-]  0  [+]    Transpose
```

- `[-]` button: decrement transpose by 1 semitone
- `[+]` button: increment transpose by 1 semitone
- Center label: current transpose value in semitones (e.g., `0`, `-1`, `+2`)
- Optional: long-press or shift-click for ±12 (one octave) — nice-to-have

### Behavior

| Action | Result |
|--------|--------|
| Click `-` | All tracks transpose down 1 semitone |
| Click `+` | All tracks transpose up 1 semitone |
| Reload tab | Transpose resets to persisted value (default 0) |
| Change track | Transpose stays at current value (global) |

### Data Flow

```
[-] / [+] click
  → this.transpose += delta       (watch in Vue)
    → api.changeTrackTranspositionPitch(this.api.score.tracks, newAbsoluteValue)
    → this.setConfig("transpose", newAbsoluteValue)
```

### Implementation Details

#### Reactive Data

Add to component `data()`:
```ts
transpose: 0,
```

#### Watcher (mirrors `speed()` watcher, ~line 250)

```ts
transpose(newVal: number) {
    if (!this.api || !this.api.score || !this.api.score.tracks) {
        return;
    }

    // Clamp to a sensible range (one octave up/down)
    let value = Math.max(-12, Math.min(12, newVal));

    // alphaTab's API takes the ABSOLUTE semitone value, not a delta
    this.api.changeTrackTranspositionPitch(
        this.api.score.tracks,
        value
    );

    this.setConfig("transpose", value);
},
```

#### Template (after Speed control, ~line 1511)

```html
<div class="select-percentage">
    <button class="btn btn-secondary" @click="transpose--">−</button>
    <span class="transpose-value" @click="transpose = 0">{{ transpose > 0 ? '+' : '' }}{{ transpose }}</span>
    <button class="btn btn-secondary" @click="transpose++">+</button>
</div>
```

Clicking the center value resets transpose to 0 (convenient "home" gesture).

#### Persistence

Reuse existing `setConfig` / `getConfig` helpers (line ~1363):

```ts
// On tab load (~line 685):
this.transpose = this.getConfig("transpose", 0);
```

alphaTab stores transposition internally on the score model. The localStorage
value ensures the transpose survives tab switches and page reloads.

### CSS

Reuse `.select-percentage` class (already at line 1815). Add a small rule for
the center value to make it clickable and readable:

```css
.transpose-value {
    min-width: 2.5rem;
    text-align: center;
    font-weight: bold;
    cursor: pointer;
}
```

Alternatively, use a Bootstrap button-group (`btn-group`) for a more polished
look with the three parts visually merged.

## Limitations

- **YouTube / External Audio:** `changeTrackTranspositionPitch` only affects the
  internal synthesizer. When a YouTube video is the active audio source, the
  transpose has no effect on the video playback pitch. The notation display can
  be visually transposed (via `displayTranspositionPitches`), but the audio stays
  at original pitch. This is acceptable for v1 — most bass tabs use the synth.
- **Absolute vs. Delta:** alphaTab's API takes absolute semitones, not deltas.
  The watcher must compute the absolute value before calling the API.
- **No per-track transpose in v1:** Fox asked for "all tracks -1 or so", so the
  control is global across all tracks in the score. Per-track transpose can be
  added later via the existing track-list panel (solo/mute/volume pattern).
- **GP files with explicit transposition:** Some Guitar Pro files already embed
  transposition info per track. alphaTab applies this on load. The UI transpose
  stacks on top (tested behavior — if not, we may need to read the initial value
  from `track.playbackInfo.transpose` after score load).

## Files to Modify

| File | Change |
|------|--------|
| `frontend/src/pages/Tab.vue` | Add `transpose` data, watcher, template block, load logic |
| `frontend/src/pages/Tab.vue` (CSS) | Add `.transpose-value` style |

Backend and API are **not** affected.

## Open Questions

1. **Range limit:** ±12 semitones (one octave) is safe. Should the limit be
   configurable or wider?
2. **Per-track vs. global:** Start with global (Fox's request). Can extend to
   per-track via the track list panel later.
3. **Visual-only transpose when YouTube is active:** Should we show a small
   indicator (e.g., muted "T" badge) when transpose won't affect audio? Or just
   let it silently no-op for the user to discover?
4. **Keyboard shortcut:** Map `[` / `]` to decrement/increment transpose, similar
   to existing shortcuts? Nice-to-have.

## Implementation Steps

1. Add `transpose: 0` to `data()` in `Tab.vue`.
2. Add `transpose()` watcher after the `speed()` watcher.
3. Add template block after the Speed input.
4. Add load logic in the score-load section (`getConfig("transpose", 0)`).
5. Add CSS for `.transpose-value`.
6. Build: `docker compose build && docker compose up -d`.
7. Test on a bass tab (e.g., Tab 1 "Hare no Hi ni"): click `+` and verify pitch
   rises by one semitone; reload and verify persistence; switch to YouTube audio
   and verify the limitation is accepted.
