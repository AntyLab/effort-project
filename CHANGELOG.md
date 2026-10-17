# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Versions follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html); while the major version is 0, any release may include incompatible changes.

## [Unreleased]

### Added

- Experimental automatic effort routing. Effort chooses an effort level locally before each user prompt, using the prompt wording, bounded repository metadata, the previous decision, and the controls the host supports. It makes no classifier API call and keeps no prompt history. A fixed `--effort` or `--model`, and the `--min-effort` and `--max-effort` bounds, take precedence over the rules. See [automatic effort routing](docs/automatic.md).
  - `effort auto claude`: an Effort-managed text conversation that resumes the same Claude Code session between prompts through the existing restricted adapter. It does not attach to the native Claude interface.
  - OpenCode plugin: `effort config opencode` prints a project plugin wrapper that applies an advertised effort variant before requests. Explicit variants and configuration are preserved, and the selected model stays unchanged.
  - `effort auto codex` (prototype): a launcher that routes `turn/start` requests for the official Codex terminal through a private loopback WebSocket router. It needs the `ws` package, which is not installed or declared, so it stops before starting a provider. `--dry-run` validates the configuration.
  - Optional model routing with `--routing-config`, a JSON file containing `models`, `minEffort` and `maxEffort`. It is off by default, and the default keeps your selected model.
- `effort doctor --json` and the `effort_capabilities` MCP tool now list the automatic Claude session and the OpenCode plugin together with their limits.
- A [handoff document](docs/HANDOFF.md) describing what is implemented, what was verified, and what remains for the automatic integrations.
- Offline tests for the automatic integrations and the dashboard frontend, using fake processes and, for the Codex transport, a mocked WebSocket. `npm run smoke:package` also checks the automatic dry run and the OpenCode plugin import.
- Documentation of the automatic integrations' security boundaries in [SECURITY.md](SECURITY.md).
- Contribution tooling: issue forms for bug reports, feature requests and integration reports, a pull request template, a [Code of Conduct](CODE_OF_CONDUCT.md), and this changelog.

### Changed

- The dashboard was reworked for first use and small screens: a short overview, section navigation, revised wording, and an initial order that shows the recommendation form first while history is empty and run history first once it has entries. The main controls are at least 44px high, the "Generic" provider choice is now labeled "Other tools", and the setup section explains how to run the commands from a source checkout. Layouts from 320px wide to desktop were inspected; full screen-reader and physical-device testing was not performed (see [validation](docs/validation.md)).

### Fixed

- Opening `web/index.html` directly left an unstyled page stuck on "Connecting". It now shows a clearly labeled file preview with startup instructions and working command copying. Recommendations and history still need the running local server.
- A dashboard tab with a missing or expired session now picks up a newly opened access URL, keeps the task text you had entered, and consumes the token fragment from the address.
- A Codex adapter test no longer races the fake CLI's startup. This changes test code only; no provider behavior changed.

## [0.1.0] - 2026-09-26

First experimental release. It is a transparent rules controller, not a trained predictor, and it has not demonstrated lower cost at equivalent coding quality. The [validation record](https://github.com/AntyXO/effort-project/blob/v0.1.0/docs/validation.md) states what was and was not tested.

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

[Unreleased]: https://github.com/AntyXO/effort-project/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/AntyXO/effort-project/releases/tag/v0.1.0
