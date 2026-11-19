# Automatic effort routing

This experimental integration chooses a model and effort locally before each submitted user prompt. It uses the prompt, bounded repository metadata, the previous routing decision, and the host's supported controls. It makes no classifier API call and writes no prompt history. It does not establish the minimum effort needed for a correct answer or promise token savings.

## Supported surfaces

| Surface | Automatic behavior | Limit |
| --- | --- | --- |
| OpenCode native plugin | Applies an advertised model variant before sending requests; reuses the choice across that prompt's tool steps | Explicit variants/configuration win. Only supported reasoning models and configured primary agents are routed. Model stays unchanged. |
| Claude Code plugin | Asks Claude to invoke routing skills when a prompt rule fires; ordinary prompts stay unchanged | Depends on Claude following the hook. Fork skills change their worker model; earlier conversation must be passed along. |
| Claude Code through `effort auto claude` | Chooses model and effort for each prompt and resumes the same Claude conversation | Uses Effort's text interface and restricted CLI adapter. Does not attach to the stock Claude terminal or desktop UI. |
| Gemini through `effort auto gemini` | Chooses model and effort and resumes the same Antigravity conversation | Requires `agy`. File permissions are session-only; shell commands are never allowed. Token usage, but no cost, is reported. |
| Codex through `effort auto codex` | Routes `turn/start` model and effort through a local connection to the normal Codex terminal UI | Built-in WebSocket server; no extra package. Real app-server routing checked; the official terminal UI connects and starts through it; a prompt typed there still needs a manual check. Does not attach to Codex desktop. |
| Other MCP hosts | Recommendations through the existing MCP tools | MCP tools do not control the host's active model or effort. |

The ordinary website remains a local recommendation and run-history dashboard. Opening it does not enable background access to other applications.

## Claude Code plugin routing

Install the [Claude Code plugin](claude-code-plugin.md) to route inside Claude Code's own interface. Its `UserPromptSubmit` hook asks Claude to invoke one of three skills:

- `route-fast`: a fork on Haiku at low effort for short mechanical requests.
- `route-frontier`: a fork on Fable at high effort for requests that are both high-stakes and investigative or tangled.
- `route-hard`: high effort for the rest of the turn on the session's model for other high-effort requests.

Ordinary prompts are left alone. Hooks cannot set model or effort directly. A non-forked skill can change effort for the rest of the turn, but its `model` field does not change the main conversation's model. The main model reads the prompt and relays a fork's answer; the fork sees earlier context only if Claude passes it along. Routing depends on Claude following the instruction.

Headless checks with the real plugin directory on November 16, 2026 exercised the fast and frontier forks and an unchanged ordinary prompt. They establish functional routing, not quality or savings. See [validation](validation.md#model-and-effort-routing-2026-11-16).

## Claude Code text session

With an installed, signed-in Claude Code CLI:

```sh
node bin/effort.mjs auto claude --cwd /path/to/project
```

Enter one prompt per line. `/new` starts a fresh conversation and resets routing history; `/quit` exits; Ctrl+C cancels the session. Each subsequent prompt resumes the same provider session. Failed, cancelled, or discontinuous turns require `/new`; no prompt is automatically replayed. Responses are marked **unverified** because no independent acceptance check is run by this interface.

The adapter defaults to read-only access, a 120-second limit per prompt, and low/medium/high effort. `--allow-write` permits the adapter's restricted file-edit tools; it does not grant a general shell. Existing managed-adapter isolation applies, including disabled custom hooks/MCP connections. See [Claude adapter](claude-adapter.md). This is not a replacement for every native Claude Code feature.

Use `--effort medium` to pin effort, `--model YOUR_MODEL_ID` to pin the model, or `--max-effort medium` to cap automatic effort. `--timeout 180` changes the per-prompt time limit. `--dry-run` validates and prints configuration without opening a provider session.

## Gemini through Antigravity

With the installed, signed-in Antigravity CLI (`agy`, or `EFFORT_GEMINI_BIN`):

```sh
node bin/effort.mjs auto gemini --cwd /path/to/project
```

This uses the same text-session commands, pins, bounds and default 120-second per-prompt limit as the Claude text session. It resumes the provider conversation, and results remain **unverified** without an independent check. `--allow-write` permits session-only file permissions, never shell commands. Antigravity reports token usage but no cost. This is not Google's own Gemini CLI or a native Antigravity plugin.

For one task with independent verification, use `effort run "task" --provider gemini --allow-write -- node test.mjs`. A live rename-typo check selected Gemini 4 Hydrogen at low and passed its verification command; see [validation](validation.md).

## OpenCode plugin

Generate a local module using the installed Effort path:

```sh
node bin/effort.mjs config opencode
```

Create a new `.opencode/plugins/effort.js` in the chosen project and paste the printed single export. Use the `.js` ending: OpenCode 1.19.5 does not load a plugin file ending in `.mjs`. Preserve existing plugins and config. OpenCode loads this project plugin on the next session. Effort does not write global settings. Regenerate the module if you move the Effort installation; remove that one module to disable the integration.

For custom bounds, use a wrapper exporting only one initializer:

```js
import { createEffortPlugin } from 'file:///absolute/path/effort-project/src/integrations/opencode.mjs';
export default createEffortPlugin({
  minEffort: 'low',
  maxEffort: 'high',
  agents: ['build', 'plan'],
});
```

Do not point OpenCode directly at the implementation module containing both the factory and default export: some plugin loaders call every exported function. The generated wrapper avoids that ambiguity.

Clear any explicitly selected variant to let automatic routing operate. A manual variant or explicit effort setting in model, provider, or agent configuration takes precedence. The plugin uses actual `model.variants` option objects, including nested provider controls, rather than guessing provider parameter names. Unsupported or unknown shapes remain unchanged. Internal/title/compaction agents are skipped. Errors leave the original request intact.

OpenCode's local structured log identifies request-option changes with `service: effort-project`, the model and selected effort. `providerAccepted: null` means acceptance was not independently observed. Pending prompt text is bounded, held only until the matching request hook or expiry, then discarded; session state contains decisions only.

## Codex terminal router

The launcher connects the official terminal UI to a private, single-client WebSocket router on `127.0.0.1`. Its small built-in WebSocket server needs no extra package. A random bearer token is passed through the child environment. Browser origins, other hosts, unauthenticated connections, and extra clients are rejected. App-server messages use local stdio behind the router. Tokens, prompts, and provider stderr are not logged.

```sh
node bin/effort.mjs auto codex --cwd /path/to/project --dry-run
node bin/effort.mjs auto codex --cwd /path/to/project
```

The router discovers `model/list` capabilities and sets `turn/start.effort`, including the effort field inside collaboration-mode settings when present. Only bounded text-only prompts are classified. Attachments, unknown protocol shapes, unavailable capability discovery, or unsupported settings preserve the native request and report why. The native selected effort is overridden in automatic mode; launch with `--effort high` for a fixed pin, or start ordinary Codex to disable Effort.

The router selects a built-in tier model by default, subject to discovered capabilities. `--model` and an explicit routing table override that choice. Approval requests, approval responses, sandbox policies, and unrelated protocol messages pass through. The official terminal UI owns permissions and cancellation; `--allow-write` and Effort's managed timeout flag are rejected for this mode. The router never approves requests on the user's behalf.

A live WebSocket client check drove the real `codex app-server` through this router and confirmed a typo turn changed from the session default gpt-6.1-sol/max to gpt-6-luna/low. Codex's own session record matched. The official terminal UI was separately started through the router and drew its start screen; a prompt typed into it has not been observed. On November 17 a prompt typed into the official terminal UI (codex-cli 0.160.0) was routed from gpt-6.1-sol to gpt-6-luna/low and completed; Codex's session record showed the routed model and effort.

## Model routing

Built-in model selection is on by default in managed runs, managed text sessions and the Codex router. Short mechanical requests use the fast tier; requests that are both high-stakes and investigative or tangled use frontier; everything else uses daily.

| Provider | fast | daily | frontier |
| --- | --- | --- | --- |
| Claude | haiku | sonnet | fable |
| Codex | gpt-6-luna | gpt-6.2-sol | gpt-6.2-astra |
| Gemini | gemini-4-hydrogen | gemini-4-argon | gemini-4-argon |

A `--model MODEL_ID` pin wins. In `effort auto`, a `--routing-config` effort-to-model table comes next, followed by the built-in tier choice, then the current/default model. OpenCode keeps its selected model, and the Claude Code plugin uses its skills rather than this table.

To override the built-in choices in an automatic session, create a JSON file with exact model IDs:

```json
{
  "minEffort": "low",
  "maxEffort": "high",
  "models": {
    "low": "YOUR_SMALL_MODEL_ID",
    "medium": "YOUR_DEFAULT_MODEL_ID",
    "high": "YOUR_COMPLEX_TASK_MODEL_ID"
  }
}
```

Pass `--routing-config /path/to/routing.json` to `effort auto`. CLI bounds override file bounds. A fixed `--model` overrides the table. Missing entries use the built-in tier choice before the current/default model. The table stays within the selected provider; it does not choose paid accounts. Codex checks discovered capabilities. In `effort run`, an automatic model rejected before turn submission can fall back once to the provider default; pinned models do not fall back.

Model IDs are configuration, not executable commands. Effort does not download models or edit account settings. Changing models can change billing and invalidate caches. Frontier models cost more, and runs have no spending cap.

## Policy and evidence

Short mechanical requests can start at low, uncertain tasks at medium, and investigation or costly error risks at high. A request that names five or more distinct workspace files counts as a broad edit and is raised one level, never past high. Files are counted by the relative paths the prompt contains, plus each other bare file name once. The checkout's language count is reported as a reason but never changes effort, because it describes the repository rather than the request. Short ambiguous followups preserve the previous level. Two successive clearly simpler requests allow a downgrade, reducing setting churn. Explicit pins and bounds win over recommendations; bounds can therefore limit effort even for complex work.

This rules policy covers English plus basic Spanish, French, German, Portuguese and Italian keywords. It does not read the entire conversation, inspect repository source contents, route every internal tool result, or learn from provider outputs. Lower settings, fewer output tokens, and successful protocol tests do not prove equal quality or lower total cost. Most Claude models can lose conversation cache reuse when effort changes, and model changes have separate caches; the conservative downgrade rule is a mitigation, not a cost model.

Offline tests cover policy decisions, continuation handling, overrides, native-shaped host contracts, session separation, resumed managed turns, request-option application, malformed inputs, and configuration generation. Live checks cover Claude plugin skill routing, Codex app-server routing through the built-in WebSocket server, and a managed Gemini task. Windows/Linux live routing remains unchecked; OpenCode and the official Codex terminal UI were checked live on November 17. See [validation](validation.md).

Source contracts checked on September 26, 2026: [Codex app-server](https://learn.chatgpt.com/docs/app-server), [Codex hooks](https://learn.chatgpt.com/docs/hooks), [Claude hooks](https://code.claude.com/docs/en/hooks#userpromptsubmit-decision-control), [Claude runtime configuration](https://code.claude.com/docs/en/agent-sdk/configuration#change-configuration-mid-session), [Claude prompt caching](https://code.claude.com/docs/en/prompt-caching#changing-effort-level), and [OpenCode v1.18.32 plugin contract](https://github.com/anomalyco/opencode/blob/v1.18.32/packages/plugin/src/index.ts).
