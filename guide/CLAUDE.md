# Model Guide v2 — project rules

An unofficial, mobile-first, scroll-animated guide to choosing an AI model and an effort level across three families: Claude (Anthropic), OpenAI and Gemini (Google). The audience is nutrition, dietetics and health-science students and professionals. Read `docs/BRIEF.md` for the full spec before starting any phase.

## Source of truth
- `data/models.json` holds every model, price, date, effort level and example task. Never invent or "update from memory" a model fact. If something looks stale, say so and ask before changing it.
- `reference/v1-single-file.html` is the working v1 (open it in a browser). Reuse its content, data logic, cost math and copy. Rebuild its visuals.

## Stack
- Vite + TypeScript, no UI framework unless needed.
- GSAP + ScrollTrigger for scroll timelines, Lenis for smooth scrolling.
- Three.js (WebGL) for the OpenAI and Gemini worlds, with postprocessing bloom. Not WebGPU.
- PixiJS v8 for the Claude 2D world (sprites, displacement filter for water, masks, paper grain).
- Load each world as its own dynamic import. Only one WebGL context alive at a time; dispose on world switch.

## Commands
- `npm run dev -- --host`: dev server; give me the Network URL so I can open it on my iPhone on the same Wi-Fi.
- `npm run build` and `npm run preview`: check the production build before calling a phase done.

## Non-negotiables
- Footer says: "Unofficial guide. Not made by or affiliated with Anthropic, OpenAI or Google." No company logos or wordmarks anywhere.
- Do not recreate any company's actual launch artwork (for example, no objects arranged into a numeral "5"). Original art in a similar style is fine.
- Credit NASA imagery (see BRIEF). Keep a `CREDITS.md`.
- Phone first at 390px wide, 60fps target on an iPhone 13-class device, no sideways scrolling.
- `prefers-reduced-motion`: replace scrubbed motion with static plates and crossfades.
- Every interactive control is a real button or input with a label and visible focus.

## Generated art (Claude world)
- Use the image-generation subagents (Gemini, Codex) for the 2D plates. Prompts and the style block are in BRIEF section 4.1.
- Generate each subject as its own layer on a flat background, remove the background, export WebP with alpha to `public/assets/claude/<scene>/<layer>.webp`.
- Log every prompt and the chosen output in `public/assets/claude/PROMPTS.md`.

## Working style
- Work phase by phase (BRIEF section 9). After each phase: run the build, take phone-size screenshots of each world, list what is done and what is not, then stop for my review.
- Use my installed animation and design skills where they fit, and tell me which ones you used.
