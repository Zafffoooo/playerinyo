# Linux Local Install

Run from the project root:

```sh
npm install
npm start
npm run package
npm run linux:install-desktop
```

`npm run package` creates the local packaged app under `out/Playerinyo-linux-x64/`.

`npm run linux:install-desktop` copies the packaged app to `~/Applications/Playerinyo/` and installs a user menu entry at `~/.local/share/applications/playerinyo.desktop`. If the packaged binary exists, the script writes the installed executable path into the desktop entry. The script also writes the installed icon's absolute path into the desktop entry so launchers do not have to resolve it through the icon theme cache.

To install somewhere else, run with `PLAYERINYO_INSTALL_DIR=/path/to/Playerinyo npm run linux:install-desktop`.

For a menu icon, add a PNG at `assets/icon.png`, then run:

```sh
npm run linux:install-desktop
```

If `assets/icon.png` is missing, the installer prints:

```text
assets/icon.png bulunamadı, Linux menü iconu için PNG ekle.
```

To remove the local menu entry:

```sh
rm -f "$HOME/.local/share/applications/playerinyo.desktop"
rm -f "$HOME/.local/share/icons/hicolor/256x256/apps/playerinyo.png"
```

On Linux audio settings, Electron may appear as Chromium in PipeWire/PulseAudio mixers. This is expected for Electron apps.
