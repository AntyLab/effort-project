# Validation record

Release: **0.3.2 experimental**. This is a functional acceptance record, not a study of coding quality or cost savings. Historical checks retain their dates and environments below.

## Gemini, OpenCode and Codex on 0.3.1, 2026-11-19

macOS, Node 26.13, Effort 0.3.1 (`rules-0.5`), agy 1.5.12, OpenCode 1.19.5, codex-cli 0.170.0. Functional checks, not quality or cost evidence.

- **Gemini.** `effort run --provider gemini` on a one-file typo task chose `gemini-4-hydrogen` at low effort automatically, the file was fixed, and the `node --test` verification passed.
- **Gemini, after the file-list fix in 0.3.2.** In the held-out benchmark eight Gemini runs had ended with no file changed, because Antigravity 1.5.12 has no tool to list files and Gemini started a sub-agent to look for them. With the workspace file list in the prompt, 69 benchmark runs on `gemini-4-argon` and `gemini-4-hydrogen` all passed, and Antigravity's conversation records for those turns show no sub-agent. Not checked: a project with more than 400 files, and whether the session's `write_file` permission lets Gemini write outside the workspace.
- **OpenCode.** With no credentials and the free `opencode/flint-40b-free` model, the plugin from `effort config opencode` saved as `.opencode/plugins/effort.mjs` was not loaded: two runs logged nothing from Effort. Saved as `effort.js`, a typo prompt logged `Automatic effort: apply` with `effort=low` and a race-condition prompt logged `apply` with `effort=high`. The instructions now say `effort.js`. `providerAccepted` stays `null`.
- **Codex.** Checked later the same day on codex-cli 0.170.0, once the weekly limit had reset, with the `gpt-6.2` tiers that ship in 0.3.2. `effort run --provider codex` chose `gpt-6-luna` at low effort for a typo task and `gpt-6.2-sol` at medium for an ordinary task; both runs were verified, and Codex's own session records show the same model and effort. A WebSocket client driving the real `codex app-server` behind Effort's router had a turn rewritten from `gpt-6.2-astra` / medium to `gpt-6-luna` / low. Not confirmed: a prompt typed into the official terminal UI on 0.170.0. Scripted `expect` runs fail there for plain Codex too, without Effort: the UI waits for replies to its `OSC 10/11` colour queries and expects `ESC[13u` for Enter, and turns then end with "N warnings" and no session record. The November 17 check on 0.160.0 below is still the latest terminal UI evidence.

## Suggestion line in the Claude Code terminal UI, 2026-11-18

macOS, Claude Code 2.1.310, Haiku 5.5. One functional check, not quality or cost evidence.

- The interactive terminal UI was started with `--plugin-dir` and driven with `expect`. A typed typo prompt showed `UserPromptSubmit says: Effort suggests haiku · low effort for this prompt (/model haiku, /effort low).` under the prompt before Claude answered. No skill was invoked. Follow-up inheritance and the desktop Code tab were not checked.

## Codex terminal UI and OpenCode, 2026-11-17

macOS, Node 26.13, codex-cli 0.160.0, OpenCode 1.19.5. Functional checks, not quality or cost evidence.

- **Official Codex terminal UI.** `effort auto codex` was started in a disposable folder and driven with `expect` in a 120×40 pseudo-terminal. Before the fix, every typed prompt ended with the UI showing "Reconnecting to server" and disconnecting. A trace of method names showed why: right after `turn/started`, Codex's app-server sent a single message over 8 MiB (this account has many skills and MCP servers), and the router's 8 MiB message limit closed the whole session. With the limit at 64 MiB, the typo prompt was rewritten from the UI's default `gpt-6.1-sol` to `gpt-6-luna` at low and completed in about 5 seconds with the corrected sentence. Codex's own session record showed `gpt-6-luna` / low. The one-time folder-trust prompt was accepted for the disposable folder; the hooks prompt was answered with "Continue without trusting".
- **OpenCode.** OpenCode 1.19.5 with no credentials, using the free `opencode/flint-40b-free` model, which advertises low, medium and high variants. With the plugin from `effort config opencode` in `.opencode/plugins/`, a typo prompt logged `Automatic effort: apply` with `reasoningEffort: low`, and a race-condition investigation logged `apply` with `reasoningEffort: high`. The request options OpenCode sent carried those values. `providerAccepted` stays `null`: the provider does not report the applied effort. An earlier attempt on `opencode/beam-free` logged nothing because that model hung before any request; the plugin loaded and its `config` hook ran.

## Model and effort routing, 2026-11-16

The supplied live evidence was gathered on macOS with Node 26.13, Claude Code 2.1.310, codex-cli 0.160.0, and agy 1.5.9. These are functional checks of routing and task completion. No new provider calls were made during this documentation pass.

### Claude Code plugin

A headless session on Sonnet 5.5 at medium effort loaded the real plugin directory:

| Prompt | Observed route and result |
| --- | --- |
| `Fix the typo in README.md` | Invoked `effort-project:route-fast`; a `claude-haiku-5-5` fork fixed the typo, and tool hooks reported low effort |
| `Add a second heading called Usage to README.md` | Invoked no skill and stayed on Sonnet at medium effort |
| A race-condition investigation | Invoked `effort-project:route-frontier`; a Fable fork fixed the bug, and tool hooks reported high effort |

The race check cost about $0.67 at list price, against about $0.07 for each of the other two. The tasks differ, so these figures do not establish savings or quality differences.

A separate probe used a non-forked skill with `effort: low`. It moved the main conversation from high to low for the rest of the turn, while the skill's `model:` field did not change the main conversation's model. Hooks cannot set model or effort directly. The plugin asks Claude to invoke a skill; a model change runs in a fork, while the main model reads the prompt and relays the answer. Earlier conversation reaches the fork only if Claude passes it along.

### Codex router

A WebSocket client drove the real `codex app-server` behind Effort's router and built-in WebSocket server. The session default was `gpt-6.1-sol` at max effort. A typo prompt was rewritten to `gpt-6-luna` at low with `modelSelection: automatic`, and the turn completed. Codex's own session record showed `gpt-6-luna` / low. The official terminal UI itself was not driven by this check; its start-up through the router is recorded under the managed-run matrix below.

### Gemini through Antigravity

`effort run --provider gemini` on a rename-typo task automatically chose `gemini-4-hydrogen` at low. agy's log label read `Gemini 4 Hydrogen (Low)`, and the task passed its verification command. This checks the Antigravity CLI integration, not Google's own Gemini CLI or a native Antigravity plugin.

### Managed-run matrix

Nine `effort run` tasks, three per provider, each in a disposable workspace with `--allow-write` and `node test.mjs` as the verification command. Every test failed before the run. Nothing pinned the model or the effort.

| Provider | Task | Chosen model | Effort | Evidence of what ran | Result |
| --- | --- | --- | --- | --- | --- |
| Codex | Rename a misspelled export | `gpt-6-luna` (fast) | low | Thread readback: `gpt-6-luna`, low | verified, 1 attempt |
| Codex | Add `slugify` | `gpt-6.1-sol` (daily) | medium | Thread readback: `gpt-6.1-sol`, medium | verified, 1 attempt |
| Codex | Fix a lost-update race | `gpt-6-astra` (frontier) | high | Thread readback: `gpt-6-astra`, high | verified, 1 attempt |
| Claude | Rename a misspelled export | `haiku` (fast) | low | Stream reported `claude-haiku-5-5`; effort is a launch flag, not reported back | verified in 3 of 7 runs before the fix below, 6 of 6 after |
| Claude | Add `slugify` | `opus` (daily at the time; now `sonnet`) | medium | Stream reported `claude-opus-5-5` | verified, 1 attempt, about $0.03 |
| Claude | Fix a lost-update race | `fable` (frontier) | high | Stream reported `claude-fable-5-1` | verified, 1 attempt, about $0.17 |
| Gemini | Rename a misspelled export | `gemini-4-hydrogen` (fast) | low | Log label "Gemini 4 Hydrogen (Low)", 154 thinking tokens | verified, 1 attempt |
| Gemini | Add `slugify` | `gemini-4-argon` (daily) | medium | Log label "Gemini 4 Argon (Medium)", 376 thinking tokens | verified, 1 attempt |
| Gemini | Fix a lost-update race | `gemini-4-argon` (frontier) | high | Log label "Gemini 4 Argon (High)", 1,015 thinking tokens | verified, 1 attempt |

The Claude rename task first ended `blocked` in 4 of 7 runs: Haiku made the edit, then asked for `Bash` to run the test, and the adapter stops a turn that requests a tool it does not offer. The adapter now appends a fixed system note listing the tools that exist and saying the caller runs its own checks, and its error event names the refused tool. After that change the same task was verified in 6 of 6 runs. Six runs do not show the request can no longer happen.

The official Codex terminal UI was also started through `effort auto codex`. It connected through the built-in server and drew its normal start screen. No prompt was typed into it, so a routed turn in the terminal UI itself has not been observed; the WebSocket client check above covers the routing.

These runs show that the chosen model and effort were requested and, where the provider reports it, applied, and that each small task passed its own test. They do not compare quality or cost between tiers.

## Automatic integration prototype, 2026-09-26

This historical checkpoint used macOS and Node 24.16.0.

The local prototype adds **79 tests**: 9 shared routing-policy tests, 7 CLI/configuration tests, 18 managed-session tests, 20 OpenCode hook tests, 17 Codex routing tests, and 8 transport lifecycle tests. **All 154 tests passed locally with no failures or skips**; 30 JavaScript files passed syntax checks. The packed archive also passed an offline temporary install with automatic CLI dry-run and OpenCode plugin import, alongside the existing MCP/dashboard checks.

At this checkpoint, transport tests used real loopback TCP/HTTP and fixture subprocesses but injected a mocked WebSocket implementation. They established authentication gates, request rewriting, transparent approvals/cancellation, hidden internal discovery responses, immediate-startup cancellation, and child cleanup. They did not establish actual WebSocket framing or official Codex terminal compatibility. The launcher then stopped for a missing `ws` package. The built-in server and November 16 live check above supersede that dependency limitation; the official terminal UI still needs a manual check.

OpenCode hooks were checked against v1.18.32 source contracts. The managed Claude session used the existing restricted CLI adapter and verified session-resume semantics in fake-process tests. No new native OpenCode acceptance, official Codex terminal acceptance, billed automatic-session model runs, desktop attachment, or savings evaluation was performed at that checkpoint. Later routing checks are recorded above; historical adapter live checks below are separate evidence.

## Deterministic acceptance

Local checks on 2026-11-16 used macOS and Node 26.13.0. The final `npm test` run reported 370 tests: 320 passed, 40 failed, and 10 skipped. All five acceptance-script tests passed. Thirty-nine failures were blocked by the sandbox denying loopback listeners (`listen EPERM` on `127.0.0.1`); an existing Claude terminal-JSON fixture timed out in the full run and passed in isolation. An earlier full run also had a descendant-cleanup assertion failure that passed in isolation. `npm run check` passed syntax checks for 99 JavaScript files. `npm run smoke:package` completed the offline pack/install and zero-dependency assertion, then the sandbox blocked its dashboard listener with the same `listen EPERM` error; the full smoke check did not pass.

`node scripts/live-acceptance.mjs` prints a plan and checks the disposable typo, feature, and race fixtures without starting a provider. Every starting fixture must fail, and a reference fix must pass. `--providers codex,claude,gemini` selects providers; `--max-runs` is a hard cap, and provider execution requires `--live`. Live records contain routing metadata and observed evidence, not prompts or responses. Usage stays per attempt; the last reported cost is retained without summing conversation totals. This pass exercised only the offline mode.

The release suite covers the policy and its uncertainty, effort caps, repeated-failure recovery, environment/authentication stops, session preservation, unsupported models, approval denial, malformed and excessive provider output, subprocess timeout/abort cleanup, usage accounting, private metadata boundaries, MCP negotiation/calls/termination, and dashboard authentication/Host/Origin checks.

Before the automatic prototype, the development host passed **75 tests, with zero failures or skips**. The JavaScript syntax check also passed. The September 26 expanded local suite is reported above.

Run `npm test` and `npm run check`. Ordinary tests use fake providers and temporary fixtures, make no paid model calls, and do not modify provider configuration. GitHub Actions is turned off for this repository, so there are no CI results: platform results come from local runs, and a pull request should say which platforms and Node.js versions it was tested on. POSIX-only process-group assertions are explicitly skipped on Windows.

Independent review found and corrected four defects before publication: surviving verifier descendants; unstable failure signatures caused by test timing output; swallowed MCP termination signals; and hidden provider diagnostics. Real repeated failing Node tests now produce the same signature. Verification removes node:test's inherited nesting marker so the requested child tests actually execute.

The first CI matrix also exposed a Codex cancellation race on macOS/Node 24: the parent could close before a descendant was reaped. A stronger fixture reproduced that failure locally by making the child ignore SIGTERM. The adapter now confirms process-group disappearance with a bounded deadline. All 32 Codex tests and 20 repeated stubborn-child cancellations passed after the fix; the child-absence assertions remain strict.

That confirmation was itself flaky on macOS/Node 24 CI (run 36253275525): the cancelled turn reported `failed` after about 586 ms, too soon for the one-second wait to have expired. The check returned on the first error that was not `ESRCH`. On macOS, `kill(-pgid, 0)` returns `EPERM` while the group holds only exited members that launchd or the adapter's own process has not yet reaped. The adapter now keeps waiting through `EPERM` until `ESRCH`, with a 500 ms `SIGTERM` grace period and up to five seconds after `SIGKILL`. A deterministic test drives the wait through each live/unreaped/gone sequence. The descendant-absence assertions are unchanged. This explanation is inferred from the CI timing and macOS `kill` semantics. It has not been reproduced on a Mac, and GitHub Actions is now off for this repository, so confirming it needs `npm test` on macOS.

A later run alongside package checks exposed a test-only startup race: the 300ms timeout could expire before the fake CLI accepted its turn. That test now waits for acceptance, advances the same deadline with Node's mock timer, and restores real timers for cleanup. Its timeout, interrupt-message, and dead-process assertions remain intact, with a separate real-time watchdog. No provider behavior changed.

## Live provider checks

| Check | Version/model | Evidence and limit |
| --- | --- | --- |
| Codex new turn at low, resume at high | CLI 0.153.4, gpt-6-astra | Both completed in the same thread and recalled a marker. The app-server accepted explicit effort and thread readback matched low/high. This confirms configuration, not internal reasoning quality. |
| Claude new turn at low, resume at high | CLI 2.1.282, claude-opus-5-5[1m] | Both completed in the same session and recalled a marker. Launch flag plus child environment requested low/high. Applied internal effort is not observable; organization caps can apply. |
| Codex constrained file repair | Same Codex version/model, low | Corrected addition in a disposable sum module on the first attempt. Independent positive/negative/zero checks passed. The verifier file stayed byte-identical. |
| Claude restricted file repair | Same Claude version/model, low | Corrected addition in a disposable sum module. Independent positive/negative/zero checks passed. The verifier file stayed byte-identical. |

An unadvertised Codex model was rejected before a model task, as intended. Initial integration tests also exposed two Claude compatibility issues: a native built-in plugin descriptor and missing OS identity environment variables needed for macOS Keychain. Both were corrected with regression tests. No credentials were printed or published.

The first Codex edit check stopped at an approval request. Explicitly authorized write runs now use the provider's workspace-write sandbox with its on-request approval policy; approval requests themselves are still denied. The revised edit check passed within the disposable workspace, with network access disabled.

Provider tests used disposable workspaces. Codex used a separate local runtime directory. The user's existing Codex config.toml and Claude settings.json retained their original hashes. Claude retains its own normal transcripts for session resume; Effort's metadata store does not retain task prompts or responses.

## Interface checks

The actual local dashboard was inspected in a browser: real empty/history states, high and low recommendations, keyboard submit, copy buttons, reload/session retention, 390px layout without horizontal overflow, dialogs and focus return, filtering, zero versus missing usage, untrusted strings rendered as text, and authentication/offline behavior. No browser console errors were observed. Full screen-reader testing was not performed.

The September 26 dashboard usability update was checked with the real frontend and local API, an empty in-memory store, and three explicitly synthetic run records (including a long model name and missing usage). No provider was launched during this UI review. The initial DOM order now puts recommendations first for empty history and run history first for populated history; later refreshes do not move the panels or interrupt an interaction already underway.

- Inspected desktop, 768px tablet, 390px phone, and 320px narrow layouts. No page horizontal overflow was measured; the phone dialog also had matching client and scroll widths. On the 390px first-use layout, the recommendation button is fully within the first viewport instead of starting below 1,500px of introductory/history content.
- Measured 44px or larger heights for Refresh, provider options, outcome filtering, Copy, and dialog Close; the primary action is 48px high. Task input is 16px, with 13–14px secondary text. Contrast calculated from resolved CSS colors is 5.27:1 for secondary text on the page background, 5.61:1 for the placeholder, and 6.61:1 for the primary button.
- Verified required-input feedback, provider-change invalidation, Codex/Claude recommendation templates, and advisory-only guidance for other tools. Copied templates contain literal task/path placeholders and a validated provider/effort, omit write permission, and never interpolate the entered task into shell syntax.
- Verified no-match filtering and recovery, chronological attempts, native telemetry/identifier disclosures, missing costs shown as “Not reported,” and Escape returning focus to the originating run. Setup shortcuts update the hash and current navigation item; manual desktop scrolling also updates the current section.
- Independent source review caught and corrected width-based IntersectionObserver margins and ambiguous accessible run names. Section observation uses viewport-height pixel margins and rebuilds on resize; run names include their distinguishing ID. Browser console checks found no errors in the connected review session.

Impeccable's detector was unavailable because its engine was not installed; screenshots, DOM measurements, source review, and interaction checks supplied the UI evidence. Physical-device, full screen-reader, and actual 200% browser-zoom testing remain unperformed; viewport reflow is not evidence of those checks.

A follow-up reproduced a missed entry path in the user's Safari tab: opening `web/index.html` directly failed to load the root-relative assets, leaving an unstyled page stuck on “Connecting.” Relative assets and a deferred classic script now render a clearly labeled file preview with startup instructions, working command copying, and disabled server actions. The working dashboard was then started through the real CLI and opened in Safari; a local recommendation returned successfully. The live dashboard was also checked at 390px with matching page client and scroll widths.

The same review reproduced an existing tab failing to adopt a newly opened access URL. Missing and expired sessions now reconnect in that tab without losing the entered draft, and consume the token fragment. Five offline frontend regression tests cover file asset resolution, preview startup without API calls or polling, reload persistence, token adoption, and stale-response handling. These tests execute the shipped script in a minimal DOM harness; native browser behavior was checked separately. No provider task was launched during these checks.

MCP was tested through the packaged command entry point with initialization, tool discovery and calls. This establishes stdio protocol behavior. It does not establish installation into every desktop app, nor automatic effort control of a host conversation.

The download was built and installed into an isolated local prefix. CLI help/recommendation, MCP initialization/tool calls, dashboard HTML/JavaScript/CSS, and the authenticated API passed. `npm run smoke:package` automates this offline archive/install check in a temporary directory. GitHub Actions remains disabled; run it locally.

A 10,000-call microbenchmark of the local rules on two short prompts measured p95 below 0.001 ms and maximum below 0.5 ms on this host. It excludes process startup, repository metadata scanning, provider startup and inference. It is not an end-to-end latency guarantee.

## What remains unproven

- Equal coding quality at lower total cost, or reduced user intervention.
- A calibrated difficulty predictor, multilingual task classification, or personalization.
- Native in-flight effort changes inside Codex/Claude desktop chats.
- The official Codex terminal UI handshake driven by hand, and OpenCode live acceptance.
- Google's own Gemini CLI and a native Antigravity plugin.
- Savings or equal quality on a held-out corpus. The held-out runs are in [bench/PILOT.md](../bench/PILOT.md#held-out-round-4-2026-11-18); they are inconclusive on quality, and the Gemini run is unfinished.
- Windows/Linux live compatibility for the new routes, other provider/CLI versions, or every account/organization policy. Historical Windows Claude checks do not establish those new routes.
- A universal spending cap. Unknown/cumulative usage is not treated as zero or summed as per-turn usage.

The next research step is a controlled held-out task benchmark, described in [architecture.md](architecture.md). These limitations are visible in the product and README; no savings percentage is advertised.
