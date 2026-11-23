#!/usr/bin/env bash
# Linux only. Install the AppImage into the current user's launcher (wofi, rofi, walker, the KDE/GNOME menus).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APPIMAGE="$(find "$ROOT/release" -maxdepth 1 -name 'Rascal-*.AppImage' -printf '%T@ %p\n' | sort -nr | head -1 | cut -d' ' -f2-)"
if [[ -z "${APPIMAGE}" || ! -f "${APPIMAGE}" ]]; then
  echo "No AppImage in release/. Run ./scripts/build-appimage.sh first." >&2
  exit 1
fi

mkdir -p "$HOME/Applications" \
  "$HOME/.local/share/applications" \
  "$HOME/.local/share/icons/hicolor/256x256/apps"
install -m 0755 "$APPIMAGE" "$HOME/Applications/Rascal.AppImage"
install -m 0644 "$ROOT/build/icons/256x256.png" "$HOME/.local/share/icons/hicolor/256x256/apps/rascal.png"

cat > "$HOME/.local/share/applications/rascal.desktop" <<EOF
[Desktop Entry]
Version=1.0
Type=Application
Name=Rascal
GenericName=Stream desk
Comment=Twitch and YouTube chat and stream info
Exec=$HOME/Applications/Rascal.AppImage --ozone-platform-hint=auto %U
Icon=$HOME/.local/share/icons/hicolor/256x256/apps/rascal.png
Terminal=false
Categories=AudioVideo;Network;
StartupWMClass=rascal
Keywords=twitch;youtube;chat;stream;
StartupNotify=true
EOF

chmod 0644 "$HOME/.local/share/applications/rascal.desktop"
update-desktop-database "$HOME/.local/share/applications" 2>/dev/null || true

echo "Installed:"
echo "  $HOME/Applications/Rascal.AppImage"
echo "  $HOME/.local/share/applications/rascal.desktop"
echo "Rascal should show up in the Hyprland launcher. If it does not, restart the launcher."
echo "The old Ember launcher entry is left in place. Remove ~/.local/share/applications/ember.desktop if it still appears."
echo "If the AppImage refuses to start, install fuse2 or run:"
echo "  APPIMAGE_EXTRACT_AND_RUN=1 $HOME/Applications/Rascal.AppImage"
