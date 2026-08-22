# Playerinyo

Yerel müzik arşivleri için Electron tabanlı vibecoded masaüstü oynatıcı.

## Features

- Local library, album views, and playlists
- Gapless playback and crossfade with dual audio channels
- Last.fm-powered Radio and YouTube-based remote playback
- Downloads, metadata/artwork editing, and lyrics
- Listening statistics, likes, backups, and restore

## Start

```bash
npm install
npm start
```

## Test

```bash
npm test
```

## Optional download tools

Local-library playback does not need extra tools. To use YouTube-based remote
playback or download features, install both **yt-dlp** and **ffmpeg**, and make
sure their commands are available on your system `PATH`. If either is missing,
those optional features are unavailable; your local library remains usable.

## Releases

GitHub Releases publishes these desktop packages when a version tag such as
`v0.1.0` is pushed:

- **Windows 10/11 (x64):** `Playerinyo-windows-x64.zip` — portable application;
  extract it and launch `playerinyo.exe`.
- **Linux (x64):** `Playerinyo-linux-x64.tar.gz` — portable application folder.
  Extract it, then run `playerinyo` from the extracted directory.
- **macOS (Apple Silicon):** `Playerinyo-macos-arm64.zip` — extract and move
  `Playerinyo.app` to Applications.
- **macOS (Intel):** `Playerinyo-macos-x64.zip` — extract and move
  `Playerinyo.app` to Applications.

macOS packages are not yet code-signed or notarized, so users may need to
approve the first launch in **System Settings → Privacy & Security**.

Supported future Linux distribution formats are **AppImage** (best general
download), **DEB** (Debian/Ubuntu), **RPM** (Fedora/openSUSE), **Flatpak**, and
native archives. This repository currently publishes the universal tar.gz
archive; the existing desktop-entry helper is intended for local Linux use.

### Create a local Linux package

```bash
npm run package
npm run linux:install-desktop
```

### Create a local Windows package

Run this in Windows PowerShell:

```powershell
npm.cmd install
npm.cmd run package:windows
```

The output is `out/Playerinyo-win32-x64/`.

### Create a local macOS package

Run this on a Mac. The default command targets Apple Silicon:

```bash
npm install
npm run package:mac
```

For an Intel Mac, use `node scripts/package.js --platform=darwin --arch=x64`.

Application code lives in `app/`, tests in `test/`, and documentation in `docs/`.
