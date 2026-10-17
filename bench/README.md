# Effort benchmark harness

This harness measures whether Effort's routing reaches the same pass rate as fixed effort levels while using fewer tokens or less time. It follows the "Evaluate before learning" protocol in [docs/architecture.md](../docs/architecture.md):

- fixed baselines and identical clean fixture copies for every run
- independently assessed outcomes, randomized execution order and repeated runs
- the cost of failures and retries counted
- a non-inferiority margin fixed before the run, and uncertainty reported

Nothing here has been run against a real model yet. The repository makes no savings claim, and an offline run cannot support one.

Requirements: Node.js 22 or later; Python 3.8 or later for the Python tasks. There are no npm dependencies.

## Quick start (offline, no credentials)

```bash
node bench/run.mjs self-test
```

```bash
node bench/run.mjs plan
```

```bash
node bench/run.mjs
```

`self-test` proves that each task's hidden check fails on the starting fixture and passes on the reference solution. `plan` lists the tasks, the effort each one gets from the rules, and the run counts. The last command runs every task once per arm and provider against the **fake providers** and writes the results to `bench/results/<time>-fake/`:

| File | Contents |
| --- | --- |
| `runs.jsonl` | One JSON record per run, appended as soon as the run ends |
| `meta.json` | The plan, seed, margin, task digests, harness and provider versions |
| `summary.md` | Per-arm pass rates with 95% intervals, tokens, time, and comparisons with the reference arm |
| `chart-<provider>.svg` | Pass rate and median tokens per arm, linked from `summary.md` |

`bench/results/` is git-ignored. To publish a result deliberately, use `git add -f`.

## How one run works

1. The task's `repo/` is copied into a fresh temporary directory outside this repository.
2. `runTask` from [src/runner.mjs](../src/runner.mjs) runs the task through the real Codex or Claude adapter. It gets write permission, the arm's effort settings, the per-run time limit, and the task's **visible check** (its own test command) as `verify`. No shell is used anywhere.
3. When `runTask` returns, the final workspace is copied again. The task's hidden `accept/` files are placed in that copy as `bench_accept/`, replacing anything the agent created under that name, and the task's accept command runs there. **Pass means this hidden check passed.** The agent's workspace itself is never modified.
4. The record is appended to `runs.jsonl` and the temporary directories are removed. Keep them for inspection with `--keep-workspaces`.

The visible and hidden checks run agent-written code. Both run without credential environment variables (provider and service keys and tokens, and the `SSH_AUTH_SOCK` agent socket) and without `NODE_OPTIONS`, `PYTHONPATH` or similar injection variables. They still run as your user account, so files it can read, such as `~/.codex`, `~/.claude` or `~/.ssh`, are not hidden from them. Run live benchmarks under a disposable account or in a container.

Runs execute one at a time. Ctrl+C cancels the current run and writes the summary of the finished runs. Continue later with `--out <dir> --resume` and the original options. Finished runs are skipped, and an interrupted run is redone. Resuming refuses changed options or changed tasks.

## Arms

| Arm | Effort | Max effort | Attempts | What it measures |
| --- | --- | --- | --- | --- |
| `fixed-low` | low | high | 1 | Fixed baseline |
| `fixed-medium` | medium | high | 1 | Fixed baseline |
| `fixed-high` | high | high | 1 | Fixed baseline and the default reference arm |
| `auto-rules` | auto | high | 1 | The rules alone, one attempt |
| `auto-escalate` | auto | high | up to 3 | `effort run` defaults: the rules choose, a failed visible check is retried, and a repeated failure escalates |
| `medium-escalate` (opt-in) | medium | high | up to 3 | The architecture document's medium-with-escalation baseline |
| `medium-retry` (opt-in) | medium | medium | up to 3 | Retries without escalation, to separate retrying from escalating |

The single-attempt arms get no feedback. `auto-escalate` also benefits from retrying with the visible check's output, so compare it with `medium-retry` before crediting escalation. Every arm uses the same per-run time limit (`--timeout`, default 600 s live). That deliberately differs from `effort run`'s 120 s default, so that a slow high-effort turn is not cut off.

## The seed corpus

Eleven small, deterministic tasks in `bench/tasks/`. Rules picks are for policy `rules-0.1`; run `plan` to see the current ones.

| Task | Language | Difficulty | Category | Rules pick |
| --- | --- | --- | --- | --- |
| `node-rename-export` | Node | easy | typo / rename across files | low |
| `node-paginate` | Node | easy | off-by-one | medium |
| `node-duration` | Node | medium | failing unit test | medium |
| `node-money-refactor` | Node | medium | refactor across three files | high |
| `node-map-limit` | Node | hard | async concurrency limit | medium |
| `node-csv-quotes` | Node | hard | feature: quoted CSV fields | medium |
| `py-config-typo` | Python | easy | typo | low |
| `py-moving-average` | Python | easy | off-by-one | medium |
| `py-signup-validation` | Python | medium | input validation | medium |
| `py-inventory-reservations` | Python | medium | small feature | medium |
| `py-async-cache` | Python | hard | asyncio: shared loads, cancellation | high |

The hidden checks were also tried against plausible wrong fixes during development. They rejected an `AsyncCache` fix without `asyncio.shield`, a `mapLimit` that keeps starting calls after a rejection, half-fixed pagination, and a rename that kept the old alias. They accepted a legitimate batching `mapLimit`. The difficulty labels are the author's judgment, not measurements.

### Task format

Each task is listed in [tasks/manifest.json](tasks/manifest.json):

```json
{
  "id": "node-paginate",
  "language": "node",
  "difficulty": "easy",
  "category": "off-by-one",
  "prompt": "`paginate()` in src/paginate.mjs is off by one: …",
  "verify": ["{node}", "--test", "test/*.test.mjs"],
  "accept": ["{node}", "--test", "bench_accept/*.test.mjs"],
  "visibleFailsAtStart": true
}
```

The task's files live in `bench/tasks/<id>/`:

- `repo/` is the starting repository. It is copied fresh for every run.
- `solution/` is a reference solution, copied over `repo/`. It is used only by the self-test and the fake providers.
- `accept/` holds the hidden acceptance files. They are copied into `bench_accept/` of a copy of the final workspace.

Commands are argv arrays run without a shell. `{node}` becomes this Node binary. `{python}` becomes the first Python 3.8+ found (`python3`, `python`, or `py -3` on Windows), or the interpreter set with `--python` or `EFFORT_BENCH_PYTHON`. `visibleFailsAtStart` defaults to true. Set it to false for tasks such as refactors, whose tests pass before and after.

### Adding tasks

- The hidden check must fail on `repo/` with a recognized test failure and pass on `solution/`. Run `node bench/run.mjs self-test --tasks <id>`; the bench tests run it for every task too.
- Specify behavior in the prompt or in the code's own documentation. The hidden check may test only what was specified.
- Keep tasks deterministic and offline: no network, no reliance on timer precision, standard library only.
- Never mention `bench_accept` in a prompt. Have the hidden check fail through assertions; a module that does not exist yet should not crash it, because Effort treats "Cannot find module" as an environment error, not a test failure.
- **Keep the corpus held out.** These tasks were written by the project that wrote the rules. Do not tune [src/policy.mjs](../src/policy.mjs) against them. If the policy is ever tuned on a corpus, use a new set of tasks, written without looking at the rules, for the claim. Use `--manifest path/to/manifest.json` to keep a private held-out corpus outside the repository.

## Output

Each line of `runs.jsonl` is one run:

| Field | Meaning |
| --- | --- |
| `key`, `order`, `benchId` | `provider/task/arm/repeat`, position in that provider's randomized schedule (each provider's runs are shuffled and numbered separately, and the providers run one after the other), benchmark id |
| `provider`, `task`, `language`, `difficulty`, `category`, `arm`, `repeat` | What ran |
| `model.requested`, `model.observed` | Model asked for (null = provider default) and models the CLI reported |
| `effort.initial`, `effort.final`, `effort.decisions`, `effort.features`, `effort.policyVersion` | Effort decisions with their fixed reasons; no task text |
| `attempts[]` | Per attempt: effort, provider status, visible check result and failure kind, duration, usage |
| `runStatus`, `stopReason` | `runTask`'s verdict (`verified`, `failed`, `blocked`, …). This is *not* the pass/fail used for scoring |
| `accepted`, `acceptance` | **Pass/fail from the hidden check**, with its exit code and duration |
| `visibleCheckPassed` | Whether the last visible check passed. It can disagree with `accepted` |
| `usage` | Run totals of `inputTokens`, `outputTokens`, `cachedInputTokens`, `costUsd` and `totalTokens`, or **null when any attempt did not report them** |
| `wallMs` | Wall time of the managed run (provider turns and visible checks; hidden check excluded) |
| `changedFiles`, `visibleTestsChanged` | Paths the agent added, modified or deleted (names only), and whether it touched visible tests |
| `interrupted`, `harnessError` | Runs stopped with Ctrl+C or failed inside the harness. They are excluded from scoring and redone on `--resume` |

`summary.md` reports, for each provider and arm:

- pass rate with its Wilson 95% interval, and how often the visible check passed but the hidden one failed
- median tokens with the interquartile range, median output tokens, total tokens, and cost where reported
- median wall time, mean attempts and escalations
- per-task pass counts, and the difference from the reference arm with a Newcombe 95% interval

It then gives a verdict against the non-inferiority margin (`--margin`, default 5 percentage points), which is recorded in `meta.json` when the benchmark starts. `node bench/run.mjs report <dir>` rebuilds the summary from `runs.jsonl`.

The charts are separate SVG files because GitHub strips inline `<svg>` from Markdown. They paint their own light or dark surface, and every number in them is also in the tables.

### Reading the numbers honestly

- **Unknown usage is not counted as zero.** Medians and totals use only runs whose every attempt reported usage, and the summary shows how many that is. Codex reports no cost. Claude reports no per-turn tokens on resumed turns, so Claude runs that retried have unknown totals. That biases token comparisons toward the arms that retry less.
- Token fields are what each CLI reports, and the CLIs count input and cached tokens differently. Compare arms within a provider, not across providers. Claude also runs in restricted mode without a shell, so it cannot run tests itself, while Codex can.
- The intervals assume independent runs. Repeats of one task are correlated, so with eleven tasks the real uncertainty is larger than shown. Overlapping intervals mean the data cannot separate the arms. A pilot cannot establish equal quality.
- The hidden check guards against accidental or opportunistic test editing, not a determined adversary: an agent that searched the disk could find this repository. `changedFiles` and `visibleTestsChanged` help spot that.
- Provider-side prompt caching can make later runs cheaper. The randomized order spreads that effect across arms instead of favoring one.

## Offline mode (the default)

Without `--live`, the real adapters drive two fake CLIs, using the same fake-process approach as `test/codex.test.mjs` and `test/claude.test.mjs`:

- [fake/codex.mjs](fake/codex.mjs) speaks the app-server JSON-RPC that [src/adapters/codex.mjs](../src/adapters/codex.mjs) uses.
- [fake/claude.mjs](fake/claude.mjs) emits the stream-json events [src/adapters/claude.mjs](../src/adapters/claude.mjs) reads.

Each simulated turn either copies the reference solution into the workspace or changes nothing. It succeeds with a made-up probability per difficulty and effort, set in [fake/model.mjs](fake/model.mjs), and reports synthetic token counts. The fake CLIs get no credentials. Their output is labeled synthetic in the summary and charts. It exercises the whole pipeline (adapters, `runTask` retries and escalation, hidden checks, JSONL, statistics, report) and says nothing about real models.

## Real runs

Real runs use your installed, signed-in Codex and Claude Code CLIs and count against your account: billed per token with an API key, or against your plan's usage limits on a subscription.

1. Install and sign in to each CLI, and confirm it with `node bin/effort.mjs doctor`. On Windows, pass `--codex-bin` or `--claude-bin` with the CLI's native executable or JavaScript entry point. npm's `.cmd` shims cannot be started without a shell.
2. Pin the models with `--codex-model` and `--claude-model`. Otherwise the provider default is used and may change mid-benchmark. The summary flags a provider whose runs reported more than one model.
3. Check the plan:

   ```bash
   node bench/run.mjs plan --live --repeats 3
   ```

4. Run a small pilot. `--live` is required before any real provider starts. `--max-runs` is required with it, and the harness refuses any plan with more runs than that, before starting anything.

   ```bash
   node bench/run.mjs --live --max-runs 4 --providers codex --tasks node-paginate,py-config-typo --arms fixed-medium,auto-escalate --codex-model <model-id>
   ```

5. Read the pilot's token counts and times in `runs.jsonl`, extrapolate, and only then run the full plan. If the provider's sandbox refuses to write under the temporary directory, pass `--work-root <dir>`.

### What it may cost

No real run has been made with this harness, so there is no measured cost per turn for these fixtures yet. The pilot gives you one. The plan bounds the size:

| Plan | Runs | Most provider turns | Worst-case time at 600 s per run |
| --- | --- | --- | --- |
| Pilot above | 4 | 8 | 40 min |
| All tasks, default arms, one provider, 1 repeat | 55 | 77 | 9.2 h |
| All tasks, default arms, both providers, 1 repeat | 110 | 154 | 18.3 h |
| All tasks, default arms, both providers, 3 repeats | 330 | 462 | 55 h |

Each provider turn is a full agentic session: the CLI's own instructions and tools plus several model calls to read and edit files. Estimate the cost as *runs × average turns per run × tokens per turn × your price per token*, with tokens per turn taken from the pilot. Most runs end long before their time limit, so the time column is a ceiling, not an estimate. There is no universal spending cap. `--max-runs`, the attempt limits and the time limit bound activity, not the final bill.

The Claude adapter allows 12 agentic turns per CLI invocation by default. `runTask` accepts `maxTurns`, but the harness does not set it yet. A task that needs more ends `blocked`, and `meta.json` records the limit.

## Tests

`npm test` runs three offline test files:

- `test/bench-stats.test.mjs` covers Wilson and Newcombe intervals against published values, unknown-usage handling, seeded schedules, the spend guard, and the fake-versus-live launch split.
- `test/bench-corpus.test.mjs` self-tests every task, checks the corpus's coverage and manifest validation, confirms that the hidden check replaces an agent-planted `bench_accept/`, and confirms that checks get no credentials.
- `test/bench-run.test.mjs` runs end-to-end offline benchmarks through the real adapters (including retries, escalation and unknown Claude usage), a resume after interruption, the CLI with nothing on `PATH`, and the live-run refusals.

Python tasks are skipped when Python 3.8 or later is not installed. No test can start a real provider.

## Possible next steps

The harness uses only `runTask` and the adapters as they are. `src/` has since gained what the first version of this list asked for; the harness does not use it yet:

1. **Per-turn usage for resumed Claude turns.** The Claude adapter now reports a resumed turn's tokens when the turn's own stream confirms them (`tokenScope: "turn"`, see [the Claude adapter notes](../docs/claude-adapter.md)). The fake Claude CLI does not emit per-message usage, so offline runs still show unknown usage for retried Claude runs.
2. **`maxTurns`.** `runTask` passes it to the Claude adapter. A harness option could set it and record it in `meta.json`.
3. **A shared executable resolver.** [src/provider-cli.mjs](../src/provider-cli.mjs) resolves `EFFORT_CODEX_BIN` / `EFFORT_CLAUDE_BIN` and npm `.cmd` shims on Windows. `--codex-bin` and `--claude-bin` could reuse it.
