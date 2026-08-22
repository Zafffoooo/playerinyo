# Changelog

All notable changes to Playerinyo are recorded in this file.

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
