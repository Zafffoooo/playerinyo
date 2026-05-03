# AGENTS.md

## Project Shape
- This is a plain Electron CommonJS app, not a bundled frontend: `main.js` is the Electron main process, `preload.js` exposes `window.api`, `index.html` loads `renderer.js`, and `style.css` is the only stylesheet.
- There is no root README, lint config, test config, CI workflow, or existing agent instruction file at the time of writing; trust `package.json` and the source files.
- Persistent app data is stored under `app.getPath('userData')` as `library.json`, `playlists.json`, `mappings.json`, `settings.json`, plus cached covers in `covers/`.

## Commands
- Use `npm.cmd` on Windows PowerShell; plain `npm` may hit the local script execution policy.
- Run the app with `npm.cmd start`.
- Package with `npm.cmd run package`.
- Focused syntax checks: `node --check "main.js"`, `node --check "preload.js"`, `node --check "renderer.js"`.
- Production dependency audit: `npm.cmd audit --omit=dev`. Full `npm.cmd audit` may report Electron Forge dev-toolchain advisories even when production audit is clean.

## App-Specific Gotchas
- `music-metadata` is ESM-loaded via dynamic `import()` in `main.js`; keep `mm` as the loaded module object and call `mm.parseFile(...)`.
- Metadata writing supports MP3 through `node-id3` and FLAC through the local Vorbis comment/PICTURE writer in `main.js`; M4A/WAV can be scanned/played but should not be presented as writable unless support is explicitly added.
- IPC handlers that accept paths should keep the existing absolute-path, existence, file type, and extension checks in `main.js`; do not loosen renderer-exposed filesystem access.
- `open-external` is intentionally restricted to `https:` URLs.
- Folder import merges scanned files into the existing library; rescan preserves old entries when folders are missing/inaccessible and warns the user instead of deleting them.
- Album identity is centralized in `renderer.js` via `getAlbumKey(file)` using `album::albumArtist-or-artist`; use it for album maps/navigation to avoid compilation album bugs.
- Playback uses two hidden audio elements for crossfade; changes around `activeAudioIdx`, `audioGainNodes`, or `state.crossfadingNext` can easily break next/previous and crossfade behavior.
- The visualizer animation loop is designed to stop while idle; if changing EQ/visualizer code, avoid reintroducing an always-running `requestAnimationFrame` loop.

## Verification Before Hand-Off
- At minimum after code changes, run the three `node --check` commands and `npm.cmd audit --omit=dev`.
- For scan/rescan changes, manually reason about missing folders: existing library entries should be preserved, not replaced by an empty scan result.
