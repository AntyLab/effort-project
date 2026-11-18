"""Cut out the generated Claude-world layers and export WebP with alpha.

Usage: python process-art.py <rawDir> <outDir> [--rembg]

Reads scripts/art-manifest.json. Per layer `cut`:
  subject  remove the flat paper background (flood fill from the image border, or rembg with --rembg)
  paper    ink on paper: alpha from distance to the paper color (clouds)
  magenta  make the flat magenta window opening transparent
  none     full-bleed plate, no cut-out
`split: N` layers hold N subjects in a row and are saved as <layer>_1..N.
Writes <outDir>/<scene>/<layer>.webp, <outDir>/layers.json (sizes) and <outDir>/PROMPTS.md.
"""
import json, sys
from pathlib import Path
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

raw, out = Path(sys.argv[1]), Path(sys.argv[2])
use_rembg = '--rembg' in sys.argv
here = Path(__file__).parent
manifest = json.loads((here / 'art-manifest.json').read_text())
PAPER = np.array([0xEF, 0xE5, 0xCF], dtype=np.float32)


def cut_subject(img):
    if use_rembg:
        from rembg import remove
        return remove(img.convert('RGB'))
    # Flood fill from every border pixel that looks like paper. Interior cream areas
    # (a pale wing, a white belly) survive because the ink outline stops the fill.
    rgb = img.convert('RGB')
    w, h = rgb.size
    key = (255, 0, 254)
    work = rgb.copy()
    px = np.asarray(rgb, dtype=np.float32)
    border = [(x, y) for x in range(0, w, 8) for y in (0, h - 1)] + [(x, y) for y in range(0, h, 8) for x in (0, w - 1)]
    for x, y in border:
        if np.abs(px[y, x] - PAPER).max() < 40 and work.getpixel((x, y)) != key:
            ImageDraw.floodfill(work, (x, y), key, thresh=38)
    mask = np.all(np.asarray(work) == np.array(key, dtype=np.uint8), axis=-1)
    alpha = Image.fromarray(np.where(mask, 0, 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(1.2))
    # Erode slightly so no paper-colored fringe is left on dark backgrounds.
    alpha = alpha.point(lambda a: 0 if a < 150 else min(255, int((a - 150) * 2.43)))
    rgba = rgb.convert('RGBA')
    rgba.putalpha(alpha)
    return rgba


def cut_paper(img):
    px = np.asarray(img.convert('RGB'), dtype=np.float32)
    dist = np.abs(px - PAPER).max(axis=-1)
    alpha = np.clip((dist - 10) / 60, 0, 1) * 255
    rgba = img.convert('RGBA')
    rgba.putalpha(Image.fromarray(alpha.astype(np.uint8)))
    return rgba


def cut_magenta(img):
    px = np.asarray(img.convert('RGB'), dtype=np.int16)
    r, g, b = px[..., 0], px[..., 1], px[..., 2]
    hole = (r > 150) & (b > 150) & (g < 130) & (np.abs(r - b) < 90)
    alpha = Image.fromarray(np.where(hole, 0, 255).astype(np.uint8)).filter(ImageFilter.MinFilter(5)).filter(ImageFilter.GaussianBlur(1))
    rgba = img.convert('RGBA')
    rgba.putalpha(alpha)
    return rgba


def trim(img):
    box = img.getchannel('A').point(lambda a: 255 if a > 24 else 0).getbbox()
    return img.crop(box) if box else img


def split_row(img, n):
    """The n widest runs of non-empty columns, left to right."""
    cols = (np.asarray(img.getchannel('A')) > 24).sum(axis=0) > 2
    runs, start = [], None
    for x, on in enumerate(list(cols) + [False]):
        if on and start is None: start = x
        if not on and start is not None: runs.append((start, x)); start = None
    runs = sorted(sorted(runs, key=lambda r: r[0] - r[1])[:n])
    return [trim(img.crop((a, 0, b, img.height))) for a, b in runs]


def save(img, scene, name, long_edge):
    scale = long_edge / max(img.size)
    if scale < 1: img = img.resize((round(img.width * scale), round(img.height * scale)), Image.LANCZOS)
    (out / scene).mkdir(parents=True, exist_ok=True)
    img.save(out / scene / f'{name}.webp', 'WEBP', quality=86, method=6)
    return {'file': f'{scene}/{name}.webp', 'w': img.width, 'h': img.height}


layers, log = [], ['# Claude-world art prompts', '', 'Generated with Codex (image tool, GPT-6 Luna session) from `scripts/art-manifest.json`. One generation per layer, first output kept unless noted.', '']
for l in manifest['layers']:
    src = raw / l['scene'] / f"{l['layer']}.png"
    prompt = f"{manifest['styleBleed'] if l.get('bleed') else manifest['style']} Subject: {l['subject']}. Format: {l['format']}."
    if not src.exists():
        print('missing', src); log += [f"## {l['scene']}/{l['layer']}", '', 'NOT GENERATED', '', f'> {prompt}', '']; continue
    img = Image.open(src)
    cut = l['cut']
    if cut == 'subject': parts = [trim(cut_subject(img))]
    elif cut == 'paper': parts = [trim(cut_paper(img))]
    elif cut == 'magenta': parts = [cut_magenta(img)]
    else: parts = [img.convert('RGB')]
    names = [l['layer']]
    if l.get('split'):
        parts = split_row(parts[0], l['split'])
        base = l['layer'].removesuffix('_b')
        offset = l['split'] if l['layer'].endswith('_b') else 0
        names = [f'{base}_{i + 1 + offset}' for i in range(len(parts))]
        if len(parts) != l['split']: print(f"WARNING {l['layer']}: found {len(parts)} of {l['split']} subjects")
    edge = l.get('edge') or (1536 if cut in ('none', 'magenta') else (640 if l.get('split') else 1024))
    saved = [save(p, l['scene'], n, edge) for p, n in zip(parts, names)]
    layers += saved
    log += [f"## {l['scene']}/{l['layer']}", '', f'> {prompt}', '', 'Output: ' + ', '.join(f"`{s['file']}` ({s['w']}x{s['h']})" for s in saved) + f'. Cut-out: {cut}.', '']
(out / 'layers.json').write_text(json.dumps(layers, indent=1))
(out / 'PROMPTS.md').write_text('\n'.join(log))
print(len(layers), 'files written')
