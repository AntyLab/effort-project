---
description: Explain The Effort Project's effort suggestion for the user's latest request, with the rule-based reasons and how to apply it with /effort. Use when the user asks why Effort suggested a level, or which effort level Effort recommends for a task.
argument-hint: "[task text]"
allowed-tools: mcp__plugin_effort-project_effort__effort_recommend
---

Explain what The Effort Project recommends and why. Effort is advisory: neither you nor this plugin can change the session's effort level. Only the user can, with `/effort <level>`.

1. Pick the text to assess. Text typed after this command, if any, is between the brackets: [$ARGUMENTS]. If the brackets are empty, use the user's most recent request before this one, word for word. If there is no earlier request, ask which task they mean and stop.
2. Call the `effort_recommend` tool of the plugin's `effort` MCP server (full name `mcp__plugin_effort-project_effort__effort_recommend`) with `prompt` set to that text, unchanged, and `provider` set to `claude`. If the tool is unavailable, say so and suggest checking the `plugin:effort-project:effort` server in `/mcp`. Don't guess a level.
3. Answer in a few short lines:
   - The suggested level and each of the returned `reasons`, in plain words.
   - The returned `caveat`: these are transparent keyword and length rules with low confidence, not a measurement of how hard the task is.
   - How to apply it: `/effort <level>`. On some models Claude Code asks for confirmation first, because changing effort mid-session re-reads the conversation without the prompt cache.
   - If the prompt hook showed a higher level than the tool returns now: the hook also counts the programming languages and the files named in the prompt in the working directory, which this tool does not see.
4. Don't change how you work on the task, redo earlier work, or run commands because of the recommendation unless the user asks.
