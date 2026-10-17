# Claude Code plugin

The Effort Project ships an advisory plugin for Claude Code. When you submit a prompt, a local hook runs Effort's rules on it and compares the result with your session's current effort level. If the two differ, Claude Code shows you one line:

```text
Effort suggests high for this prompt (you're on low). Apply with /effort high
```

**This is advice, not control.** Claude Code hooks cannot set the effort level or the model for a turn. A `UserPromptSubmit` hook can add context for Claude, show you a message, name the session or block the prompt. This plugin never blocks or changes your prompt and never changes your effort level. If you agree with a suggestion, you apply it yourself with `/effort <level>`. These limits were checked against the Claude Code [hooks reference](https://code.claude.com/docs/en/hooks) and [effort documentation](https://code.claude.com/docs/en/model-config#adjust-effort-level) on October 17, 2026.

For effort that changes automatically before each prompt, use Effort's own managed session, `effort auto claude` ([automatic routing](automatic.md)). It does not attach to the native Claude Code interface.

## What the plugin adds

| Component | What it does | Context cost |
| --- | --- | --- |
| `UserPromptSubmit` hook | Runs Effort's rules on each prompt and shows one line when the suggested level differs from `$CLAUDE_EFFORT` | None. The line is shown to you; nothing is added to Claude's context |
| `effort` MCP server | Effort's existing stdio server (`bin/effort.mjs mcp`) with the read-only `effort_recommend`, `effort_observe` and `effort_capabilities` tools | Tool definitions, which Claude Code defers through MCP tool search on supported models |
| `explain` skill | Run `/effort-project:explain [task text]`, or ask why Effort suggested a level. Claude calls `effort_recommend` and explains the level and its reasons | About 70 tokens per session for the skill listing, per `claude plugin details` |

## Install

You need Node.js 22 or later available as `node` on your `PATH`, and a current Claude Code. The plugin was validated with Claude Code 2.1.299.

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

The marketplace is a third-party marketplace. Like any plugin, the hook and the MCP server run with your user permissions. The code they run is small: [`hooks/prompt-advice.mjs`](../hooks/prompt-advice.mjs), [`src/integrations/claude-code-hook.mjs`](../src/integrations/claude-code-hook.mjs), [`src/policy.mjs`](../src/policy.mjs) and [`src/repository.mjs`](../src/repository.mjs) for the hook, and [`bin/effort.mjs`](../bin/effort.mjs) with [`src/mcp.mjs`](../src/mcp.mjs) for the server.

## How the hook decides

1. Claude Code passes the submitted prompt and the working directory to the hook as JSON on stdin. The hook reads your current level from the `CLAUDE_EFFORT` environment variable, which Claude Code sets for hooks.
2. The hook runs the same rules as `effort recommend`, including the same bounded repository metadata: languages from file extensions and how many files the prompt names. The scan reads directory listings only, not file contents. It skips dot-directories, dependencies and symlinks, and stops after 500 files, two directory levels or 50 ms.
3. If the suggested level equals yours, the hook prints nothing. Effort's rules never suggest more than high, so a suggestion of high means "high or more": on xhigh or max the hook stays quiet too.
4. Otherwise it prints `{"systemMessage": "..."}` with the line shown above, and exits 0.

The hook prints nothing and exits 0 in these cases:

- `CLAUDE_EFFORT` is unset or not a level, for example on a model without effort levels.
- The prompt starts with `/` or `!`. Commands and skills reach the hook as typed (`/name arguments`), and `!` lines run a shell. Neither describes the task.
- The prompt is empty or longer than 100,000 characters, the limit of Effort's rules.
- The hook input is malformed, larger than 1 MiB, or has not arrived within 3 seconds.
- The working directory cannot be scanned within 1 second, for example on a stalled network drive. Without the repository metadata the suggestion could point the wrong way, so the hook says nothing.
- Anything else fails. The hook catches every error. Claude Code treats hook failures as non-blocking as well, and `hooks/hooks.json` sets a 5-second timeout.

Claude Code also runs `UserPromptSubmit` hooks when a scheduled task fires, when a background subagent reports back, and when another session sends a message. A suggestion can appear on those turns too.

## Before you apply a suggestion

`/effort <level>` takes effect from the next request, even while Claude is working.

Changing effort can cost a cache rebuild. On most models, Claude Code re-reads the whole conversation without prompt-cache hits after an effort change, and it asks you to confirm while the cache is warm. On Opus 5.5, Sonnet 5.5, Haiku 5.5 and Fable 5.1 with an API key or a Claude subscription, the cache is kept. See [prompt caching](https://code.claude.com/docs/en/prompt-caching#changing-effort-level). Effort's automatic router waits for two simpler prompts in a row before it lowers effort, for this reason. The hook keeps no state between prompts, so it can suggest a lower level for a single easy follow-up in the middle of a hard task.

The rules are a transparent keyword and length heuristic with low confidence. They are written for English prompts and do not measure how hard a task is. Lower cost at equal quality has not been demonstrated. See [validation](validation.md).

## Privacy and safety

- The prompt stays in the hook's memory. It is not written to disk, logged, echoed in the output or sent anywhere. The hook makes no network requests and starts no processes.
- The only output is `systemMessage`, which the hooks reference describes as a message shown to the user. The hook does not set `additionalContext` or print plain text, the two outputs that Claude Code adds to Claude's context. `claude plugin details` lists the hook as harness-only, with no model context cost.
- After an unexpected internal error the hook writes one fixed line to stderr, `effort-project: prompt advice skipped after an internal error.`, which appears only in Claude Code's debug log. It never prints error details, because parser errors can quote the input.
- The plugin stores nothing of its own and does not use `${CLAUDE_PLUGIN_DATA}`. The MCP server is Effort's existing advisory server. See [desktop integration](desktop.md).

`test/claude-plugin.test.mjs` checks these properties. It walks the hook's module graph for network, process, file-writing and logging calls, and it runs the hook with the home, temp and plugin-data directories pointed at an empty folder, then checks that the folder is still empty and that the prompt appears in no output.

## Performance

On the Windows 11 development machine with Node 24.19, a complete hook run took a median of 65 ms over 20 runs (90th percentile 71 ms), and starting Node with an empty script took 52 ms. The advice itself, including the repository scan, took about 1 ms in process. Node's startup time dominates and is usually shorter on macOS and Linux. The repository scan stops after 50 ms. The hook waits up to 1 second for it, the same limit Effort's OpenCode plugin uses. A slow disk or a busy machine delays the line; past 1 second the hook stays silent rather than guess.

## Packaging: the plugin root is the repository root

When Claude Code installs a plugin from a marketplace, it copies the plugin's directory into `~/.claude/plugins/cache/<marketplace>/<plugin>/<version>/` and loads that copy. Files outside the plugin directory are not copied. The hook imports `src/policy.mjs` and `src/repository.mjs`, and the MCP server runs `bin/effort.mjs`, which loads most of `src/`. The marketplace entry therefore uses `"source": "./"`: the plugin root is the repository root, every install carries the code it runs, and `${CLAUDE_PLUGIN_ROOT}` points at that copy.

Two alternatives were rejected:

- **A self-contained `plugins/effort-project/` directory.** It would need a second copy of `bin/` and `src/` kept in sync with every policy change.
- **A launcher that runs the `effort-project` npm package.** The package is not published yet. `npx` would also download it on first use, and starting npm adds hundreds of milliseconds to every prompt, while the hook must not use the network. Once the package is published, the marketplace entry can switch to an `npm` source if `package.json` `files` then includes `.claude-plugin`, `hooks` and `skills`.

The repository-root layout has these consequences:

- Each install copies the whole repository, a few hundred kilobytes today, including documentation and tests.
- The MCP server is declared in `.claude-plugin/plugin.json`, not in a root `.mcp.json`. Claude Code would also read a root `.mcp.json` as project MCP configuration for anyone who opens this repository, where `${CLAUDE_PLUGIN_ROOT}` is undefined.
- While the plugin is enabled, Claude Code puts a plugin's top-level `bin/` folder on the `PATH` of Claude's shell. `effort.mjs` can then be run by name there on macOS and Linux. It runs only when someone invokes it, and your Bash permission rules still apply. claude.ai and Cowork do not install plugins that have a top-level `bin/` folder, so this plugin is for Claude Code: the terminal, the desktop app and the IDE extensions.
- Neither `plugin.json` nor the marketplace entry sets `version`, so Claude Code versions each install by commit. `/plugin marketplace update effort-project` or `claude plugin update effort-project@effort-project` fetches newer commits. `claude plugin validate` warns about the missing version, which is intentional. To stay on a release instead, add the marketplace at a tag that contains the plugin, for example `/plugin marketplace add AntyLab/effort-project#<tag>`.

## Validation

Checked without model calls, using the Claude Code 2.1.299 CLI bundled with the Claude desktop app on Windows 11, with a separate, empty configuration directory:

- `claude plugin validate .` passed. Its only warning is the missing version described above.
- `claude --plugin-dir . plugin list` reported `effort-project@inline` as loaded.
- `claude --plugin-dir . plugin details effort-project` listed the `explain` skill, the `UserPromptSubmit` hook and the `effort` MCP server.

`npm test` runs `test/claude-plugin.test.mjs`. It feeds the hook realistic `UserPromptSubmit` JSON and checks the output format, silence on matching levels, fail-open behavior and timing. It also checks the manifests against the documented formats, starts the MCP server from the plugin configuration, and runs the hook and server from a copied plugin root, as Claude Code does after an install.

### Manual acceptance (not yet performed)

A live session has not been run. These steps send a few short prompts to the model, so use an inexpensive model and a disposable project.

1. Start `claude --plugin-dir /path/to/effort-project` in the disposable project.
2. Run `/effort low`, then submit `Investigate the intermittent race condition in the token refresh`. Expect the line `Effort suggests high for this prompt (you're on low). Apply with /effort high`. The prompt goes through unchanged, and the session header still shows low effort.
3. Run `/effort high` and submit the same prompt. Expect no line.
4. Submit `Fix a typo in the README` while on high. Expect `Effort suggests low for this prompt (you're on high). Apply with /effort low`.
5. Run `/effort max` and repeat step 2's prompt. Expect no line.
6. Run `/effort-project:explain`. Claude should call `effort_recommend` without a permission prompt, explain the level and its reasons, and leave your effort level unchanged.
7. Run `/mcp`. Expect `plugin:effort-project:effort` connected with three tools. Run `/plugin` and check that the **Errors** tab has no entry for the plugin.
8. Start once with `claude --debug --plugin-dir /path/to/effort-project`, submit a prompt, and check the debug log: the hook exits 0 and its output does not contain your prompt.
9. On Windows, repeat step 2 on a machine without Git Bash. The hook uses exec form (`command` plus `args`), which starts `node` without a shell.
10. After the plugin is on the default branch, install it from GitHub as described under [Install](#install). Check that `~/.claude/plugins/cache/effort-project/effort-project/<version>/` contains `bin/` and `src/`, then repeat step 2.

## Turn it off

Disable the plugin in `/plugin`, or run `claude plugin disable effort-project@effort-project`. To remove it, run `claude plugin uninstall effort-project@effort-project`, and `claude plugin marketplace remove effort-project` to remove the marketplace. The plugin keeps no data of its own.

## Limits

- Advisory only. The plugin cannot set or confirm the effort Claude Code uses for a turn. It sees only the level in `CLAUDE_EFFORT`.
- The rules are the same heuristic as `effort recommend`, with the same limits.
- Prompts that start with `/` are skipped, including a prompt that starts with an absolute path.
- Without effort levels on the current model, the hook stays silent.
- `node` must be on the `PATH` that Claude Code uses to start hooks and MCP servers.
