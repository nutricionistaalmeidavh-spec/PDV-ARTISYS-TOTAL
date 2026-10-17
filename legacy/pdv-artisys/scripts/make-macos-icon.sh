#!/usr/bin/env bash
set -euo pipefail

# Builds the SAME logo used by the existing Windows package; avoids shipping a placeholder icon.
if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "O arquivo .icns deve ser gerado em macOS." >&2
  exit 1
fi

for command in rsvg-convert sips iconutil; do
  if ! command -v "$command" >/dev/null 2>&1; then
    echo "Ferramenta ausente: $command (instale librsvg com: brew install librsvg)." >&2
    exit 1
  fi
done

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SOURCE="$ROOT/desktop/assets/artisys-pdv-icon.svg"
OUTPUT="$ROOT/build/artisys-pdv.icns"
ICONSET="$ROOT/build/artisys-pdv.iconset"
mkdir -p "$ICONSET"
trap 'rm -rf "$ICONSET"' EXIT

rsvg-convert --width 1024 --height 1024 "$SOURCE" --output "$ICONSET/icon_512x512@2x.png"

for pair in \
  "16 icon_16x16.png" \
  "32 icon_16x16@2x.png" \
  "32 icon_32x32.png" \
  "64 icon_32x32@2x.png" \
  "128 icon_128x128.png" \
  "256 icon_128x128@2x.png" \
  "256 icon_256x256.png" \
  "512 icon_256x256@2x.png" \
  "512 icon_512x512.png"; do
  read -r size filename <<< "$pair"
  sips --resampleHeightWidth "$size" "$size" "$ICONSET/icon_512x512@2x.png" --out "$ICONSET/$filename" >/dev/null
done

iconutil -c icns "$ICONSET" -o "$OUTPUT"
echo "Ícone do Artisys preparado: $OUTPUT"
