# Claude Code plugin

The Effort Project shows a short model and effort suggestion for every eligible prompt: non-empty, at most 100,000 characters, and not starting with `/` or `!`. By default, it returns only a user-visible message: Claude keeps its current settings, and no skill or fork is started.

| Prompt | Default suggestion |
| --- | --- |
| Short mechanical request, such as fixing a typo | `Effort suggests haiku · low effort for this prompt (/model haiku, /effort low).` |
| Ordinary request without a clear rule signal | `Effort suggests sonnet · medium effort for this prompt (/model sonnet, /effort medium).` |
| Risky or investigative request | `Effort suggests sonnet · high effort for this prompt (/model sonnet, /effort high).` |
| Both risky and tangled, such as investigating an intermittent auth race condition | `Effort suggests fable · high effort for this prompt (/model fable, /effort high).` |
| Short follow-up without a clear rule signal | Inherits a recent earlier request's recommendation when available, with ` Based on your earlier request.` appended |

The model is the alias for the recommended tier: Haiku for fast, Sonnet for daily, and Fable for frontier. You can apply a suggestion with the commands shown in the line. The hook never includes the prompt text in its output. `UserPromptSubmit` carries no current effort level, so the hook does not compare against one.

Automatic routing is opt-in. In Claude Code's `settings.json`, add or merge:

```json
{
  "env": {
    "EFFORT_AUTO_ROUTE": "1"
  }
}
```

The values `1`, `true`, `yes` and `on` enable it, case-insensitively. With routing enabled, high effort with the frontier tier asks Claude to invoke `effort-project:route-frontier` in a fork on Fable at high effort. Other high recommendations ask for `effort-project:route-hard`, which sets high effort for the rest of the turn in the main conversation. Claude relays the fork's result. Medium still shows only the suggestion line.

A low-effort pick, the fast tier, also shows only the suggestion line unless you allow routing to it as well:

```json
{
  "env": {
    "EFFORT_AUTO_ROUTE": "1",
    "EFFORT_ALLOW_FAST": "1"
  }
}
```

With both set, a low-effort pick asks Claude to invoke `effort-project:route-fast` in a fork on Haiku at low effort. The fast tier is opt-in because it saved cents per task in the benchmarks, while a wrong pick of it failed silently. See [model routing](automatic.md#allowing-the-fast-tier).

A hook cannot set model or effort directly. Opt-in routing adds an instruction for Claude to invoke the appropriate skill and retains the routing message, such as `Effort: haiku at low effort for this prompt.` The fork skills select their worker's model and effort; the main-conversation skill sets effort only.

Historical headless functional checks on Claude Code 2.1.310 verified the fast and frontier fork routes and an ordinary prompt left on the session's settings. A separate probe verified a non-forked skill's effort change. The November 16 record below describes these checks; the older checks describe the earlier advisory implementation. These records predate the current suggestion-only default and transcript follow-up support.

## What the plugin adds

| Component | What it does | Context cost |
| --- | --- | --- |
| `UserPromptSubmit` hook | Shows one short model and effort suggestion for each eligible prompt; skill routing is opt-in | None by default; a short instruction in `additionalContext` for low/high when routing is enabled |
| `effort` MCP server | Effort's existing stdio server (`bin/effort.mjs mcp`) with the read-only `effort_recommend`, `effort_observe` and `effort_capabilities` tools | Tool definitions, which Claude Code defers through MCP tool search on supported models |
| Routing skills | `route-fast` and `route-frontier` run the request in a fork; `route-hard` sets effort in the main conversation | Skill descriptions, the invoked body, and any context Claude passes to a fork |
| `explain` skill | Run `/effort-project:explain [task text]`, or ask why Effort made a suggestion. Claude calls `effort_recommend` and explains the model, effort and reasons | Skill description and the invoked body |

## Install

You need Node.js 22 or later available as `node` on your `PATH`, and a current Claude Code. Routing was checked headlessly with Claude Code 2.1.310; earlier installation checks used 2.1.299.

In a Claude Code session:

```text
/plugin marketplace add AntyLab/effort-project
/plugin install effort-project@effort-project
```

Claude Code 2.1.275 and later also accept the one-step form `/plugin install effort-project --marketplace AntyLab/effort-project`. From a shell, use `claude plugin marketplace add AntyLab/effort-project` and then `claude plugin install effort-project@effort-project`.

To try the plugin from a clone for one session, without installing it:

```sh
claude --plugin-dir /path/to/effort-project
```

The marketplace is a third-party marketplace. Like any plugin, the hook and the MCP server run with your user permissions. The code they run is small: [`hooks/prompt-advice.mjs`](../hooks/prompt-advice.mjs), [`src/integrations/claude-code-hook.mjs`](../src/integrations/claude-code-hook.mjs) and [`src/policy.mjs`](../src/policy.mjs) for the hook, and [`bin/effort.mjs`](../bin/effort.mjs) with [`src/mcp.mjs`](../src/mcp.mjs) for the server.

## How the hook decides

1. Claude Code passes the submitted prompt and a `transcript_path` to the hook as JSON on stdin.
2. The hook calls `recommend({ prompt, provider: 'claude', maxEffort: 'high' })`, with no repository facts. It ignores both event effort and `$CLAUDE_EFFORT`.
3. If the trimmed prompt is at most 80 characters and has no critical, complex or mechanical rule signal, the hook can inherit context. It reads at most the last 4 MiB of the transcript, drops any first partial line, and looks at up to three earlier eligible user prompts for the most recent one with a signal. Only lines that can be user entries are parsed. Claude Code 2.1.325 writes attachment and request entries of 100 KB and more, so after one turn the previous prompt can be hundreds of KB before the end. It uses text parts only, skips tool results, metadata and command wrappers, and skips text equal to the current prompt. The path must be absolute; missing, relative or unreadable paths and other read errors fall back to the current prompt's own recommendation.
4. By default, the hook returns only `systemMessage`, containing the recommended model alias, effort and commands. Inherited suggestions append ` Based on your earlier request.` Effort never exceeds high.
5. When `EFFORT_AUTO_ROUTE` enables routing, low selects `route-fast` only if `EFFORT_ALLOW_FAST` is enabled too; otherwise low returns the suggestion line. High with the frontier tier selects `route-frontier`; other high recommendations select `route-hard`. These responses also include `hookSpecificOutput.hookEventName: "UserPromptSubmit"` and a fixed instruction in `hookSpecificOutput.additionalContext`. Medium returns only the suggestion line. For fork routes, the instruction asks Claude to pass the request and needed earlier context to the skill and relay the result; `route-hard` runs before Claude carries out the request in the main conversation.

It prints nothing and exits 0 in these cases:

- The prompt starts with `/` or `!`. Commands and skills reach the hook as typed (`/name arguments`), and `!` lines run a shell. Neither describes the task.
- The prompt is empty or longer than 100,000 characters, the limit of Effort's rules.
- The hook input is malformed, larger than 1 MiB, or has not arrived within 3 seconds.
- Anything else fails. The hook catches every error. Claude Code treats hook failures as non-blocking as well, and `hooks/hooks.json` sets a 5-second timeout.

Claude Code also runs `UserPromptSubmit` hooks when a scheduled task fires, when a background subagent reports back, and when another session sends a message. A suggestion, or an opt-in routing instruction, can appear on those turns too.

## Rule confidence

The rules are a transparent keyword and length heuristic with low confidence. They cover English plus basic Spanish, French, German, Portuguese and Italian keywords and do not measure how hard a task is. Lower cost at equal quality has not been demonstrated. See [validation](validation.md).

## Privacy and safety

- The prompt stays in the hook's memory. It is not written to disk, logged, echoed in the output or sent anywhere. The hook makes no network requests and starts no processes.
- For short follow-ups only, the hook reads at most the last 4 MiB of the absolute `transcript_path` supplied by Claude Code. This local read is read-only; transcript text is never stored, logged, copied into output or sent anywhere. The hook does not scan the working directory.
- The default output contains only a short `systemMessage`. Opt-in routing adds a fixed instruction in `hookSpecificOutput.additionalContext` for low/high. Neither contains prompt text. With routing enabled, Claude passes the request and any needed earlier context to the skill after reading the instruction.
- After an unexpected internal error the hook writes one fixed line to stderr, `effort-project: prompt advice skipped after an internal error.`, which appears only in Claude Code's debug log. It never prints error details, because parser errors can quote the input.
- The plugin stores nothing of its own and does not use `${CLAUDE_PLUGIN_DATA}`. The MCP server is Effort's existing advisory server. See [desktop integration](desktop.md).

`test/claude-plugin.test.mjs` checks these properties. It walks the hook's module graph for network and process modules, file writes and logging calls while allowing read-only filesystem access, and it runs the hook with the home, temp and plugin-data directories pointed at an empty folder, then checks that the folder is still empty and that the prompt appears in no output.

## Performance

On the Windows 11 development machine with Node 24.19, a complete hook run took a median of 65 ms over 20 runs (90th percentile 71 ms), and starting Node with an empty script took 52 ms. Inside Claude Code 2.1.299 on the same machine, the hook finished in 73 to 79 ms after a cold first run of 358 ms. Those numbers were taken while the hook still scanned the working directory, which took about 1 ms. The current hook applies a few regular expressions to the prompt and can read a bounded transcript tail for short follow-ups. The timing measurements above predate that transcript read. Node usually starts faster on macOS and Linux.

## Packaging: the plugin root is the repository root

When Claude Code installs a plugin from a marketplace, it copies the plugin's directory into `~/.claude/plugins/cache/<marketplace>/<plugin>/<version>/` and loads that copy. Files outside the plugin directory are not copied. The hook imports `src/policy.mjs`, and the MCP server runs `bin/effort.mjs`, which loads most of `src/`. The marketplace entry therefore uses `"source": "./"`: the plugin root is the repository root, every install carries the code it runs, and `${CLAUDE_PLUGIN_ROOT}` points at that copy.

Two alternatives were rejected:

- **A self-contained `plugins/effort-project/` directory.** It would need a second copy of `bin/` and `src/` kept in sync with every policy change.
- **A launcher that runs the `effort-project` npm package.** The package is not published yet. `npx` would also download it on first use, and starting npm adds hundreds of milliseconds to every prompt, while the hook must not use the network. Once the package is published, the marketplace entry can switch to an `npm` source if `package.json` `files` then includes `.claude-plugin`, `hooks` and `skills`.

The repository-root layout has these consequences:

- Each install copies the whole repository, a few hundred kilobytes today, including documentation and tests.
- The MCP server is declared in `.claude-plugin/plugin.json`, not in a root `.mcp.json`. Claude Code would also read a root `.mcp.json` as project MCP configuration for anyone who opens this repository, where `${CLAUDE_PLUGIN_ROOT}` is undefined.
- While the plugin is enabled, Claude Code puts a plugin's top-level `bin/` folder on the `PATH` of Claude's shell. `effort.mjs` can then be run by name there on macOS and Linux. It runs only when someone invokes it, and your Bash permission rules still apply. claude.ai and Cowork do not install plugins that have a top-level `bin/` folder, so this plugin is for Claude Code: the terminal, the desktop app and the IDE extensions.
- Neither `plugin.json` nor the marketplace entry sets `version`, so Claude Code versions each install by commit. `/plugin marketplace update effort-project` or `claude plugin update effort-project@effort-project` fetches newer commits. `claude plugin validate` warns about the missing version, which is intentional. To stay on a release instead, add the marketplace at a tag that contains the plugin, for example `/plugin marketplace add AntyLab/effort-project#<tag>`.

## Validation

Historical installation checks used the Claude Code 2.1.299 CLI bundled with the Claude desktop app on Windows 11, without model calls and with a separate, empty configuration directory:

- `claude plugin validate .` passed. Its only warning is the missing version described above.
- `claude --plugin-dir . plugin list` reported `effort-project@inline` as loaded.
- `claude --plugin-dir . plugin details effort-project` listed the `explain` skill, the `UserPromptSubmit` hook and the `effort` MCP server.

`npm test` runs `test/claude-plugin.test.mjs`. It feeds the hook realistic `UserPromptSubmit` JSON and checks default suggestions, opt-in routing, bounded follow-up context, skill frontmatter, fail-open behavior and timing. It also checks the manifests against the documented formats, starts the MCP server from the plugin configuration, and runs the hook and server from a copied plugin root, as Claude Code does after an install.

### Live routing acceptance (November 16, 2026)

The supplied functional checks ran headlessly on macOS with Node 26.13 and Claude Code 2.1.310, loading the real plugin directory in a session on Sonnet 5.5 at medium effort:

- `Fix the typo in README.md` invoked `effort-project:route-fast`. A `claude-haiku-5-5` fork fixed the typo, and tool hooks reported low effort.
- `Add a second heading called Usage to README.md` invoked no skill and stayed on Sonnet at medium effort.
- A race-condition investigation invoked `effort-project:route-frontier`. A Fable fork fixed the bug, and tool hooks reported high effort.

The race check cost about $0.67 at list price, against about $0.07 for each of the other two. These different tasks do not establish savings or equal quality. A separate probe showed that a non-forked skill with `effort: low` changed the main conversation from high to low for the rest of the turn, while its `model:` field did not change the main conversation's model. No provider calls were made during this documentation pass. See the [validation record](validation.md#model-and-effort-routing-2026-11-16).

### Live acceptance (October 17, 2026)

Run on Windows 11 with Claude Code 2.1.299 (the CLI bundled with the Claude desktop app), Node 24.19 and Haiku 5.5. The working directory was a disposable project outside this repository, and `CLAUDE_CONFIG_DIR` pointed at a separate, throwaway folder with the inherited `CLAUDE_*` and `ANTHROPIC_*` variables removed, so nothing was installed into the real Claude Code configuration. Every run was non-interactive:

```sh
claude -p --plugin-dir <repo> --effort <level> --model haiku --output-format stream-json --verbose --include-hook-events "<prompt>"
```

Three runs called the model: three short prompts, with `--permission-mode default --max-turns N --max-budget-usd 0.10`, about $0.011 in total by Claude Code's own estimate. The other runs used a configuration that was not signed in. The model call then fails with "Not logged in" after the hooks have run, so those runs cost nothing. A hook's `systemMessage` appears in the stream as a `system` message with subtype `informational`, for example `UserPromptSubmit says: Effort suggests high ...`.

**Bug found and fixed.** On the first runs the hook printed nothing, whatever `--effort` and model were used. A throwaway observer hook, kept outside this repository, recorded what Claude Code passes to hooks:

| Event | `CLAUDE_EFFORT` | stdin `effort` |
| --- | --- | --- |
| `SessionStart`, `UserPromptSubmit` | not set | absent |
| `PreToolUse`, `PostToolUse`, `Stop` | `low` | `{"level":"low"}` |

The table is from signed-in runs with `--effort low` on Haiku 5.5. Signed out, `UserPromptSubmit` also had no variable with `--effort low`, `high`, `max` and no flag, and with the Haiku, Sonnet, Opus and Fable aliases and the default model. This matches the hooks reference, which lists `effort` only for events in a tool-use context. Before the fix, putting `CLAUDE_EFFORT=low` into the environment of the `claude` process, which passes it on, made the hook print the original line and Claude Code show it, so the hook and the display path were sound. The hook now uses the fallback described under [How the hook decides](#how-the-hook-decides), and it no longer reads `$CLAUDE_EFFORT` at all, because a value there was inherited from another process.

A review afterwards found that the hook's workspace scan marked every prompt in a multi-language repository as high, so the hook now uses prompt rules only (see [How the hook decides](#how-the-hook-decides)). The live runs used a one-language project, and for their prompts the hook prints the same lines without the scan; `test/claude-plugin.test.mjs` checks equivalent prompts in one-language and multi-language projects.

Outcome per step. The interactive screens cannot be driven from a script, so those parts were not performed.

1. **Start with the plugin.** Done with `claude -p --plugin-dir`. The init message lists `effort-project@inline` with no plugin errors, and the skill `effort-project:explain`. An interactive start was not performed.
2. **Race prompt on low.** With `--effort low` and `Investigate the intermittent race condition in the token refresh`, the line `Effort suggests high for this prompt. If you're on a lower level, apply it with /effort high` was shown. The transcript's user message equals the typed prompt exactly. The line is recorded without any text for the model, and the model went on to use tools until the 3-turn cap that was set. Tool events afterwards still reported `low`. The session header was not viewed.
3. **Same prompt on high.** With `--effort high` the same line is shown, because the hook cannot see the level. The planned outcome, no line, does not apply.
4. **Typo prompt on high.** `Fix a typo in the README` with `--effort high` gave `Effort suggests low for this prompt. If you're on a higher level, apply it with /effort low`. `Add a settings page with a dark mode toggle` printed nothing.
5. **Race prompt on max.** With `--effort max` the high line is shown again, for the same reason.
6. **Explain skill.** `/effort-project:explain Investigate the intermittent race condition in the token refresh` in the default permission mode: the model loaded the tool with ToolSearch and called `mcp__plugin_effort-project_effort__effort_recommend` with the prompt unchanged. The call returned the level, reasons and caveat, there was no permission denial, and the answer followed the skill. As a control, `effort_capabilities`, which the skill does not pre-approve, was denied in the same mode. The hook printed nothing for the slash command, as designed. The run passed the task text as an argument, because a single `-p` run has no earlier request for the bare command to use.
7. **MCP server and plugin errors.** The init message lists `plugin:effort-project:effort` as `connected` with the three tools `effort_capabilities`, `effort_observe` and `effort_recommend`, and the debug log shows the stdio connection in 466 ms. The `/mcp` and `/plugin` screens were not opened.
8. **Debug log.** With `--debug-file`, the hook finished with status 0 in 79 ms (358 ms on a cold first run). Its output was only the `systemMessage` line, and no line of the debug log contained the prompt text.
9. **Windows without Git Bash.** The hook's parent process was `claude.exe`, so no shell starts, and the hook also ran with the Git folders removed from `PATH`. A machine without Git Bash was not available.
10. **Install from the marketplace.** Not done from GitHub, because the plugin is not on the default branch yet. In an isolated configuration, `claude plugin marketplace add <repository folder>` and `claude plugin install effort-project@effort-project` installed a cache copy of 56 files (about 450 KB, versioned by commit) that includes `bin/`, `src/`, `hooks/` and `skills/`. Claude Code loaded a directory marketplace from its source folder rather than from the cache copy, so loading from the cache is still untested.

## Turn it off

Disable the plugin in `/plugin`, or run `claude plugin disable effort-project@effort-project`. To remove it, run `claude plugin uninstall effort-project@effort-project`, and `claude plugin marketplace remove effort-project` to remove the marketplace. The plugin keeps no data of its own.

## Limits

- With opt-in routing, fork routes run without the earlier conversation unless Claude passes the needed context along. The hook asks it to do so.
- With fork routing enabled, the main conversation model still reads the prompt and relays the worker's answer. A skill's `model` field changes the fork's model, not the main conversation's model.
- Opt-in routing depends on Claude following the hook's instruction to invoke the named skill. Remove `EFFORT_AUTO_ROUTE` or set it to `0` to return to suggestions only; disable the plugin to stop suggestions too. Remove `EFFORT_ALLOW_FAST` to keep routing but stop the Haiku route.
- The rules are a keyword and length heuristic with low confidence. Short follow-ups can inherit a recent signal from the bounded transcript tail; other conversation context is not assessed. The hook uses no repository facts; `effort recommend --cwd` can recommend a different route when the request names many files.
- Prompts starting with `/` or `!` are skipped, including a prompt that starts with an absolute path.
- `node` must be on the `PATH` that Claude Code uses to start hooks and MCP servers.
