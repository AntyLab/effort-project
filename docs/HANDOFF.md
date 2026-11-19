# Automatic routing handoff

Checkpoint: November 19, 2026 (0.3.2). Effort now routes both model and effort. This is an experimental functional checkpoint, not evidence of equal quality or cost savings.

## Implemented

- Local rules choose fast for short mechanical requests, frontier for requests that are both high-stakes and investigative or tangled, and daily for everything else. Built-in models are Claude `haiku` / `sonnet` / `fable`, Codex `gpt-6-luna` / `gpt-6.2-sol` / `gpt-6.2-astra`, and Gemini `gemini-4-hydrogen` / `gemini-4-argon` / `gemini-4-argon`, in fast/daily/frontier order. `effort recommend` prints the model and tier.
- The fast tier is advice unless the user allows it (`rules-0.6`, decided 2026-11-19 after the held-out runs). Automatic routing runs a fast pick on the daily model at medium effort unless `--allow-fast`, `"allowFast": true` in a routing configuration, or `EFFORT_ALLOW_FAST=1` allows it. The Claude Code plugin routes to `route-fast` only with `EFFORT_ALLOW_FAST=1` next to `EFFORT_AUTO_ROUTE=1`. See [allowing the fast tier](automatic.md#allowing-the-fast-tier).
- A `--model` pin takes precedence. In `effort auto`, a user's `--routing-config` table overrides the built-in model; otherwise routing uses the tier model, then the current/default model. Managed runs retry once with the provider default only when an automatically chosen model was rejected before a turn was submitted.
- Managed runs support Codex, Claude Code, and Gemini through the Antigravity CLI (`agy`, or `EFFORT_GEMINI_BIN`). Claude and Gemini also have resumable managed text sessions. Gemini grants file permissions for that session only, never allows shell commands, and reports tokens without cost.
- With routing enabled, the Claude Code plugin's prompt hook asks Claude to invoke `route-fast` (Haiku, low effort, fork; only when the fast tier is allowed), `route-frontier` (Fable, high effort, fork), or `route-hard` (high effort in the main conversation). Ordinary prompts stay on the session's settings. Hooks cannot set model or effort directly; routing depends on Claude following the instruction. A fork has no earlier conversation unless Claude passes it along. The Claude managed adapter accepts Haiku 5.x effort controls.
- `effort auto codex` starts with a built-in WebSocket server and no extra package. Its router discovers capabilities and rewrites eligible `turn/start` requests. OpenCode hooks apply advertised effort variants before requests. Automatic routing retains bounded conversation context, effort bounds, pins, and downgrade hysteresis without saving prompts.
- Desktop MCP and the dashboard remain advisory. Existing Codex and Claude desktop conversations remain outside the automatic integrations. The project still has zero runtime dependencies.

## Verified live on 2026-11-16

These functional checks used macOS, Node 26.13, Claude Code 2.1.310, codex-cli 0.160.0, and agy 1.5.9. They were supplied as the checkpoint's live evidence; this documentation pass made no provider calls.

- A headless Claude Code session on Sonnet 5.5 at medium effort loaded the real plugin directory. `Fix the typo in README.md` invoked `effort-project:route-fast`; a `claude-haiku-5-5` fork fixed the typo, with tool hooks reporting low. `Add a second heading called Usage to README.md` invoked no skill and stayed on Sonnet at medium. A race-condition investigation invoked `effort-project:route-frontier`; a Fable fork fixed the bug, with tool hooks reporting high. The list-price cost was about $0.67 for the race check and about $0.07 for each of the other two, not a savings comparison.
- A separate non-forked skill with `effort: low` moved the main conversation from high to low for the rest of that turn. Its `model:` field did not change the main conversation's model.
- A WebSocket client drove the real `codex app-server` behind Effort's router and built-in server. From a default of `gpt-6.1-sol` at max, a typo turn was rewritten to `gpt-6-luna` at low with `modelSelection: automatic`, completed, and appeared as `gpt-6-luna` / low in Codex's own session record. This did not drive the official terminal UI.
- `effort run --provider gemini` selected `gemini-4-hydrogen` at low automatically for a rename-typo task. agy's log label read `Gemini 4 Hydrogen (Low)`, and the verification command passed.

See [validation](validation.md) for the full record and local checks. Ordinary tests use fake providers; they require no account credentials or global provider configuration. GitHub Actions remains disabled; verify locally.

## What remains

- Support Google's own Gemini CLI and a native Antigravity plugin.
- Model routing is now benchmarked (`--arms routing`; results in [bench/PILOT.md](../bench/PILOT.md#model-routing-pilot-2026-11-17)). On 17 tasks, routing matched the daily model's pass rate at slightly higher Claude cost and about a sixth of the frontier model's cost; every failure was `node-bank-ledger`, a money-handling task the rules sent to the daily tier. Finish the rate-limited Gemini run with `--resume`.
- The held-out corpus (40 tasks) has run on Claude and Codex ([bench/PILOT.md](../bench/PILOT.md#held-out-round-4-2026-11-18)). It is still inconclusive on quality, and on Codex routing saved no tokens. The Gemini run stopped at 69 of 160 runs when the weekly `gemini-4-argon` quota ran out; finish it with `--resume` after 2026-11-26. The fast tier's silent failures are handled by making it opt-in (`rules-0.6`); a benchmark has not measured that default as its own run yet.
- Gemini prompts carry a list of at most 400 workspace files because Antigravity 1.5.12 has no file-listing tool. Larger projects are listed in part; revisit when agy offers a listing tool.
- Windows was checked live on 2026-11-19 for the Claude Code plugin routes and managed Claude runs ([validation](validation.md#windows-live-check-of-the-routes-2026-11-19)). Two problems turned up, neither specific to Windows. Claude Code 2.1.325's `cc-plugin-privacy` built-in stops every managed Claude turn on the 0.3.2 adapter. And the plugin's follow-up inheritance never finds the earlier prompt, because 2.1.325 transcripts carry entries larger than the 64 KiB tail the hook reads. Still to check: Linux, and on Windows the Codex router, OpenCode and Gemini.

Run commands from the repository root with Node 22 or later. [Automatic setup](automatic.md) describes permissions, session lifetime, evidence, and limitations. A run has no universal spending cap; frontier models can cost more.
