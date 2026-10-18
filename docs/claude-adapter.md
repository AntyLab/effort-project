# Claude Code managed-turn adapter

`src/adapters/claude.mjs` exports `capabilities` and `run(options)` from the [adapter contract](adapter-contract.md). It uses the installed Claude Code CLI, Node.js 22 or newer, and no runtime dependencies. The implementation was checked against local Claude Code **2.1.282** help on **2026-09-26**. Its automated tests use temporary fake executables and never call a model.

Trusted programmatic callers can supply `executable` plus `executableArgs` (an optional validated array, default `[]`). Prefix arguments precede the adapter's CLI arguments. For a Node shim, use `executable: process.execPath` and `executableArgs: ['/absolute/path/to/shim.cjs']`; this works without a shebang or shell. Batch-file wrappers are not executed through a shell. Without an explicit `executable`, the adapter uses `EFFORT_CLAUDE_BIN` when set; otherwise, on Windows, it looks for `claude.exe` anywhere on `PATH` (the native installer), then reads npm's `claude.cmd` shim and runs the script it names with the current Node. The lookup uses the caller's `env` before the child environment is filtered.

## What effort control means

Each call starts one noninteractive CLI process with `--print --output-format stream-json --verbose --effort LEVEL`. A later call can pass the returned session UUID with a different effort; this adds `--resume UUID`. The prompt goes through stdin, never a shell or command-line prompt argument. Only `low`, `medium`, and `high` are accepted. The adapter never changes another terminal, desktop chat, or already-running request.

The child environment also sets `CLAUDE_CODE_EFFORT_LEVEL` to the selected level because that variable takes priority over `--effort`. This is a per-process change. Authentication and provider routing variables are preserved; arbitrary Claude customization and runtime-injection variables are not. [Environment variable precedence](https://code.claude.com/docs/en/env-vars#precedence).

`effortEvidence.type` is `launch-flag`. `launchAccepted` means a valid initialization message arrived, not that the API applied that effort. `observedEffort` remains `null` and `verified` remains `false`: the stream protocol does not supply a supported applied-effort readback. Organizations can cap effort silently in JSON mode. Known unsupported models are blocked; custom model capabilities remain unverified. No timing, token count, or answer quality is presented as proof of internal reasoning. [Effort limits and model support](https://code.claude.com/docs/en/model-config#organization-effort-limits).

## Permissions and isolation

The default launch exposes only `Read`, `Grep`, and `Glob`, selects `dontAsk`, and denies mutation, command execution, web access, delegation, and MCP tools. `allowWrite: true` adds only `Edit` and `Write` and uses the normal `acceptEdits` permission mode. Both modes retain `--restricted`, which confines built-in file tools to working directories and protects configuration and Git files. No extra directory is added. `--permission-prompts none` denies actions requiring an unanswered approval. The CLI may retain its built-in `EndConversation` tool. These controls and tool names are present in the inspected 2.1.282 help; [permission behavior](https://code.claude.com/docs/en/permissions) is documented by Anthropic.

Every launch uses safe mode, an empty setting-source list, an empty strict MCP configuration, disabled slash commands and Chrome integration, and inline settings disabling hooks, auto memory, connectors, workflows, and model fallback. The adapter adds no hooks or MCP servers. Leading slash-command prompts are rejected to avoid command paths that can save configuration. It performs no settings-file writes, installs, shell commands, commits, or credential extraction. Unexpected reported tools, permissions, MCP servers, plugins, hooks, session IDs, or model changes stop the process. [CLI flag reference](https://code.claude.com/docs/en/cli-reference).

The installed CLI reports its own `agents-md` plugin with the exact path marker `builtin` even in safe mode. The adapter accepts that observed descriptor only; a disk plugin with the same name or another built-in name remains blocked. This exception was established by a bounded live initialization capture, not by assuming any plugin is safe.

**This is provider tool isolation, not an operating-system sandbox.** Administrator-managed policy still applies. In particular, a per-session `disableAllHooks` setting cannot disable administrator-managed hooks. A hook event can be detected after its command has started; stopping cannot undo that command. On machines with managed hooks, trust that administrator policy or use an isolated environment whose policy you control. The adapter does not bypass managed policy. [Managed hook precedence](https://code.claude.com/docs/en/hooks#disable-or-remove-hooks).

## Results, usage, and limits

A completed result requires a valid initialization, a terminal successful `result` event, and exit code zero. Tool permission denials produce `blocked`, even if the model writes a success message. Authentication, billing, model availability, CLI compatibility, and reported usage restrictions also produce `blocked`; malformed output, timeout, and process errors produce `failed`; an abort produces `cancelled`. A top-level `assistant` event's `error` field ([`SDKAssistantMessageError`](https://code.claude.com/docs/en/agent-sdk/typescript), for example `rate_limit`, a 429 against the account's quota) sets the cause when the final result's wording is not one the adapter recognizes. The wording of plan-limit messages is not matched, so without that field such a stop is a generic `cli_error`. Invalid caller inputs throw `TypeError` or `RangeError` before launch. Errors expose fixed diagnostic messages rather than raw stderr, environment values, or provider error bodies. `onEvent` carries metadata without prompt, tool inputs, or reasoning text.

On a new session, the adapter copies the token counts from the terminal `result` event's `usage` and the estimated cost from its `total_cost_usd`. Both cover only this call. The token counts cover the main agent loop; the cost estimate also counts the CLI's internal requests, such as compaction. [Result fields](https://code.claude.com/docs/en/agent-sdk/typescript#sdkresultmessage).

A resumed call (`--resume`) reports the conversation's whole total in `total_cost_usd` and `modelUsage`, earlier calls included, so neither describes this turn. `costUsd` is therefore `null`, and `usage.conversationCostUsd` holds the reported total with `costScope: "conversation"`; do not sum those totals across resumed calls. Claude Code restores earlier totals from 2.1.277 on, and only those saved when the CLI process exited normally, so the total after a stopped turn (timeout or cancellation) may leave that turn out. Older versions reported only the call's own spend. [Reported conversation costs](https://code.claude.com/docs/en/headless#pipe-data-through-claude), [totals across resumed calls](https://code.claude.com/docs/en/agent-sdk/cost-tracking#accumulate-costs-across-multiple-calls).

The result's `usage` is not restored: it counts this call's main agent loop only. The adapter still checks that scope against the turn's own stream before using it. Each top-level `assistant` event carries the input and cache token counts of the API response it came from, repeated once per content block under one message id; its `output_tokens` is only the placeholder reported when the response started. The adapter counts each message id once, skips subagent events and the CLI's own `<synthetic>` messages, and compares the sums of `input_tokens`, `cache_read_input_tokens` and `cache_creation_input_tokens` with the result's. If they match, `inputTokens`, `outputTokens` and `cachedInputTokens` come from the result's `usage`, labeled `tokenScope: "turn"`. Otherwise they stay `null`, labeled `tokenScope: "unverified-on-resume"`: for example when the turn streamed no assistant event, an event lacks a message id or usage, a crash zeroed the result, or a budget stop left the last response out of `usage`. [Per-step usage](https://code.claude.com/docs/en/agent-sdk/cost-tracking#track-per-step-usage).

| Field | New session | Resumed, counts match | Resumed, not attributable |
| --- | --- | --- | --- |
| `inputTokens`, `outputTokens`, `cachedInputTokens` | Result `usage` | Result `usage` | `null` |
| `costUsd` | `total_cost_usd` | `null` | `null` |
| `conversationCostUsd`, `costScope` | Absent | `total_cost_usd`, `"conversation"` | `total_cost_usd`, `"conversation"` |
| `tokenScope` | Absent | `"turn"` | `"unverified-on-resume"` |

These semantics were checked on 2026-10-17 against Anthropic's Agent SDK cost-tracking and TypeScript reference pages and the Claude Code 2.1.299 CLI bundle, without running a model. In that bundle the result's `usage` starts at zero for each turn and adds each main-loop API response once, while `total_cost_usd` and `modelUsage` read the session totals that a resume restores.

The built-in bounds are:

| Bound | Value |
| --- | --- |
| Prompt | 1 MiB |
| Total stdout plus stderr | 8 MiB |
| JSON record | 1 MiB |
| Retained answer | 512 KiB |
| Retained stderr for classification | 32 KiB |
| Parsed events | 20,000 |
| Timeout | 120 seconds by default; caller range 1 ms–30 minutes (`capabilities.maxTurnTimeoutMs`). `effort run` gives each turn at most 30 minutes of a longer task budget |
| CLI help preflight | Up to 5 seconds, within the total timeout |
| Internal agent turns | 12 by default; optional `maxTurns` range 1–50, which `runTask` passes to every attempt and refuses for other adapters |
| Optional estimated spend cap | `maxBudgetUsd`, greater than 0 and at most 100 |

The spend cap is optional and a provider estimate, not a guarantee about billing. Timeout/abort sends termination to the process group, then force-kills after 500 ms, with a bounded reap fallback. Windows uses the system `taskkill` process-tree operation; that platform path has not been exercised by the macOS tests. Ordinary successful output is held in memory by the adapter, which writes no transcript.

## Authentication and session persistence

The CLI handles login. Safe mode preserves normal authentication; bare mode would suppress subscription/keychain login and is not used. The adapter makes no login changes and never copies tokens. An `ANTHROPIC_API_KEY` already in the environment takes precedence over subscription login, as in a normal noninteractive Claude invocation.

Standard OS identity variables, including `USER` and `LOGNAME`, are preserved: a local comparison showed that removing them caused Claude's existing macOS login to disappear from `auth status`, while restoring them recovered it without login changes. A managed-turn authentication error should therefore be checked against the matching child environment before asking someone to sign in again. Model comparison also normalizes the CLI's `[1m]`/`[200k]` context suffixes while retaining the observed model name; a different model still blocks the turn.

Claude Code itself retains session transcripts and may update its runtime caches or credential state so resume works. This is separate from the adapter’s no-logging behavior. A new `CLAUDE_CONFIG_DIR` isolates Claude’s storage but also selects a different macOS Keychain entry; it does **not** automatically reuse the existing OAuth login. A separate directory needs its own authorized login or an already-configured environment credential. Do not copy credential files to make a test pass. [Authentication and credential storage](https://code.claude.com/docs/en/authentication#credential-management).

## Verification and optional live recipe

Run `node --test test/claude.test.mjs` for offline checks. They cover exact launch controls, literal stdin, environment filtering, effort/resume arguments, usage scopes, validation, auth errors, protocol bounds, permission denials, model/session mismatches, callbacks, cancellation, and stubborn child-process cleanup.

On 2026-09-26, all **20 offline tests passed**. An authorized live check on Claude Code 2.1.282 completed two no-tools turns using the unchanged model `claude-opus-5-5[1m]`: the low-effort launch stored a synthetic marker, and the high-effort resume recalled it with the same session ID. Authentication required no login or credential changes. A separate restricted file-repair check corrected a disposable addition function at low effort, and independent positive/negative/zero tests passed without changes to the verifier file. These checks verify response/resume behavior, requested effort controls, and one real edit; they do not verify applied server effort or general coding quality. See the [validation record](validation.md).

For an authorized live check, create a disposable working directory outside a real checkout, put a tiny text file in it, and run this from the project root after replacing the absolute fixture path:

```js
import { run } from './src/adapters/claude.mjs';

const cwd = '/absolute/path/to/disposable-fixture';
const first = await run({
  cwd, model: 'sonnet', effort: 'low',
  prompt: 'Read sample.txt and report its exact contents. Do not change files.',
  timeoutMs: 120_000, maxTurns: 3, maxBudgetUsd: 0.25,
});
console.log(first.status, first.sessionId, first.effortEvidence);
if (first.status !== 'completed') throw new Error(first.text);

const second = await run({
  cwd, model: 'sonnet', effort: 'high', sessionId: first.sessionId,
  allowWrite: true,
  prompt: 'Create only result.txt containing exactly EFFORT_OK followed by one newline.',
  timeoutMs: 120_000, maxTurns: 3, maxBudgetUsd: 0.25,
});
console.log(second.status, second.effortEvidence, second.usage);
```

Read the fixture file independently, compare directory contents before and after, and verify the resumed session ID. A denial, authentication block, or unavailable model is a test outcome to report, not a reason to relax permissions. A successful recipe proves that these managed CLI turns and the expected file edit worked; it does not prove that the server used a particular amount of reasoning.
