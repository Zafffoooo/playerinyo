# Changelog

All notable changes to Playerinyo are recorded in this file.

## 0.1.4 — 2026-08-28

### Added

- Added rule-based Smart Playlists for artist, album, genre, year, duration, liked, and played filters.
- Added Daily Smart Playlists on Home: Günün Keşfi, Yeniden Dinle, and Hiç Çalmadıkların. They refresh each day, hold up to 50 tracks, and include at most two tracks from any album.
- Added track and album notes from context menus. Notes are included in collection search and follow files when relinked.
- Added mouse-wheel volume adjustment and a compact Now Playing volume control.
- Added a source-playlist link in Listening Studio, so you can return to the playing playlist without interrupting playback.
- Added ESLint, a regression CI workflow, and a restored 44-test suite.

### Changed

- Reworked the renderer into reviewable classic-script slices while keeping the app bundler-free.
- Unified Smart Playlist cards with regular playlist sleeve sizing and refined Smart Playlist, note, and metadata form fields.
- Updated Electron to 44 and rebuilt the local native socket dependency for the current Electron ABI.

### Fixed

- Made the release pipeline verify tests, lint, and production dependencies once before cross-platform packaging, so platform-specific test-runner differences do not block valid release artifacts.
- Restored the Ctrl/Cmd+K command palette from focused controls and made the global-search clear button neutral white.
- Replaced renderer native alert/confirm dialogs with the in-app notification and modal system.
- Added explanations for intentionally silent main-process cleanup catches and surfaced meaningful failures.

## 0.1.3 — 2026-08-23

### Added

- Added album download entry point and an accessible library sort picker.

### Fixed

- Metadata fields can now be cleared reliably in FLAC, Ogg, and Opus files.
- Downloads reuse matching artist and album directories without creating duplicate folders.
- Fixed playlist detail search layout and restored F12 DevTools toggling without opening DevTools at launch.

## 0.1.2 — 2026-08-22

### Fixed

- Correctly rewrite album metadata in Opus and Ogg files. Existing Vorbis comments are retained, while the fields being edited are replaced rather than silently left at their old values.
- Verify title, artist, album, and album-artist tags immediately after saving, so a failed write is reported before a library rescan can restore stale metadata.

## 0.1.1 — 2026-08-22

### Fixed

- Made album multi-select mode visibly active, including a clear state label and accessible pressed state.
- Kept the current view open after removing an album from the library; removing an album from Home now refreshes Home instead of navigating to Library.

## 0.1.0 — Unreleased

### Added

- Portable release packaging for Linux x64, Windows x64, macOS Apple Silicon, and macOS Intel.
- GitHub Release automation triggered by version tags.
- Optional update notification that checks GitHub Releases without downloading anything automatically.
- Documentation for the optional `yt-dlp` and `ffmpeg` tools.

### Notes

- `yt-dlp` and `ffmpeg` are required only for YouTube remote playback and downloads.
- Local-library playback works without those tools.
- macOS portable builds are not code-signed or notarized yet.
