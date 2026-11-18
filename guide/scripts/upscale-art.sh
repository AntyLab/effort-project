#!/bin/bash
# Makes the sharper desktop copies of the Claude art listed in scripts/art-hires.json
# (layer -> scale), saved beside the originals as <layer>.<scale>x.webp. The loader tells
# Pixi the scale, so sizes and positions in the code do not change.
# Only layers drawn larger than their pixels on a retina laptop are listed.
#
# Usage: scripts/upscale-art.sh <folder holding realesrgan-ncnn-vulkan and its models/>
#   (https://github.com/xinntao/Real-ESRGAN/releases, v0.2.5.0; also needs ImageMagick and cwebp)
set -euo pipefail
tool=$1; here=$(cd "$(dirname "$0")" && pwd); art=$here/../public/assets/claude; tmp=$(mktemp -d)
python3 -c 'import json,sys; [print(k, v) for k, v in json.load(open(sys.argv[1])).items()]' "$here/art-hires.json" | while read -r key scale; do
  # The general model keeps the engraved texture; the anime model flattens it into a cartoon.
  "$tool/realesrgan-ncnn-vulkan" -i "$art/$key.webp" -o "$tmp/x4.png" -n realesrgan-x4plus -m "$tool/models" 2>/dev/null
  magick "$tmp/x4.png" -filter Lanczos -resize $((scale * 25))% "$tmp/out.png"
  cwebp -quiet -q 84 -alpha_q 100 -m 6 "$tmp/out.png" -o "$art/$key.${scale}x.webp"
  echo "$key.${scale}x $(magick identify -format '%wx%h' "$art/$key.${scale}x.webp")"
done
rm -rf "$tmp"
