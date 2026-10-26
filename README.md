# Playerinyo

Yerel müzik arşivleri için Electron tabanlı vibecoded masaüstü oynatıcı.

## Özellikler

- Yerel kütüphane, albüm görünümleri, Smart Playlist ve çalma listeleri
- Çift ses kanalıyla boşluksuz oynatma ve crossfade
- Last.fm destekli Radyo, YouTube Music araması ve arama sonucundan Şarkı Radyosu
- İlerleme ve hata durumlarıyla İndirilenler sayfası, metadata/kapak görseli düzenleme ve şarkı sözleri
- Spotify hesap verisi ZIP/JSON dosyasından, herkese açık bağlantıdan veya bağlı hesaptan playlist aktarımı
- MusicBrainz sanatçı/albüm kataloğu ve yerel kütüphane karşılaştırması
- Dinleme istatistikleri, beğeniler, yedekleme ve geri yükleme

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

## Features

- Local library, album views, Smart Playlists, and playlists
- Gapless playback and crossfade with dual audio channels
- Last.fm-powered Radio, YouTube Music search, and Song Radio from search results
- Downloads page with progress and error states, metadata/artwork editing, and lyrics
- Spotify playlist import from account-data ZIP/JSON, public link, or connected account
- MusicBrainz artist/album catalog with local library comparison
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
