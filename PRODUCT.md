# Product

<!-- impeccable:product-schema 1 -->

## Platform

desktop

## Users

Playerinyo is primarily for local music collectors managing and listening to a personally owned library on a desktop computer.

## Product Purpose

Playerinyo gives listeners one place to import, organize, maintain, and play music stored on their own computer. Success means the core library and playback experience remains useful without a network connection while optional online services add discovery, metadata, lyrics, and sharing features.

## Positioning

Playerinyo combines ownership and control of local music files with conveniences commonly associated with streaming players. Local files remain the source of truth; network integrations enhance the library rather than replacing it.

## Operating Context

- The user imports one or more music folders into a persistent desktop library, then rescans those folders as files change.
- The user browses albums and tracks, searches the library, creates playlists, manages a queue, and controls playback from the main window, local keyboard shortcuts, or supported operating-system media controls.
- The desktop destination dock has a persisted compact mode and a safe-width expanded mode. Compact mode fills its available height with whole playlist covers; expanded mode uses an internally scrolling four-column playlist shelf with pinned playlists before recent playlists. The Listening Studio keeps compact Up Next and volume controls visible across central views.
- The user may inspect and repair metadata, artwork, missing files, and ReplayGain information as part of maintaining the collection.
- Optional connected workflows include metadata lookup, synchronized lyrics, Last.fm recommendations and scrobbling, Discord Rich Presence, and download assistance.

## Capabilities and Constraints

- Playerinyo is a plain Electron CommonJS desktop application with a renderer built from `index.html`, `style.css`, and `renderer.js`.
- The library scans and plays MP3, FLAC, M4A, and WAV files. Metadata writing is supported for MP3 and FLAC; M4A and WAV must not be presented as writable unless support is added.
- Library, playlist, mapping, liked-song, and settings data is persisted locally under Electron's per-user data directory. Cached covers are also local.
- Core local-library browsing and playback must remain independent of optional network services. Network failure or missing credentials must not block local use.
- Existing workflows include playlist review plus CSV, M3U, and M3U8 import/export, backup and restore, metadata health tools, album and track metadata editing, artwork handling, queueing, search, favorites, lyrics, ReplayGain normalization, equalizer controls, crossfade, a visualizer, and a now-playing view.
- Playback sessions persist the base queue, user-added Up Next tracks, shuffle order, repeat mode, selected track, playback position, and an optional true source-playlist identity. Relaunch restores that context paused so playback never starts unexpectedly, and browsing another view does not change which playlist receives playback recency.
- Local playback shortcuts use `Space` for play/pause, `Ctrl/Cmd + Left/Right` for previous/next, and `Ctrl/Cmd + Up/Down` for volume. Playerinyo does not register global shortcuts or provide a separate mini-player window.
- Optional integrations include MusicBrainz and other configured metadata sources, LRCLIB, Last.fm, Discord Rich Presence, platform media controls, and download assistance through user-installed `yt-dlp` and `ffmpeg` tools.
- Filesystem access is mediated by Electron IPC. Future work must preserve path validation, restricted external URL handling, sensitive-setting protection, and local data integrity safeguards.
- Folder rescans preserve known library entries when a source folder is missing or inaccessible rather than treating an empty scan as deletion.
- Moved audio files are relinked only through a reviewable, tokenized preview; selected path changes are revalidated, safety-backed up, and committed atomically across library, playlist, favorite, mapping, queue, history, and path-keyed settings data.
- Non-empty libraries receive a validated local backup at most once per day by default; Playerinyo keeps the newest seven automatic backups and creates separate safety backups before app-data restores.

## Brand Commitments

- The product name is **Playerinyo**.
- The product description is **Offline music player**.
- Existing application and taskbar icons are product assets and should be preserved unless the user requests a rebrand.

## Evidence on Hand

- The working product implementation and current factual UI copy are in `main.js`, `preload.js`, `index.html`, `renderer.js`, and `style.css`.
- The application icon is at `assets/icon.png`; Windows taskbar playback icons are under `assets/taskbar/`.
- Packaging and app identity are defined in `package.json`; Linux installation behavior is documented in `LINUX_LOCAL_INSTALL.md`.
- No testimonials, customer logos, usage benchmarks, press coverage, pricing, or other external proof are present. Future work must not fabricate them.

## Product Principles

1. Keep local ownership at the center: the user's files and library remain authoritative.
2. Make connected features additive: the player stays useful when integrations are unavailable.
3. Pair everyday listening convenience with serious collection-management tools.
4. Protect the collection: preserve data, validate filesystem operations, and make destructive outcomes explicit.
