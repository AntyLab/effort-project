# Credits

## Imagery

- **Moon:** NASA's Scientific Visualization Studio, CGI Moon Kit (color map `lroc_color_poles_4k.tif`,
  elevation `ldem_3_8bit.jpg`). https://svs.gsfc.nasa.gov/4720
- **Earth, day:** NASA Blue Marble, via NASA's Scientific Visualization Studio, "Equirectangular
  Projected Earth" (`earth_noClouds.0330.jpg`). https://svs.gsfc.nasa.gov/3615
- **Earth, clouds:** derived from the same SVS entry (difference between `flat_earth03.jpg`, which has
  clouds, and `earth_noClouds.0330.jpg`).
- **Earth, night lights:** NASA Earth Observatory, Black Marble 2016 (`BlackMarble_2016_3km.jpg`).
  https://svs.gsfc.nasa.gov/12573 and https://earthobservatory.nasa.gov/features/NightLights

NASA imagery is in the public domain. NASA does not endorse this guide.

- **Claude-world illustrations:** original images generated for this project with an image model
  (prompts and outputs are logged in `public/assets/claude/PROMPTS.md`). They imitate a general
  Victorian natural-history engraving style and copy no company's artwork.
- **Sun, galaxy, particles, lightning, atoms:** procedural, drawn in code.

## Software

Vite, TypeScript, GSAP and ScrollTrigger, Lenis, Three.js, PixiJS. Fonts are loaded from Google Fonts
(Lora, Poppins, Urbanist, Outfit, Google Sans Flex).

[Real-ESRGAN](https://github.com/xinntao/Real-ESRGAN) (BSD 3-Clause) made the sharper desktop copies of the Claude-world art (`scripts/upscale-art.sh`). Build-time tool, not shipped.

## Audio

All clips are from OpenGameArt.org under CC0 1.0 (public domain), downloaded 16 Nov 2026, then trimmed,
mixed to mono and re-encoded as mp3 in `public/assets/audio/`. Credit is not required; it is given anyway.

| File | Source | Author |
|---|---|---|
| `sky.mp3`, `meadow.mp3`, `pond.mp3` | [Park ambiences](https://opengameart.org/content/park-ambiences) (birds, river); the sky bed adds a generated soft breeze | Thimras |
| `tower.mp3` | [Fireplace sound loop](https://opengameart.org/content/fireplace-sound-loop) | StarNinjas |
| `night.mp3` | [Crickets Ambient Noise - loopable](https://opengameart.org/content/crickets-ambient-noise-loopable) | 2DPIXX |
| `space.mp3` | [Space Winds](https://opengameart.org/content/space-winds) | WolfTech |
| `hum.mp3` | [Electric Buzz](https://opengameart.org/content/electric-buzz) | bonder |
| `croak.mp3` | [Frog Croaks](https://opengameart.org/content/frog-croaks) | EZduzziteh |
| `plop.mp3` | [Water Drops](https://opengameart.org/content/water-drops) | CeoxBlackj |
| `scratch.mp3` | [Pencil Sounds](https://opengameart.org/content/pencil-sounds) (pencil_write, originally by NachtmahrTV on Freesound) | AntumDeluge |
| `crackle.mp3` | [Electricity Sound Effects](https://opengameart.org/content/electricity-sound-effects-0) | BMacZero |

## Content

Model facts, prices and sources come from `data/models.json` and the v1 guide, checked 15 Nov 2026.
The sources list is in the page footer. This is an unofficial guide, not made by or affiliated with
Anthropic, OpenAI or Google.
