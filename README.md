# Playerinyo

[Türkçe](#türkçe) · [English](#english) · [Downloads / İndir](https://github.com/Zafffoooo/playerinyo/releases/latest) · [Changelog](CHANGELOG.md)

## Türkçe

Yerel müzik arşivleri için Electron tabanlı vibecoded masaüstü oynatıcı.

## Özellikler

- Yerel kütüphane, albüm görünümleri, Smart Playlist ve çalma listeleri
- Çift ses kanalıyla boşluksuz oynatma ve crossfade
- Last.fm destekli Radyo, YouTube Music araması ve arama sonucundan Şarkı Radyosu
- İlerleme ve hata durumlarıyla İndirilenler sayfası, metadata/kapak görseli düzenleme ve şarkı sözleri
- Spotify hesap verisi ZIP/JSON dosyasından, herkese açık bağlantıdan veya bağlı hesaptan playlist aktarımı
- Sayfalı albüm kataloğu, sürüm başına şarkı sayıları ve ayrı yerel/çevrimiçi sanatçı görünümleri
- Playlist klasörleri, durum/tür filtreleri, çoklu seçim ve toplu taşıma
- Eksik şarkıları isteğe bağlı çevrimiçi eşleştirme, albüm bulma ve sürüm seçimi
- Sırayı playlist olarak kaydetme, tekrar inceleme ve sürükleme/yakınlaştırma ile kapak kırpma
- Dinleme istatistikleri, beğeniler, yedekleme ve geri yükleme

## Playlist kullanımı

- Tek tıkla seçin, çift tık veya Enter ile çalın. Ctrl/Cmd+tık ile seçime ekleyin/çıkarın; Shift+tık veya Shift+↑/↓ ile aralık seçin. Ctrl/Cmd+A görünen şarkıları seçer; boş alana tıklamak veya Escape seçimi temizler.
- Seçili şarkılara sağ tıklayarak sıraya/başka playliste ekleyin veya **Find missing tracks** ile eksikleri arayın. Toplu arama dosya indirmez ve şarkı çalmaz; eşleşmeyen sonuçlar sürüm seçimiyle incelenebilir.
- Soluk şarkıya çift tıklamak önce yerel eşleşmeyi, ardından güvenilir çevrimiçi eşleşmeyi dener. **Choose another version**, **Find album** ve **Clear online match** işlemleri sağ tık menüsündedir.
- **All / Local / Online / Missing** ve tür düğmeleri playlist aramasıyla birlikte çalışır. Filtreliyken sürükleyerek sıralama kapalıdır; **Custom Order** ve filtresiz görünümde seçili şarkıları blok olarak taşıyabilirsiniz.
- **New folder** ile tek seviyeli klasör oluşturun; playlisti sürükleyerek veya menüden klasöre taşıyın. Klasörü silmek playlistleri silmez.
- Sıra panelindeki **Save as playlist** kalan sırayı kaydeder; çalan şarkıyı dahil etmek isteğe bağlıdır.
- **Find duplicates** ile playlist kopyalarını inceleyin. Kapak değiştirirken görseli sürükleyip +/− ile kırpma alanını ayarlayın.

## Başlatma

```bash
npm install
npm start
```

## Test

```bash
npm test
```

## İsteğe bağlı indirme araçları

Yerel kütüphane oynatımı ek araca ihtiyaç duymaz. YouTube tabanlı uzaktan
oynatma veya indirme özelliklerini kullanmak için hem **yt-dlp** hem de
**ffmpeg** kurulu olmalı ve komutları sisteminizin `PATH` değişkeninde
bulunmalıdır. Araçlardan biri yoksa yalnızca bu isteğe bağlı özellikler
kullanılamaz; yerel kütüphaneniz çalışmaya devam eder.

## Spotify playlist aktarımı

**Import Playlist** menüsünden Spotify hesap verisi ZIP/JSON dosyası, herkese
açık playlist bağlantısı veya **Spotify account** seçilebilir. Hesap bağlantısı
için Spotify Developer uygulamasında `http://127.0.0.1:8888/callback` geri dönüş
adresi kayıtlı olmalı ve Spotify hesabı uygulamanın izinli kullanıcıları
arasında bulunmalıdır. Geliştirme modu sınırına takılan kullanıcılar hesap
verisi dosyasıyla kendi playlistlerini aktarabilir. Eşleşmeler kaydetmeden
önce incelenebilir; aktarım ses dosyalarını indirmez.

## Sürümler

GitHub Releases, `v0.1.0` gibi bir sürüm etiketi pushlandığında aşağıdaki
taşınabilir masaüstü paketlerini yayınlar:

- **Windows 10/11 (x64):** `Playerinyo-windows-x64.zip` — taşınabilir
  uygulama; arşivi çıkarıp `playerinyo.exe` dosyasını çalıştırın.
- **Linux (x64):** `Playerinyo-linux-x64.tar.gz` — taşınabilir uygulama
  klasörü; arşivi çıkarıp klasör içindeki `playerinyo` dosyasını çalıştırın.
- **macOS (Apple Silicon):** `Playerinyo-macos-arm64.zip` — arşivi çıkarıp
  `Playerinyo.app` uygulamasını Applications klasörüne taşıyın.
- **macOS (Intel):** `Playerinyo-macos-x64.zip` — arşivi çıkarıp
  `Playerinyo.app` uygulamasını Applications klasörüne taşıyın.

macOS paketleri henüz kod imzalı veya notarize değildir; kullanıcıların ilk
açılışı **System Settings → Privacy & Security** üzerinden onaylaması
gerekebilir.

Gelecekte desteklenebilecek Linux dağıtım biçimleri: **AppImage** (genel
kullanım için en uygun), **DEB** (Debian/Ubuntu), **RPM** (Fedora/openSUSE),
**Flatpak** ve yerel arşivlerdir. Bu depoda şimdilik evrensel `tar.gz` arşivi
yayınlanır; mevcut masaüstü girişi yardımcısı yerel Linux kurulumu içindir.

### Yerel Linux paketi oluşturma

```bash
npm run package:linux
npm run linux:install-desktop
```

### Yerel Windows paketi oluşturma

Windows PowerShell üzerinde şunu çalıştırın:

```powershell
npm.cmd install
npm.cmd run package:windows
```

Çıktı: `out/Playerinyo-win32-x64/`.

### Yerel macOS paketi oluşturma

Bunu bir Mac üzerinde çalıştırın. Varsayılan komut Apple Silicon hedefler:

```bash
npm install
npm run package:mac
```

Intel Mac için şu komutu kullanın:

```bash
node scripts/package.js --platform=darwin --arch=x64
```

---

## English

An Electron desktop player for local music collections, with optional online discovery and playback.

## Features

- Local library, album views, Smart Playlists, and playlists
- Gapless playback and crossfade with dual audio channels
- Last.fm-powered Radio, YouTube Music search, and Song Radio from search results
- Downloads page with progress and error states, metadata/artwork editing, and lyrics
- Spotify playlist import from account-data ZIP/JSON, public link, or connected account
- Paged album catalog, edition track counts, and separate local/online artist views
- Playlist folders, status/genre filters, multi-selection, and block reordering
- On-demand online matching for missing tracks, album lookup, and version selection
- Save the queue as a playlist, review duplicates, and crop playlist artwork with drag and zoom
- Listening statistics, likes, backups, and restore

## Using playlists

- Click to select; double-click or press Enter to play. Ctrl/Cmd-click toggles individual selections; Shift-click or Shift+↑/↓ selects a range. Ctrl/Cmd+A selects visible tracks; clicking blank space or pressing Escape clears the selection.
- Right-click selected tracks to add them to the queue/another playlist or **Find missing tracks**. Batch matching neither downloads audio nor starts playback; unmatched results can be reviewed through version selection.
- Double-click an unavailable track to try a local match, then a confident online match. **Choose another version**, **Find album**, and **Clear online match** are available in the context menu.
- Combine **All / Local / Online / Missing**, genre chips, and playlist text search. Drag selected tracks as a block in unfiltered **Custom Order**; reordering is disabled while filtering.
- Create single-level folders with **New folder**, then drag playlists into them or use the playlist menu. Deleting a folder keeps its playlists.
- **Save as playlist** in the queue panel saves the remaining queue, with an option to include the current track.
- Use **Find duplicates** to review playlist copies. When changing artwork, drag the image and use +/− to adjust the square crop.

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

## Spotify playlist import

Use **Import Playlist** to select a Spotify account-data ZIP/JSON file, a public
playlist link, or **Spotify account**. Account connection requires
`http://127.0.0.1:8888/callback` in the Spotify Developer app's redirect URIs
and your Spotify account on that app's allowlist. If the development-mode user
limit prevents sign-in, import your own account-data file instead. Review
matches before saving; importing does not download audio files.

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
npm run package:linux
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
