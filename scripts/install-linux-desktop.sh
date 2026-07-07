#!/usr/bin/env bash
set -euo pipefail

APP_ID="playerinyo"
APP_NAME="Playerinyo"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DESKTOP_SOURCE="$ROOT_DIR/build/linux/$APP_ID.desktop"
DESKTOP_TARGET="$HOME/.local/share/applications/$APP_ID.desktop"
OLD_DESKTOP_TARGET="$HOME/.local/share/applications/musicplayerinyo.desktop"
ICON_SOURCE="$ROOT_DIR/assets/icon.png"
ICON_TARGET_DIR="$HOME/.local/share/icons/hicolor/256x256/apps"
ICON_TARGET="$ICON_TARGET_DIR/$APP_ID.png"
OLD_ICON_TARGET="$ICON_TARGET_DIR/musicplayerinyo.png"
LEGACY_ICON_TARGET="$HOME/.local/share/icons/hicolor/512x512/apps/$APP_ID.png"
LEGACY_OLD_ICON_TARGET="$HOME/.local/share/icons/hicolor/512x512/apps/musicplayerinyo.png"
PACKAGE_DIR="$ROOT_DIR/out/$APP_NAME-linux-x64"
PACKAGE_BINARY="$PACKAGE_DIR/$APP_ID"
INSTALL_DIR="${PLAYERINYO_INSTALL_DIR:-$HOME/Applications/$APP_NAME}"
INSTALL_BINARY="$INSTALL_DIR/$APP_ID"

if [[ ! -f "$DESKTOP_SOURCE" ]]; then
  printf '%s\n' "Desktop template bulunamadı: $DESKTOP_SOURCE"
  printf '%s\n' 'Repository içinde build/linux/playerinyo.desktop dosyasının olduğundan emin ol.'
  exit 1
fi

mkdir -p "$(dirname "$DESKTOP_TARGET")"
rm -f "$OLD_DESKTOP_TARGET"

desktop_icon="$APP_ID"
if [[ -f "$ICON_SOURCE" ]]; then
  mkdir -p "$ICON_TARGET_DIR"
  cp "$ICON_SOURCE" "$ICON_TARGET"
  rm -f "$OLD_ICON_TARGET" "$LEGACY_ICON_TARGET" "$LEGACY_OLD_ICON_TARGET"
  desktop_icon="$ICON_TARGET"
else
  printf '%s\n' 'assets/icon.png bulunamadı, Linux menü iconu için PNG ekle.'
fi

desktop_contents=$(<"$DESKTOP_SOURCE")
desktop_contents=${desktop_contents/Icon=$APP_ID/Icon=$desktop_icon}

if [[ -x "$PACKAGE_BINARY" ]]; then
  mkdir -p "$INSTALL_DIR"
  cp -a "$PACKAGE_DIR/." "$INSTALL_DIR/"
  desktop_exec=${INSTALL_BINARY//\\/\\\\}
  desktop_exec=${desktop_exec//\"/\\\"}
  desktop_contents=${desktop_contents/Exec=$APP_ID/Exec=\"$desktop_exec\"}
else
  printf '%s\n' "Package binary bulunamadı: $PACKAGE_BINARY"
  printf '%s\n' "Önce npm run package çalıştır veya $DESKTOP_TARGET içindeki Exec satırını güncelle."
fi

printf '%s\n' "$desktop_contents" > "$DESKTOP_TARGET"

if command -v update-desktop-database >/dev/null 2>&1; then
  update-desktop-database "$HOME/.local/share/applications" >/dev/null 2>&1 || true
fi

if command -v gtk-update-icon-cache >/dev/null 2>&1 && [[ -d "$HOME/.local/share/icons/hicolor" ]]; then
  gtk-update-icon-cache -q "$HOME/.local/share/icons/hicolor" >/dev/null 2>&1 || true
fi

printf '%s\n' "Installed app: $INSTALL_DIR"
printf '%s\n' "Installed desktop entry: $DESKTOP_TARGET"
