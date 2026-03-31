# Changelog

## Unreleased

### New Features

#### Multi-track Display
- Select and display up to 4 tracks simultaneously (e.g. guitar tab + flute score stacked vertically)
- Toggle individual tracks on/off with a "Show/Shown" button per track row
- Primary track (for cursor navigation) is set by clicking the track name
- Track count badge in toolbar shows when multiple tracks are active
- URL param `?track=` now accepts comma-separated IDs (e.g. `?track=0,2`) for sharing multi-track views
- Backward compatible: single track ID still works

#### Auto Style Mode (new default)
- New "Auto" style setting: automatically shows tab notation for stringed instruments (guitar, bass) and standard notation for everything else (flute, violin, piano, etc.)
- Enables mixed-notation files to render correctly without manual configuration
- MXL/MusicXML files (notation-only) now render properly in auto mode

#### MusicXML (.mxl) Format Support
- Added `.mxl` to the list of supported upload formats

#### Playlists
- Create and manage playlists of tabs
- Drag-to-reorder tabs within a playlist
- Add/remove tabs from a playlist
- Play from playlist context with prev/next navigation buttons in the player
- Auto-advance: optionally navigate to the next tab automatically when playback ends
- New `/playlist/:id` page

#### File Manager Improvements
- Sort tabs by: Date Added (newest/oldest), Title (A–Z), Artist (A–Z)
- Tag tabs with custom labels; filter tab list by tag
- Bulk select mode: select multiple tabs, delete or add to playlist in bulk
- "Select All" / "Deselect All" in bulk mode
- Playlists section on the home page

#### Track Name Display
- Track names on staves now show the MIDI instrument name (e.g. "Overdriven Guitar") instead of the raw file metadata name
- Short abbreviations used in stave margins for readability (e.g. "Gtr", "Bass", "Flute", "Str")

### Settings
- Added "Auto" style option (now the default)
- Added "Sort tabs by" preference
- Added "Auto-advance to next tab in playlist" toggle

## 1.6.2

- fmt

## 1.6.1 — 1.6.0

- fix: regression bug, remember the selected track
- fix: drum score is not able to render
- Add ability to load/save settings to server
- Allow track switching during playback
