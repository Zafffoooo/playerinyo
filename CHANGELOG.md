# Changelog

All notable changes to Playerinyo are recorded in this file.

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
