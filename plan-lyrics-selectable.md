# Plan: Lyrics-per-Track Management (Issue #2441)

**Goal:** Allow users to select which track provides lyrics, and show those lyrics as an overlay on all tracks.

**Architecture:** Copy `beat.lyrics` from a designated source track to all other tracks at score-load time. alphaTab then renders lyrics natively on every track.

---

## Task 1: Backend — Schema & Routes

**Files:**
- `backend/zod.ts`
- `backend/tab.ts`
- `backend/main.ts`

**Steps:**

1. In `backend/zod.ts`, add a `LyricsConfigSchema`:
   ```ts
   export const LyricsConfigSchema = z.object({
       sourceTrackID: z.number().default(-1),
       enabled: z.boolean().default(false),
   });
   export type LyricsConfig = z.infer<typeof LyricsConfigSchema>;
   ```
   - `sourceTrackID: -1` = auto-detect (first track with lyrics)
   - `sourceTrackID: -2` = disabled (no lyrics overlay)
   - `enabled: true` = copy lyrics to all tracks on render

2. Add `lyrics: LyricsConfigSchema.default({})` to `ConfigJSONSchema`.

3. In `backend/tab.ts`, add `updateLyricsConfig(id: string, data: LyricsConfig)` using `updateConfigJSON`.

4. In `backend/tab.ts`, update `createTab()` to initialize `lyrics: { sourceTrackID: -1, enabled: false }` in the new config.

5. In `backend/main.ts`, add two routes:
   ```
   GET  /api/tab/:id/lyrics     → returns lyrics config from config.json
   POST /api/tab/:id/lyrics     → updates lyrics config { sourceTrackID, enabled }
   ```
   - GET: read config.json, return `config.lyrics`
   - POST: parse body with `LyricsConfigSchema`, call `updateLyricsConfig()`

**Verification:**
- `curl http://localhost:7778/api/tab/1/lyrics` → `{ ok: true, lyrics: { sourceTrackID: -1, enabled: false } }`
- `curl -X POST -H "Content-Type: application/json" -d '{"sourceTrackID": 0, "enabled": true}' http://localhost:7778/api/tab/1/lyrics` → `{ ok: true }`

---

## Task 2: Frontend — Lyrics Detection in scoreLoaded

**File:** `frontend/src/pages/Tab.vue`

**Steps:**

1. Add to component `data()`:
   ```ts
   lyricsTracks: [],       // track indices that have lyrics
   lyricsConfig: { sourceTrackID: -1, enabled: false },
   ```

2. In `scoreLoaded` hook (after `this.tracks = []` and track population loop), add lyrics detection:
   ```ts
   // Detect which tracks have lyrics
   const tracksWithLyrics: number[] = [];
   score.tracks.forEach((track, trackIndex) => {
       let hasLyrics = false;
       for (const staff of track.staves) {
           for (const bar of staff.bars) {
               for (const voice of bar.voices) {
                   for (const beat of voice.beats) {
                       if (beat.lyrics && beat.lyrics.length > 0) {
                           hasLyrics = true;
                           break;
                       }
                   }
                   if (hasLyrics) break;
               }
               if (hasLyrics) break;
           }
           if (hasLyrics) break;
       }
       if (hasLyrics) tracksWithLyrics.push(trackIndex);
   });
   this.lyricsTracks = tracksWithLyrics;
   ```

3. Load lyrics config from API in `load()`:
   ```ts
   const lyricsRes = await fetch(baseURL + `/api/tab/${this.tabID}/lyrics`, { credentials: "include" });
   if (lyricsRes.ok) {
       const lyricsData = await lyricsRes.json();
       this.lyricsConfig = lyricsData.lyrics || { sourceTrackID: -1, enabled: false };
   }
   ```

**Verification:**
- Open a tab with lyrics → `lyricsTracks` populated with correct track indices
- Check console/logs for detected tracks

---

## Task 3: Frontend — Lyrics Copy Engine

**File:** `frontend/src/pages/Tab.vue`

**Steps:**

1. Add method `applyLyricsOverlay()`:
   ```ts
   applyLyricsOverlay() {
       if (!this.api?.score) return;
       
       // Determine source track
       let sourceTrackID = this.lyricsConfig.sourceTrackID;
       if (sourceTrackID === -1) {
           // Auto-detect: first track with lyrics
           sourceTrackID = this.lyricsTracks.length > 0 ? this.lyricsTracks[0] : -1;
       }
       if (sourceTrackID < 0) return;
       
       const score = this.api.score;
       const sourceTrack = score.tracks[sourceTrackID];
       if (!sourceTrack) return;
       
       // Build tick → lyrics map from source track
       const lyricsMap = new Map<number, string[]>();
       for (const staff of sourceTrack.staves) {
           for (const bar of staff.bars) {
               for (const voice of bar.voices) {
                   for (const beat of voice.beats) {
                       if (beat.lyrics && beat.lyrics.length > 0) {
                           lyricsMap.set(beat.absoluteStart, [...beat.lyrics]);
                       }
                   }
               }
           }
       }
       
       // Copy to all other tracks
       for (const track of score.tracks) {
           if (track.index === sourceTrackID) continue;
           for (const staff of track.staves) {
               for (const bar of staff.bars) {
                   for (const voice of bar.voices) {
                       for (const beat of voice.beats) {
                           const lyrics = lyricsMap.get(beat.absoluteStart);
                           if (lyrics) {
                               beat.lyrics = [...lyrics];
                           }
                       }
                   }
               }
           }
       }
   }
   ```

2. Call `applyLyricsOverlay()` in `scoreLoaded` after `renderTracks()`.

3. Also call it in `changeTrack()` after `renderTracks()`.

**Verification:**
- Open tab with lyrics on track 0
- Enable lyrics overlay → lyrics appear on all tracks
- Switch tracks → lyrics persist

---

## Task 4: Frontend — Track Selector UI

**File:** `frontend/src/pages/Tab.vue` (template section)

**Steps:**

1. In the track dropdown list, add a "Lyrics" button per track:
   ```html
   <div class="list-button lyrics" 
        v-if="lyricsTracks.includes(track.id)"
        :class="{ active: lyricsConfig.sourceTrackID === track.id }"
        @click.stop="setLyricsSource(track.id)">
       Lyrics
   </div>
   ```

2. Add method `setLyricsSource(trackID)`:
   ```ts
   async setLyricsSource(trackID) {
       if (this.lyricsConfig.sourceTrackID === trackID) {
           // Toggle off if same track clicked
           this.lyricsConfig.sourceTrackID = -2;
           this.lyricsConfig.enabled = false;
       } else {
           this.lyricsConfig.sourceTrackID = trackID;
           this.lyricsConfig.enabled = true;
       }
       await this.saveLyricsConfig();
       this.applyLyricsOverlay();
       this.api.renderTracks([this.api.score.tracks[this.selectedTrack]]);
   }
   ```

3. Add method `saveLyricsConfig()`:
   ```ts
   async saveLyricsConfig() {
       try {
           await fetch(baseURL + `/api/tab/${this.tabID}/lyrics`, {
               method: "POST",
               credentials: "include",
               headers: { "Content-Type": "application/json" },
               body: JSON.stringify(this.lyricsConfig),
           });
       } catch (e) {
           generalError(e);
       }
   }
   ```

4. Add CSS for `.lyrics` button (similar to `.solo` and `.mute`).

**Verification:**
- Track list shows "Lyrics" on tracks that have lyrics
- Click "Lyrics" → enables overlay, highlights button
- Click again → disables overlay

---

## Task 5: Frontend — Persistence & Polish

**File:** `frontend/src/pages/Tab.vue`

**Steps:**

1. Ensure `load()` fetches lyrics config (already in Task 2).

2. Ensure `saveLyricsConfig()` is called whenever config changes (Task 4).

3. Add a small lyrics indicator in the toolbar (optional):
   ```html
   <span class="lyrics-indicator" v-if="lyricsConfig.enabled">
       Lyrics: {{ tracks[lyricsConfig.sourceTrackID]?.name || 'Auto' }}
   </span>
   ```

4. Handle edge case: if source track has lyrics on beats that don't exist on target track, skip gracefully (already handled by `absoluteStart` matching).

**Verification:**
- Reload page → lyrics config persists
- Switch tabs → config is per-tab
- New tabs default to auto-detect

---

## Task 6: Testing & Edge Cases

**Steps:**

1. Test with a GP file that has lyrics on track 0 only.
2. Test with a GP file that has no lyrics at all.
3. Test with a GP file that has lyrics on multiple tracks.
4. Test track switching with lyrics enabled.
5. Test reload persistence.
6. Test with `sourceTrackID: -2` (disabled) → no lyrics shown.
7. Verify no console errors.

---

## Current State

- [x] Task 1: Backend — Schema & Routes ✅ 2026-07-20
- [x] Task 2: Frontend — Lyrics Detection ✅ 2026-07-20
- [x] Task 3: Frontend — Lyrics Copy Engine ✅ 2026-07-20
- [x] Task 4: Frontend — Track Selector UI ✅ 2026-07-20
- [x] Task 5: Frontend — Persistence & Polish ✅ 2026-07-20 (embedded in Tasks 2+4)
- [x] Task 6: Testing & Edge Cases ✅ 2026-07-20

**Started:** 2026-07-20
**Last Updated:** 2026-07-20 (all tasks complete)
