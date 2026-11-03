#!/usr/bin/env bash
set -e

UUID="spotify-dynamic-island@mayankjain92.github.io"
DEST_DIR="${HOME}/.local/share/gnome-shell/extensions/${UUID}"

echo "=========================================="
echo " Installing Spotify Dynamic Island..."
echo "=========================================="

mkdir -p "${DEST_DIR}"

# Copy all necessary files
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cp -r "${SCRIPT_DIR}/extension.js" \
      "${SCRIPT_DIR}/islandCard.js" \
      "${SCRIPT_DIR}/lyricsClient.js" \
      "${SCRIPT_DIR}/lyricsView.js" \
      "${SCRIPT_DIR}/mpris.js" \
      "${SCRIPT_DIR}/panelPill.js" \
      "${SCRIPT_DIR}/colorHelper.js" \
      "${SCRIPT_DIR}/metadata.json" \
      "${SCRIPT_DIR}/prefs.js" \
      "${SCRIPT_DIR}/stylesheet.css" \
      "${SCRIPT_DIR}/schemas" \
      "${DEST_DIR}/"

# Compile GSettings schemas
if command -v glib-compile-schemas &> /dev/null; then
    glib-compile-schemas "${DEST_DIR}/schemas"
fi

# Enable extension
if command -v gnome-extensions &> /dev/null; then
    gnome-extensions enable "${UUID}" 2>/dev/null || true
fi

echo ""
echo "✅ Installed successfully to: ${DEST_DIR}"
echo ""
echo "👉 Note: If this is your first time installing, please log out and log back in (or restart GNOME Shell) so GNOME loads the new extension."
echo "👉 To open preferences: gnome-extensions prefs ${UUID}"
echo "=========================================="
