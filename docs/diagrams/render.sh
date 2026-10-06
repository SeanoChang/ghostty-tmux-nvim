#!/bin/sh
# Draws every docs/diagrams/*.d2 as a PNG beside it: D2 in sketch mode, then
# rsvg-convert for the PNG (ImageMagick without Freetype drops SVG text).
# Needs d2 (https://d2lang.com) and rsvg-convert (librsvg). Run after editing a .d2.
set -e
dir="$(cd "$(dirname "$0")" && pwd)"
for src in "$dir"/*.d2; do
  svg="${src%.d2}.svg"
  d2 --sketch --theme 0 --pad 24 "$src" "$svg"
  rsvg-convert -z 2 -o "${src%.d2}.png" "$svg"
  rm -f "$svg"
  echo "${src%.d2}.png"
done
