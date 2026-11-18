---
description: Explain The Effort Project's model and effort recommendation for the user's latest request, with the rule-based reasons and its optional skill routing. Use when the user asks why Effort made a suggestion or chose a route, or which model and effort Effort recommends for a task.
argument-hint: "[task text]"
allowed-tools: mcp__plugin_effort-project_effort__effort_recommend
---

Explain what The Effort Project recommends and why. The plugin shows a model and effort suggestion for every eligible prompt by default, without changing Claude's behavior. Skill routing requires `EFFORT_AUTO_ROUTE` to be enabled in Claude Code's settings env.

1. Pick the text to assess. Text typed after this command, if any, is between the brackets: [$ARGUMENTS]. If the brackets are empty, use the user's most recent request before this one, word for word. If there is no earlier request, ask which task they mean and stop.
2. Call the `effort_recommend` tool of the plugin's `effort` MCP server (full name `mcp__plugin_effort-project_effort__effort_recommend`) with `prompt` set to that text, unchanged, and `provider` set to `claude`. If the tool is unavailable, say so and suggest checking the `plugin:effort-project:effort` server in `/mcp`. Don't guess a level.
3. Answer in a few short lines:
   - The suggested model, tier and effort level and each of the returned `reasons`, in plain words.
   - The returned `caveat`: these are transparent keyword and length rules with low confidence, not a measurement of how hard the task is.
   - The hook shows only a suggestion by default. When `EFFORT_AUTO_ROUTE` is enabled, low invokes `effort-project:route-fast` in a fork on the fast model at low effort; high with the frontier tier invokes `effort-project:route-frontier` in a fork on the frontier model at high effort; other high recommendations invoke `effort-project:route-hard` to set high effort for the rest of the turn in the current conversation. Medium shows only a suggestion. A short follow-up without a rule signal can inherit the most recent signaled recommendation among up to three earlier user prompts in the last 64 KiB of the local transcript. The hook uses no repository facts, so those facts or inherited context can make this tool's recommendation differ.
4. Don't change how you work on the task, redo earlier work, or run commands because of the recommendation unless the user asks.
