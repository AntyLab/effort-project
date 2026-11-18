# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Versions follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html); while the major version is 0, any release may include incompatible changes.

## [Unreleased]

### Added

- Results of the first held-out benchmark, 40 new tasks on Claude, in [bench/PILOT.md](bench/PILOT.md#held-out-round-4-2026-11-18), and the README's savings table now uses them. Routing cost about a ninth of always using the frontier model, saved almost nothing against the daily model, and failed one task that both fixed models passed.

## [0.3.0] - 2026-11-18

Third experimental release: the Claude Code plugin now suggests a model and effort on every prompt and routes only when asked, Claude's daily tier is Sonnet, the rules cover more words and languages, and model routing has its first benchmark. Equal quality at lower cost is still not shown.

### Added

- Benchmark arms that route the model as well as the effort (`--arms routing`), six harder tasks, and the first model-routing results in [bench/PILOT.md](bench/PILOT.md#model-routing-pilot-2026-11-17). On Claude, routing cost about a sixth of always using the frontier model and no less than defaulting to the daily model.

### Changed

- The Claude Code plugin now shows a model and effort suggestion for every eligible prompt without changing Claude's behavior. Set `EFFORT_AUTO_ROUTE=1` in Claude Code's `settings.json` env to opt into the existing low/high skill routes; medium stays advisory. Short follow-ups without a rule signal can inherit a recommendation from up to three earlier user prompts in the last 64 KiB of the local transcript, read without storing or logging its text.
- Claude's built-in daily model is now `sonnet` instead of `opus`; fast remains `haiku` and frontier remains `fable`.
- Policy `rules-0.3` recognizes more costly-error, investigative and mechanical English keywords, including login, passwords, billing, destructive data changes, privacy, crashes, performance, comments, lint and version bumps. Basic Spanish, French, German, Portuguese and Italian keyword coverage uses Unicode word boundaries. Risky and investigative words still take precedence over short mechanical edits.
- Policy `rules-0.4` also treats money movement as risky: funds, balances, ledgers, refunds, payouts, withdrawals, deposits and money or bank transfers, with basic Spanish, French, German, Portuguese and Italian equivalents. Such prompts start at high effort; the model tier is unchanged unless the prompt also asks for investigation. Added after every benchmark failure turned out to be the `node-bank-ledger` task, so that task no longer counts as held out for this rule.

### Fixed

- `effort auto codex` no longer drops the official terminal UI's session when Codex sends a single message larger than 8 MiB, which happens right after a turn starts for users with many skills, plugins or MCP servers. The router's message limit is now 64 MiB.
- Two tests added in 0.2.0 now pass on Windows. The route-skill test accepts the CRLF line endings that Git for Windows checks out by default, and the WebSocket terminate test waits for the server end to finish closing, not only the client end. This changes test code only.
- On Windows, command lookup now finds programs installed as app execution aliases, such as the `py` launcher that the Python install manager puts in `%LOCALAPPDATA%\Microsoft\WindowsApps`. Node cannot read these entries, so a verification command such as `py -m pytest` stopped with "was not found on PATH". The benchmark harness now picks only a Python that this lookup finds, and its checks run the interpreter it probed.

## [0.2.0] - 2026-11-16

Second experimental release: automatic model and effort routing for Claude, Codex and Gemini, a Claude Code plugin that routes through its own skills, a Codex terminal router with no extra package, an offline benchmark harness, and the fixes from the October 2026 review. Effort still has not demonstrated lower cost at equivalent coding quality.

### Added

- Experimental automatic model and effort routing. Effort chooses a model and effort level locally before each user prompt, using the prompt wording, bounded repository metadata, the previous decision, and the controls the host supports. It makes no classifier API call and keeps no prompt history. A fixed `--effort` or `--model`, and the `--min-effort` and `--max-effort` bounds, take precedence over the rules. See [automatic effort routing](docs/automatic.md).
  - `effort auto claude`: an Effort-managed text conversation that resumes the same Claude Code session between prompts through the existing restricted adapter, choosing a model and effort. It does not attach to the native Claude interface.
  - OpenCode plugin: `effort config opencode` prints a project plugin wrapper that applies an advertised effort variant before requests. Explicit variants and configuration are preserved, and the selected model stays unchanged.
  - `effort auto codex`: a launcher that routes `turn/start` requests for the official Codex terminal through a private loopback WebSocket router. A small built-in WebSocket server keeps the project free of runtime dependencies. `--dry-run` validates the configuration.
  - Built-in model routing, with a `--model` pin and an `effort auto --routing-config` table as overrides. The JSON file accepts `models`, `minEffort` and `maxEffort`. Precedence is pin, configured effort table, built-in tier model, then current/default model.
- `effort doctor --json` and the `effort_capabilities` MCP tool now list the automatic Claude session and the OpenCode plugin together with their limits.
- An offline-first acceptance script, `scripts/live-acceptance.mjs`, for typo, feature and race-condition tasks across selected managed providers. It prints the plan and checks failing starting fixtures by default; provider runs require `--live` and obey a hard run cap. Its optional JSONL output records routing, observed settings, outcomes, usage and timings without prompts or model output.
- A [handoff document](docs/HANDOFF.md) describing what is implemented, what was verified, and what remains for the automatic integrations.
- Offline tests for the automatic integrations and the dashboard frontend, using fake processes and, for the Codex transport, a mocked WebSocket. `npm run smoke:package` also checks the automatic dry run and the OpenCode plugin import.
- Documentation of the automatic integrations' security boundaries in [SECURITY.md](SECURITY.md).
- Contribution tooling: issue forms for bug reports, feature requests and integration reports, a pull request template, a [Code of Conduct](CODE_OF_CONDUCT.md), and this changelog.
- A [Claude Code plugin](docs/claude-code-plugin.md), installable from this repository's plugin marketplace. Its `UserPromptSubmit` hook asks Claude to invoke routing skills: `route-fast` works in a fork on Haiku at low effort, `route-frontier` in a fork on Fable at high, and `route-hard` sets high effort for the rest of the turn on the session model. Ordinary prompts stay unchanged. Hooks cannot set model or effort directly, and a skill changes the main conversation's effort but not its model. Forks need Claude to pass earlier context. The plugin also adds Effort's read-only MCP server and an `explain` skill.
- An offline-first [benchmark harness](bench/README.md) that compares fixed effort levels with Effort's routing on eleven small Node.js and Python tasks with hidden acceptance checks. By default it runs against fake providers; real turns need `--live` and a `--max-runs` cap. Its first live pilot ([bench/PILOT.md](bench/PILOT.md), Claude Sonnet 5.5) was inconclusive on quality, because every arm passed every task, so it supports no savings claim yet.
- `effort run` options: `--verify-timeout` to give the check a shorter limit than the task, and the verification command after `--` or as repeated `--verify-arg` parts.
- Gemini managed runs and automatic text sessions through the Antigravity CLI: `effort run --provider gemini` and `effort auto gemini`. File permissions last for the session only; shell commands are never allowed. Usage includes tokens but no cost. `effort doctor` checks the third provider.
- `EFFORT_CODEX_BIN`, `EFFORT_CLAUDE_BIN` and `EFFORT_GEMINI_BIN` select a specific provider CLI installation; `effort doctor` reports which one Effort will start.
- `runTask` accepts `maxTurns` (1–50) for the Claude adapter and passes it to every attempt. Other adapters refuse it.

### Changed

- Effort now chooses a model alongside effort. Fast covers short mechanical requests; frontier requires both high-stakes and investigative or tangled work; daily covers everything else. Built-in fast/daily/frontier models are Claude haiku/opus/fable, Codex gpt-6-luna/gpt-6.1-sol/gpt-6-astra, and Gemini gemini-4-hydrogen/gemini-4-argon/gemini-4-argon. `effort recommend` prints the model and tier.
- `effort run` falls back once to the provider default when an automatically chosen model is explicitly rejected before a turn is submitted. Pinned models do not fall back.
- The npm package is now named `effort-project` (previously `@antyxo/effort-project`). If you installed the old name globally, remove it with `npm uninstall --global @antyxo/effort-project`.
- The number of languages in a checkout no longer changes the recommended effort; it describes the repository, not the request. A request that names five or more workspace files raises effort by one level, never past high. The policy version is now `rules-0.2`.
- `effort run` now allows 600 seconds per task by default (previously 120), verification included. A check may use the time left in the task instead of stopping at 60 seconds. A Claude turn is still limited to 30 minutes.
- The README now leads with one-time setup for each tool and treats the dashboard as optional. The full `effort run` reference moved to [managed runs](docs/managed-runs.md).
- The dashboard was reworked for first use and small screens: a short overview, section navigation, revised wording, and an initial order that shows the recommendation form first while history is empty and run history first once it has entries. The main controls are at least 44px high, the "Generic" provider choice is now labeled "Other tools", and the setup section explains how to run the commands from a source checkout. Layouts from 320px wide to desktop were inspected; full screen-reader and physical-device testing was not performed (see [validation](docs/validation.md)).

### Fixed

- Managed Claude turns now receive a system note listing their available tools and explaining that the caller runs tests, to avoid shell requests after editing; unoffered tool requests still stop the turn.
- `effort auto codex` starts with the built-in WebSocket server instead of requiring the undeclared `ws` package.
- The Claude adapter accepts Haiku 5.x models, which support effort.
- Requests mentioning payments or migrations now match the documented high-effort rule, including those plural spellings.
- Repository file mentions no longer count a filename used as a directory prefix in a longer path.
- Command lookup resolves relative PATH entries against the verification command's working directory. Explicit Windows executable paths without an extension resolve to the existing `.exe` or `.com` file.
- Automatic Claude sessions accept decimal timeout values such as `--timeout 16.1` without floating-point validation errors.
- Process cleanup timeout tests wait for real descendant readiness before advancing a controlled timeout clock, so slow fixture startup cannot bypass the cleanup assertions.
- Opening `web/index.html` directly left an unstyled page stuck on "Connecting". It now shows a clearly labeled file preview with startup instructions and working command copying. Recommendations and history still need the running local server.
- A dashboard tab with a missing or expired session now picks up a newly opened access URL, keeps the task text you had entered, and consumes the token fragment from the address.
- A Codex adapter test no longer races the fake CLI's startup. This changes test code only; no provider behavior changed.
- A failing test whose output mentions authorization, permissions or a missing file is now treated as a test failure and retried, instead of stopping the run as an access or setup problem. A suite that could not start still stops the run.
- Failure fingerprints ignore run-specific details such as temporary paths, ports, process IDs, times and IDs, and keep different failures apart, so a repeated failure is recognized reliably.
- A check whose process has exited no longer waits for a background child that keeps its output open.
- On Windows, Effort starts npm-installed provider CLIs (`.cmd` shims) and verification commands such as `npm` without a shell.
- On macOS, Codex cleanup keeps waiting for the process group while it reports `EPERM`, instead of treating it as gone.
- The Codex adapter no longer leaves timers that keep the process alive after a turn.
- `effort run --dry-run` now makes the same option checks as a run, including whether the verification command can start.
- The CLI, MCP server and dashboard report the version from `package.json` instead of a hard-coded one.
- Resumed Claude turns report their own token counts when the turn's stream confirms them (`tokenScope: "turn"`); otherwise the counts stay `null`, as before.
- Managed Claude turns work with Claude Code 2.1.299. In safe mode it reports two built-in plugins, `cc-plugin-agents-md` and `cc-plugin-plugin-authoring`, and the adapter accepted only the `agents-md` descriptor of 2.1.282, so it stopped every turn with `isolation_mismatch` before any model call. Exactly those two built-in descriptors are now accepted; any other plugin still stops the turn.
- When the model asks for a tool the managed Claude session does not offer, the adapter now reports `tool_not_allowed` instead of `isolation_mismatch`, which stays for configuration the CLI reports. The turn is still stopped and still `blocked`.
- A Claude turn whose stream marks an assistant message with an error, such as `rate_limit` for a request the account's quota refused, keeps that cause when the final result's wording is not one the adapter recognizes. Previously it became a generic CLI failure.
- Benchmark harness: a live run now starts only after asking the CLI that the adapter will start for its version, found the same way as `effort doctor` (`EFFORT_CODEX_BIN` or `EFFORT_CLAUDE_BIN`, then `PATH`). Previously a CLI set only through those variables was refused before the first run.
- Benchmark harness: a run ended by a provider-side failure (not signed in, a usage or rate limit, an unavailable or changed model, an incompatible CLI) is no longer scored as a failed task. It is excluded, the benchmark stops, and `--resume` redoes it.
- Benchmark harness: a run stopped because the model asked for a tool the session does not offer counts against its arm, instead of stopping the benchmark as a provider failure. `meta.json` records the commit of each invocation, and the summary names any later commit a resumed benchmark ran on.
- Benchmark harness: a retried Claude run's cost is the conversation total its last attempt reported (Claude Code 2.1.277 or later), so cost comparisons no longer leave out exactly the runs that retried.
- The workspace scan behind `effort recommend`, `effort run` and automatic routing stopped after 50 ms. On a busy machine it could stop before reaching the files a request names, so a request naming five files could be recommended medium instead of high. The scan now stops after a fixed amount of work, 500 files or 500 directories, and gives the same result however busy the machine is. A very large workspace can take longer than 50 ms to scan: listing 500 directories took 0.05–0.4 seconds on a Windows 11 laptop, depending on other load.

## [0.1.0] - 2026-09-26

First experimental release. It is a transparent rules controller, not a trained predictor, and it has not demonstrated lower cost at equivalent coding quality. The [validation record](https://github.com/AntyLab/effort-project/blob/v0.1.0/docs/validation.md) states what was and was not tested.

### Added

- `effort` command-line tool for Node.js 22 or later, with no npm dependencies and no install hooks: `doctor`, `recommend`, `run`, `history`, `dashboard`, `mcp` and `config`.
- Rule-based effort recommendations for Codex, Claude and generic use. Each result carries its reasons and a caveat, and a `--max-effort` ceiling limits it. The rules are heuristics, not a calibrated difficulty predictor.
- Managed runs through an installed, signed-in Codex or Claude Code CLI, with an explicit effort for each turn and resumable sessions, so a later turn can use a different effort. Runs are read-only unless you pass `--allow-write`, which uses the provider's constrained edit mode. Runs have a time limit, cancellation, bounded output, no shell interpolation of prompts, and process cleanup on timeout or abort. An unsupported model or effort level is rejected rather than replaced.
- A verification loop. After each attempt Effort runs the check you supplied, an executable and arguments rather than a shell string. The first recognized test failure can trigger another attempt at the same effort, and repeated matching failures can raise effort for the next turn. Access, permission, missing-dependency, timeout and unclassified failures stop the run. A run without a check is reported as unverified, and a passing check means only that the check passed.
- Local run history holding task identifiers, effort decisions, coarse repository features, timings, check outcomes, and usage when reliably reported. Prompts, file contents, responses and verification output are not stored.
- A local dashboard (`effort dashboard`) with a recommendation sandbox, run history with outcome filters and per-run details, a compatibility overview, and copyable setup commands. It binds to loopback, requires a random per-process token, checks the Host and Origin headers, sets a restrictive Content Security Policy, loads no external resources, and cannot launch commands.
- An advisory MCP server over stdio with three read-only tools, `effort_recommend`, `effort_observe` and `effort_capabilities`, and `effort config codex|claude` to print host configuration. The tools cannot change the effort of a host conversation.
- Documentation: README, architecture notes, adapter contract, Codex and Claude adapter notes, desktop setup, validation record, [SECURITY.md](SECURITY.md), [CONTRIBUTING.md](CONTRIBUTING.md), and the MIT license.
- Tests that use fake provider processes and temporary directories, a JavaScript syntax check (`npm run check`), and `npm run smoke:package`, which packs the project, installs it offline into a temporary prefix, and exercises the CLI, MCP tools, dashboard assets and authenticated API.
- A GitHub Actions workflow that runs these checks on Linux, macOS and Windows with Node.js 22 and 24.

[Unreleased]: https://github.com/AntyLab/effort-project/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/AntyLab/effort-project/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/AntyLab/effort-project/releases/tag/v0.1.0
