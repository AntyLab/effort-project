# Model Guide v2 — project kit

What's inside:
- `CLAUDE.md`: project rules Claude Code reads automatically.
- `docs/BRIEF.md`: the full spec (worlds, scroll stories, effort scenes, phases, sources).
- `data/models.json`: every model, price, effort level and example task.
- `reference/v1-single-file.html`: the current working version to reuse content and logic from.

## Start it

1. On your Mac, unzip this folder and move it to where you keep projects (for example your Developer folder). Rename it if you like, e.g. `model-guide`.
2. Open the Claude desktop app, go to Claude Code, and start a new session in that folder.
3. Paste the kickoff prompt below.
4. When it gives you a Network URL, open it on your iPhone (same Wi-Fi) to check each phase.

## Kickoff prompt

```
Read CLAUDE.md and docs/BRIEF.md, then open reference/v1-single-file.html to see the current version.
Start with Phase 0 and Phase 1 from the brief. Use my installed animation and design skills where they fit, and use the Gemini and Codex subagents for image generation when we reach the Claude art in Phase 4.
Ask me before adding any dependency not listed in CLAUDE.md. After each phase, run the build, give me the Network URL for my iPhone, show phone-size screenshots of each world, and stop for my review.
```

## Run it (added after the build)

```bash
npm install
npm run dev -- --host --port 5180   # prints a Network URL for your phone
npm run build && npm run preview    # production build check
npm run smoke                       # screenshots + checks at 390px and desktop (needs the dev server and Chrome)
npm run deploy                      # build and publish to Cloudflare (needs a signed-in Wrangler)
```

See `DECISIONS.md` for choices made during the build and `CREDITS.md` for imagery credits.
The art pipeline is `scripts/generate-art.mjs` then `scripts/process-art.py`.
