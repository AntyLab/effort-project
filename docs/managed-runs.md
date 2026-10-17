# Managed runs

`effort run` gives one task to your installed, signed-in Codex or Claude Code CLI, checks the result with a command you choose, and retries or raises effort when the same check keeps failing. This page is the full reference; the [README](../README.md#run-a-task-with-verification) has the short version.

Start with a disposable project or a reviewed working tree. Effort does not reset, stash, commit or revert anything, so inspect the final diff, including after a failed run.

## A first run

Without `--allow-write`, the agent works in its documented read-only mode:

```sh
effort run "Explain the queue implementation" --provider codex --cwd /path/to/project
```

This run is marked **unverified**, because no independent check was given. Effort doesn't treat a model's completion message as proof that the work is correct.

To allow constrained edits and check a Node project:

```sh
effort run "Fix the failing sum test" --provider codex --cwd /path/to/project \
  --allow-write --max-attempts 3 --timeout 180 -- node --test
```

Use `--provider claude` for Claude Code. Its adapter allows restricted file edits and does not give the model a general shell. The verification command runs separately.

## The verification command

Everything after `--` is the verification command. Put it last.

In PowerShell, quote the separator, because PowerShell removes a bare `--` when `effort` runs through npm's `effort.ps1` shim:

```powershell
effort run "Fix the failing sum test" --provider codex --cwd . --allow-write '--' node --test
```

Or give each part with `--verify-arg`, which no shell can mangle. Write a part that starts with `-` as `--verify-arg=--test`:

```powershell
effort run "Fix the failing sum test" --provider codex --cwd . --allow-write --verify-arg node --verify-arg=--test
```

Quote the task: `effort run` takes it as one argument and refuses extra words, so a dropped separator stops the run instead of running it unverified. Use `--prompt-file path` for a long task or one that starts with `-`.

**The verification command is a local executable and argument list, not a shell string. It runs with your normal user permissions, outside the provider's sandbox. Only use commands you trust.** Effort passes the arguments after `--` literally, without a shell.

- On Windows, `npm`, `npx`, `pnpm` and `yarn` work: Effort runs the JavaScript entry that their `.cmd` wrapper names, and Node's own `npm.cmd` resolves to the same npm it would pick. Other batch files can't run without a shell.
- A command that can't start (not found, or an unsupported batch file) stops the run before the first provider turn.
- The older JSON form, `--verify '["node","--test"]'`, still works in shells that keep the inner quotes. Windows PowerShell 5.1 removes them, so use `'--'` or `--verify-arg` there. Give the command in only one of these forms.

## Time, attempts and effort

- **Defaults:** three attempts, 600 seconds (10 minutes) in total, and a `high` ceiling. The total covers provider turns and verification.
- **Verification time:** each check may use the time left in the task. `--verify-timeout 300` limits each check to five minutes, and it can never exceed `--timeout`.
- **Background processes:** a check ends when its process exits, plus up to a second for remaining output. On Linux and macOS, a background process it started in its process group is then stopped. On Windows that process keeps running, because Effort can't reach it once the check has exited, so stop it in the check itself.
- **Effort and model:** `--effort low` overrides the initial recommendation, `--max-effort medium` sets a lower ceiling, and `--model` chooses a model. Adapters check the supported levels; an unsupported model or effort is never silently replaced.
- **Cost:** there is no universal dollar cap. Time, attempt and effort limits bound activity but don't guarantee a final bill.
- **Planning:** `--dry-run` prints the plan without starting a provider.

Earlier builds defaulted to 120 seconds in total and stopped any check after 60 seconds, so slower test suites ended as timeouts.

## How failures are handled

- The first recognized test failure can trigger another attempt at the same effort.
- Repeated matching failures can raise effort for the next managed turn. Failures match when the same named tests fail again, or, for unrecognized output, when it differs only in timings, temporary paths, ports, PIDs, timestamps, hex IDs or line numbers.
- Access, permission, missing-dependency, timeout and unclassified failures stop instead.
- A failure report from node:test, Jest, Vitest, pytest, unittest, `go test`, `cargo test`, mocha or another TAP producer counts as a test failure even when a failing test mentions authorization, permissions or missing files.
- A suite that couldn't run still stops, even when a runner reports it as failing: a module that can't be loaded, a refused connection (`connect ECONNREFUSED host:port`), an operating-system permission error (`EACCES: permission denied, open '…'`) or a missing command. Effort looks for these errors in the form they are thrown, not for words in test names or assertion messages.

Passing the selected check means **that check passed**, not that every requirement is met.

## Exit status

| Status | Meaning |
| --- | --- |
| 0 | The task completed, verified or unverified |
| 1 | Invalid command-line input |
| 2 | The task was blocked, failed or cancelled |

## Finding the agent CLIs

`effort doctor` reports which provider CLIs Effort can start. On Windows, Effort looks for `codex.exe` or `claude.exe` on `PATH`, then for npm's `codex.cmd` or `claude.cmd` shim, whose JavaScript entry it runs with the current Node; it never starts a shell. To choose a specific installation on any platform, set `EFFORT_CODEX_BIN` or `EFFORT_CLAUDE_BIN` to an executable, a JavaScript entry point or, on Windows, an npm `.cmd` shim.
