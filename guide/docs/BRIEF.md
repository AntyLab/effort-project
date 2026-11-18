# Model Guide v2 — build brief

Checked against public sources on 15 Nov 2026. Prices change (Gemini 4 Argon on 1 Dec 2026, Gemini 3.8 Flash on 1 Jan 2027), so re-check the sources in section 11 before publishing.

## 1. Goal

A shareable website that helps people in nutrition, dietetics and health sciences pick:
1. **a model** (which brain does the work), and
2. **an effort level** (how long it thinks first),

for Claude, OpenAI and Gemini. Each family gets its own visual world that echoes how that company presents its models. Scrolling moves from the lightest model to the most capable.

It should feel like a professional launch page: one strong visual idea per screen, smooth scroll-scrubbed motion, nothing cluttered.

## 2. What exists

`reference/v1-single-file.html` is a working single-file version. Keep its:
- structure: sticky header (family switch: Claude / OpenAI / Gemini; field picker; chapters 1 Models, 2 Effort, 3 Examples, 4 Model or effort?, 5 Cost), one chapter visible at a time, hash routes like `#gemini-cost`;
- content and copy (taglines, notes, "best for", "skip it when", the upgrade steps, the symptom-to-fix list, the comparator verdict logic, cost estimator math, unofficial notice, sources);
- data, now in `data/models.json`.

Rebuild the visuals: v1 draws everything with SVG, Canvas 2D and one procedural shader. v2 upgrades each world as below.

## 3. Information architecture

| Chapter | What the viewer does |
|---|---|
| 1 Models | Scroll story from lightest to most capable model, caption card per model with "What it is for" sheet; compact list of all models underneath |
| 2 Effort | Pick a model, pick an effort level; the scene for that model changes with each level (section 5) |
| 3 Examples | Pick a field; see example tasks by model or by effort level |
| 4 Model or effort? | Five steps, symptom-to-fix list, comparator (bigger model on Low vs smaller model on Extra high) |
| 5 Cost | Price table, task-cost estimator, subscription note |

Model order in the scroll story (lightest first):
- Claude: Haiku 5.5, Sonnet 5.5, Opus 5.5 (Start here), Fable 5.2, Mythos 5.2 (not public)
- OpenAI: GPT-6 Luna, GPT-5.6 Terra (previous generation), GPT-6.1 Sol (Start here), GPT-6 Astra
- Gemini: 3.8 Flash, 4 Hydrogen (in testing), 4 Argon (Start here), 4 Carbon (limited access)

## 4. The three worlds

### 4.1 Claude: 2D naturalist plates (PixiJS)

**Look.** Anthropic presents models with vintage natural-history illustration on cream paper (Fable 5 used butterflies, Opus 5 used speckled eggs). Match the style, not the artwork: hand-colored engraving, fine ink hatching, muted palette (sage #6f9a85, clay #d97757, slate blue #6a9bcc, mauve #b86e85, ochre #c9a24a, ink #2b2620), paper #efe5cf with grain and a soft vignette. Strictly 2D: depth comes from parallax layers, not 3D.

**Scroll story.**
1. **Haiku:** open sky, engraved clouds drifting, a swallow in flight (wings flapping) with a small flock behind.
2. **Sonnet:** the view pulls back through an arched cottage window (curtains, a plant on the sill) and pans down to a desk: candle, inkwell, a sheet of paper. A hand writes with a quill, and the ink line is drawn as you scroll.
3. **Opus:** the page fills the screen and the pond illustration inks onto it (an ink-bloom mask): water with ripples, speckled pebbles on the bank, lily pads, a water lily, reeds, a dragonfly, and a frog that hops from pad to pad as you scroll.
4. **Fable:** the view tilts up from the pond to a meadow sky; a large butterfly flutters center stage with smaller ones circling.
5. **Mythos:** dusk turns to night, stars appear, a constellation draws itself, and a locked, gilt-cornered book glows softly.

**Asset generation (subagents).** Shared style block for every prompt:

> Victorian natural-history lithograph plate, hand-colored engraving, fine ink cross-hatching, muted watercolor palette of sage, ochre, rust, slate blue and cream, single subject centered, isolated on a flat plain #EFE5CF background, no text, no border, no signature, no logo.

Layers to generate (separate files so they can be rigged):
- Sky: 3 cloud shapes; swallow body (side view, wings removed); swallow near wing and far wing as separate images.
- Room: wall with arched window and curtains (window glass area plain so the sky can show through); desk surface; sheet of paper; candle; inkwell; hand holding a quill (quill separate if possible) in 5 quill variants for effort levels (plain grey goose quill, cream with blue-tinted vane, deep blue, blue with gold nib and gold-edged vane, fully gilded).
- Pond: pond base (water and earthy bank); 8 speckled pebbles; 3 lily pad shapes; water lily bud and open flower; frog sitting and frog mid-hop; reed clump; dragonfly.
- Meadow: hero butterfly in 5 colorways (pale cream, warm yellow, orange with blue spots, iridescent blue, gold), each with forewing, hindwing and body as separate layers; 4 small butterflies and moths; grass and wildflower strip.
- Night: locked book with gilt corners and a small padlock.

Remove backgrounds locally (for example `rembg`), export WebP with alpha, keep long edges at 2048px or less. Do not prompt for anything arranged into a numeral, and do not reference Anthropic or Claude in prompts.

**Rigging and effects in PixiJS.**
- Wings: separate sprites with the pivot at the shoulder; flap with `scale.y` (swallow) or `scale.x` (butterfly).
- Water: `DisplacementFilter` driven by a scrolling noise texture; ripple rings as scaled ellipses.
- Ink-bloom reveal: a mask that grows from the page center with a noisy edge.
- Writing: an SVG cursive path sampled for points; the quill sprite follows the path tip; the stroke is drawn with a Graphics line clipped to scroll progress.
- Paper grain and vignette as a top overlay; slight per-layer parallax.

### 4.2 OpenAI: realistic space (Three.js)

**Look.** OpenAI's Sol and Luna launch image is a glowing sun and a crescent moon in starry space; Astra was teased with "The stars are almost aligned." Go photoreal: black space, white type in a clean geometric sans, glassy dark caption cards.

**Scroll story (one continuous camera move).**
1. **Luna:** close on the Moon, lit from the side; Earth small behind it.
2. **Terra:** travel to Earth: day side with clouds and ocean glints, night side with city lights, thin blue atmosphere at the edge; the Moon shrinks to the upper right.
3. **Sol:** travel toward the Sun: churning surface, limb darkening, corona and bloom; Earth and Moon become small dots.
4. **Astra:** pull back until the Sun is one star inside a slowly rotating spiral galaxy.
Lighting always comes from the Sun's actual position, so the terminator moves as the camera travels.

**Build notes.**
- Moon: sphere with the NASA CGI Moon Kit color map and its displacement map as a bump or displacement map (2K on phones, 4K on desktop).
- Earth: custom shader with a Blue Marble day map, Black Marble night-lights map (shown only on the night side), a separate cloud sphere slightly above the surface rotating a little faster, ocean specular from a water mask, and a fresnel atmosphere shell.
- Sun: custom shader with animated 3D noise for granulation, limb darkening, additive corona shells or sprites, `UnrealBloomPass`.
- Galaxy: about 150K points on desktop and 60K on phones along logarithmic spiral arms with Gaussian scatter, colors shifting from a warm core to blue arms with pink star-forming knots, additive blending, a core glow sprite.
- Background stars: a point sphere.
- Camera: a GSAP timeline scrubbed by ScrollTrigger; fake the scale (no real distances); `logarithmicDepthBuffer`.

### 4.3 Gemini: particles and elements (Three.js)

**Look.** Gemini 4 launch art uses a blue gradient with a large white "4"; the family is named after elements, and Google showed off a 3D periodic table that Argon built. Use a deep blue gradient stage with a soft four-color aurora (#4285f4, #9b72cb, #d96570, #f4b400), glowing particles, and a periodic-table tile in each caption (atomic number, symbol, name).

**Scroll story (one particle system morphing between targets).**
1. **3.8 Flash:** particles form a flickering lightning bolt.
2. **Hydrogen:** a fuzzy 1s electron cloud around a tiny nucleus, one bright electron.
3. **Argon:** nucleus with three tilted shells holding 2, 8 and 8 bright electrons.
4. **Carbon:** a rotating hexagonal carbon sheet (atoms and bonds).

**Build notes.** One `THREE.Points` with a custom shader (soft round sprites, additive), one position attribute per scene, morph with a uniform plus a per-particle delay, bloom. About 4K particles on phones and 10K on desktop.

## 5. Effort scenes, made for each model

In chapter 2 the scene belongs to the selected model and changes with each effort level. Only show levels the model offers (see `data/models.json`). Models with no public effort control (Mythos 5.2, Gemini 4 Carbon, Gemini 4 Hydrogen) are not selectable.

| Model | Instant | Low | Medium | High | Extra high | Max | Ultra |
|---|---|---|---|---|---|---|---|
| Haiku 5.5 | | 1 swallow | 3 swallows | 6 in a V | 12 swallows looping | a murmuration of about 40 | |
| Sonnet 5.5 | | plain grey quill, 1 line | blue-tinted quill, 3 lines | deep blue quill, 5 lines, underline | gold nib, gold-edged vane, page fills with flourishes | fully gilded quill, gold ink, wax seal stamped | |
| Opus 5.5 | | 1 pad, 1 frog | 3 pads, a bud | 5 pads, 2 flowers, 2 frogs | 7 pads, 4 flowers, 3 frogs, dragonfly | pond in full bloom, 5 frogs, ripples everywhere | |
| Fable 5.2 | | pale cream butterfly | warm yellow, 2 companions | orange with blue spots, 4 companions | iridescent blue with animated sheen, 8 companions | gold with shimmering edges, 14 companions | |
| GPT-6 Luna | thin crescent | crescent | half moon | gibbous | nearly full | full moon with glow | |
| GPT-5.6 Terra | Earth alone | 1 satellite orbiting | 2 satellites | 3 satellites, brighter city lights | 4 satellites | space station plus polar auroras | |
| GPT-6.1 Sol | calm Sun | one small prominence | two prominences | looping flares | big flares, wider corona | a full solar eruption | |
| GPT-6 Astra | | faint galaxy | arms appear | pink star-forming regions | bright arms and dust lanes | full luminous galaxy | 3 to 5 galaxies linked by faint streams (parallel subagents) |
| Gemini 3.8 Flash | | one bolt | forked bolt | a storm of branching bolts | | | |
| Gemini 4 Argon | | dim violet glow in a gas tube | brighter, faster electrons | intense lavender plasma with bloom | | | |

Argon really does glow violet in a gas discharge tube, so that scene doubles as a science detail. Under each scene keep the v1 readout: level name, API name, plain description, a cost meter against Medium, and one example task from the chosen field.

## 6. Other chapters

Port chapters 3 to 5 from v1 with the same content, restyled per world. Keep the comparator defaults (Claude: Opus Low vs Sonnet Extra high; OpenAI: Astra Low vs Sol Extra high; Gemini: Argon Low vs Flash High) and the cost formula:

`cost = (input tokens × input price + output tokens × effort multiplier × output price) ÷ 1,000,000`

Use Haiku 5.5's long-prompt rate ($0.50 / $2.50) over 100K input tokens. Label effort multipliers as rough and keep their source note.

## 7. Motion principles

- Scrub, don't autoplay: big moves are tied to scroll position; small ambient loops (wings, flicker, rotation) run on time.
- One memorable transition per model change; captions slide in, never fade from blank.
- World switch: circular reveal from the tapped button (View Transitions API), with an instant fallback.
- Reduced motion: static plates per model and crossfades only.

## 8. Quality bar

- 60fps on an iPhone 13-class phone; devicePixelRatio capped at 2 for 2D and 1.5 for WebGL.
- Initial JS under 300KB gzipped; worlds and textures load on demand, low-res first.
- Pause rendering when the stage is off screen or the tab is hidden.
- Text contrast passes WCAG AA on every world; captions readable over every frame.
- Works in Safari on iOS, Chrome on Android, and desktop Chrome, Safari and Firefox.

## 9. Phases (stop for review after each)

0. **Scaffold:** Vite + TS, GSAP, Lenis, Three.js, PixiJS; load `models.json`; header, routing and chapters as plain pages.
1. **Port v1 content:** chapters 2 to 5 working with v1 visuals or placeholders; the cost math matches v1 (Opus 5.5 Low for the paper summary ≈ $0.085; Sonnet 5.5 Extra high ≈ $0.074).
2. **OpenAI world:** textures, shaders, camera path, captions; check on a phone.
3. **Gemini world:** particle morph, aurora, element tiles.
4. **Claude assets:** generate, clean up and log every layer; show me a contact sheet before rigging.
5. **Claude world:** PixiJS scenes, transitions, rigs.
6. **Effort scenes:** section 5 for every selectable model.
7. **Polish and QA:** reduced motion, accessibility, performance pass, credits, then deploy (we'll choose Vercel or GitHub Pages then).

## 10. Guardrails

- Unofficial notice in the footer; no logos, wordmarks or copied launch art.
- Model facts only from `data/models.json`; dates and prices shown with "checked 15 Nov 2026".
- NASA credit lines in the footer and `CREDITS.md`, for example "Moon: NASA's Scientific Visualization Studio, CGI Moon Kit. Earth: NASA Blue Marble and Black Marble."
- For Nutrition and Clinical examples keep the v1 caution: any model can be confidently wrong about doses, nutrient values and guidelines, so check them against your references.

## 11. Sources

Visual references:
- Fable 5 launch art (butterflies on cream): reported at rits.shanghai.nyu.edu/ai/anthropic-launches-claude-fable-5-its-first-public-mythos-class-model/
- GPT-6 Sol and Luna launch image (sun and crescent moon in starry space): gadgetbond.com/?p=148293
- Gemini 4 Argon key art (blue gradient, white "4"): vktr.com/ai-news/google-debuts-gemini-4-argon-for-cyber-defenders/
- Gemini 4 Argon 3D periodic table demo: cryptobriefing.com/gemini-4-argon-3d-periodic-table-song/

Textures:
- NASA CGI Moon Kit (color and displacement maps): https://svs.gsfc.nasa.gov/4720
- Blue Marble Next Generation (day map, clouds): https://earthobservatory.nasa.gov/features/BlueMarble/BlueMarble.php (links to Visible Earth downloads)
- Black Marble night lights: https://svs.gsfc.nasa.gov/12573

Model facts: see the sources list in `reference/v1-single-file.html` (footer).
