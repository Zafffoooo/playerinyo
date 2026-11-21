# Changelog

All notable changes to Playerinyo are recorded in this file.

## 0.1.9 — 2026-11-21

### Türkçe

- **ListenBrainz:** Hesabını Bağlantılar ekranından bağla, tüm dinleme geçmişini içe aktar ve yeni dinlemeleri gönder. Gönderilemeyen dinlemeler kuyrukta kalır ve yeniden denenebilir.
- **Keşif:** ListenBrainz geçmişinden kişisel öneriler ve yeni albümler, türe göre radyo ve benzer parçalardan radyo eklendi. ListenBrainz listelerini önizleyebilir, yerelde eşleşen parçaları çalabilir veya listeyi içe aktarabilirsin.
- **YouTube Music:** Herkese açık veya liste dışı çalma listelerini bağlantıyla içe aktar. Takip ettiğin listeler Playerinyo açıkken dört saatte bir kontrol edilir. Eklenen ve kaldırılan parçalar arşivde görünür. Takeout ZIP, CSV ve yapıştırılan CSV de yerel arşive eklenebilir.
- **Çalma listeleri:** Kaynağa göre filtreleme, liste arama, son kullanılan listelere hızlı erişim ve sürükleyerek klasöre taşıma eklendi. Yeni liste oluştururken klasör seçilebilir.
- **Oynatma ve arayüz:** Karışık çalma açıkken elle seçilen parça sıranın başına alınır. Gapless zamanlaması, indirme göstergesi ve Bağlantılar ekranı iyileştirildi.
- **Metadata ve keşif kaynakları:** İndirilen parçaların etiket eşleştirmesi MusicBrainz ve ListenBrainz verileriyle iyileştirildi. Benzer sanatçı ve öneri sorgularına Deezer desteği eklendi.

[PR #1](https://github.com/Zafffoooo/playerinyo/pull/1) — Oztturk katkısı:

- Büyük kütüphanelerde beğeni, playlist ve içe aktarma eşleştirmeleri önbelleğe alındı; indirme ve aktarım ekranlarında gereksiz liste yenilemeleri azaltıldı.
- Bilinen şarkı indeksinin disk yazmaları birleştirildi; değişmemiş dosyaların eksik metadatasının her açılışta yeniden okunması önlendi.
- MP3 etiket yazma ve yedek oluşturma/doğrulama işleri ana süreçten worker'a taşındı. Yedekleme ve çok dosyalı veri işlemleri ortak yazma kilidi kullanıyor.
- Taşınmış dosyaların eşleştirilmesi ve Spotify ZIP aktarımının işlenmesi iyileştirildi; ZIP içindeki ilgili JSON dosyalarının toplam açılmış boyutu 160 MB ile sınırlandı.

### English

- **ListenBrainz:** Connect in Settings, import your full listening history, and submit new listens. Failed submissions stay queued for retry.
- **Discovery:** Added personal recommendations, fresh releases, genre radio, and similar-track radio with ListenBrainz. Preview ListenBrainz playlists, play locally matched tracks, or review an import.
- **YouTube Music:** Import public or unlisted playlist links. While the app is open, followed links are checked every four hours and additions and removals appear in the archive. The local archive also accepts Takeout ZIP files, CSV files, and pasted CSV.
- **Playlists:** Search and filter by source, open recently used playlists from the sidebar, drag playlists into folders, and select a folder when creating a playlist.
- **Playback and interface:** Manually selected tracks start the shuffled queue. Improved gapless timing, download progress feedback, and the Connections screen.
- **Metadata and discovery sources:** Improved downloaded track metadata matching with MusicBrainz and ListenBrainz. Added Deezer as a source for similar artists and recommendations.

[PR #1](https://github.com/Zafffoooo/playerinyo/pull/1) — contributed by Oztturk:

- Cached liked-track, playlist, and import matching for large libraries; reduced unnecessary list rebuilding in download and import views.
- Coalesced known-track index writes and avoided repeatedly reparsing unchanged files with legitimately missing metadata on startup.
- Moved MP3 tag writing and backup creation/validation to workers. Backup snapshots and multi-file data transactions now share a source-write lock.
- Improved moved-file matching and Spotify ZIP processing; matching JSON entries are limited to 160 MB of combined expanded data.

## 0.1.8 — 2026-10-30

### Türkçe

- Sanatçı profilleri daha hızlı açılır: albüm, şarkı ve fotoğraf istekleri bağımsız çalışır; ilk 5 albüm önizlenir, Show All kalan albümleri sayfalı yükler.
- Yerel şarkıdan sanatçıya gitmek In Library görünümünü açar; Explore online ile çevrimiçi kataloğa geçilebilir. Albüm kapağı, şarkıdan albüm bulma ve arama sonuçlarına geri dönüş iyileştirildi.
- Albüm sürümlerinde şarkı sayıları ve sayıya göre sıralama eklendi; sanatçı fotoğrafı yükleme ve çevrimiçi kapak saklama iyileştirildi.
- Playlistlere kısa durum/tür filtreleri, toplam süre, Ctrl/Shift ile çoklu seçim, klavyeyle aralık seçimi ve blok taşıma eklendi. Toplu işlemler sağ tık menüsündedir.
- Eksik şarkıları tek tek veya topluca arama, iptal, yeniden deneme, sürüm seçme ve çevrimiçi eşleşmeyi kaydetme eklendi. Toplu arama oynatma veya indirme başlatmaz.
- Tek seviyeli playlist klasörleri, sırayı playlist olarak kaydetme, tekrarları inceleme ve sürükleme/yakınlaştırma destekli kapak kırpma eklendi.
- Uzun şarkı adları tek satırda kısalır; kalp ve playlist ikonları aynı satırda kalır. Seçili satırların alt çizgisi kaldırıldı.
- Eski beğenilen/playlist şarkılarındaki oynatma tanımı ve eksik sıra kimliği hataları düzeltildi. Link/CSV playlistlerinin yerel şarkı üyelik göstergeleri ve yedekleme uyumluluğu iyileştirildi.

### English

- Artist profiles load faster with independent album, song, and photo requests; preview five albums and load the rest in pages with Show All.
- Artist links from local playback open an In Library view, with Explore online for the catalog. Improved album navigation, song-to-album lookup, and returning to search results.
- Added edition track counts and sorting by track count; improved artist photo loading and persisted online artwork.
- Added compact status/genre filters, total duration, Ctrl/Shift selection, keyboard range selection, and block reordering. Bulk actions live in the context menu.
- Added on-demand single/batch matching for unavailable tracks, cancellation, retry, version selection, and saved online matches. Batch matching does not start playback or download audio.
- Added single-level playlist folders, saving the queue as a playlist, duplicate review, and drag/zoom artwork cropping.
- Long track titles truncate on one line while like and playlist icons stay aligned. Removed selected-row underlines.
- Fixed invalid playback descriptors and missing queue ownership for saved liked/playlist tracks. Improved local membership indicators for link/CSV imports and backup compatibility.

## 0.1.7 — 2026-10-26

### Added

- Connect a permitted Spotify account to browse and import its playlists, including playlist covers.
- Browse artist albums and editions in the MusicBrainz catalog, compare tracks with the local library, and open or download an album.
- Continue a YouTube Music search result with Song Radio recommendations in Up Next; return to the previous queue when wanted.
- Show artist profiles for the first two distinct artists in YouTube Music song results.
- Show download history, artwork, per-track progress, and the current download in a dedicated Downloads page and compact sidebar indicator.

### Changed

- Refined the Now Playing artwork gradient, artist album layout, and download page layout.
- Sort Liked Songs by the time a track was liked.

### Fixed

- Show and toggle the liked state of streamed and radio tracks in track lists.
- Merge duplicate library paths when relinking moved files and retain liked-track references.

## 0.1.6 — 2026-10-25

### Added

- Import playlists from Spotify account-data ZIP and JSON files, review local matches, and reimport while retaining existing selections.
- Choose another YouTube Music version for a playlist track and save that choice.
- Look up matching online artwork for Discord Rich Presence, with playback progress and clearer connection status.
- Added audio output selection, personal lyrics editing, and an option to retry failed download matches.

### Changed

- Improved YouTube Music search and playback preparation, with clearer loading and error states.
- Refined Now Playing controls, artwork loading, lyrics layout, and the search source menu.
- Improved local track transitions and download recovery after interruption.

### Fixed

- Prevented stale artwork and lyrics from appearing after rapid track changes.
- Fixed Discord Rich Presence reconnecting when Discord starts after playback.

## 0.1.5 — 2026-10-13

### Added

- Added half-star album ratings, album likes, and album review controls, with preferences retained when album metadata changes.
- Expanded library search with field, file, missing-cover, like, and album-rating filters, plus shortcut and search help.
- Added a dated Last listened view and per-source play counts, listening time, and date ranges for local and streamed tracks.
- Saved personal synced or plain lyrics for the current track and added retry and web-search actions.
- Added Last.fm recommendation modes based on recent listening, selected genres, or selected artists.

### Changed

- Moved the lyrics engine and controls into a dedicated renderer slice.
- Updated `csv-parse` and `music-metadata` to audited releases.

### Fixed

- Corrected repeat shortcut handling and made both Ctrl/Cmd+L and Ctrl/Cmd+R cycle repeat.
- Kept playlist track details, album preferences, and listening history consistent after library metadata changes.
- Fixed related playback, download, and Linux desktop installation edge cases.

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
