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

A run that ends with a provider-side failure is not a result of its arm: the CLI is not signed in, a usage or rate limit refused the request, the model is unavailable or changed, the CLI lacks a required flag, or it reported tools outside the managed configuration. The adapter codes are listed in `PROVIDER_FAILURES` in [lib/plan.mjs](lib/plan.mjs). Such a run is recorded with `providerError`, left out of scoring like a harness error, and redone on `--resume`. The benchmark stops after it with exit code 3, because the next runs would most likely fail the same way. What an arm does with its turn still counts against it: running out of agentic turns, time or output, or a denied tool permission.

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
- Never mention `bench_accept` in a prompt. Have the hidden check fail through assertions; a module that does not exist yet should not crash it, because Effort treats "Cannot find module" as an environment error, not a test failure. The import error must not show in the output at all: a Python test that catches the `ImportError` and calls `self.fail()` inside the `except` block still prints `ModuleNotFoundError` in its traceback, so fail after the block. In Node.js, load such a module with a dynamic `import()` inside `try`, and keep the caught error's message out of the assertion.
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
| `usage` | Run totals of `inputTokens`, `outputTokens`, `cachedInputTokens`, `costUsd` and `totalTokens`, or **null when any attempt did not report them**. A retried Claude run's `costUsd` is the conversation total its last attempt reported (`costSource: "conversation"`) |
| `wallMs` | Wall time of the managed run (provider turns and visible checks; hidden check excluded) |
| `changedFiles`, `visibleTestsChanged` | Paths the agent added, modified or deleted (names only), and whether it touched visible tests |
| `interrupted`, `harnessError`, `providerError` | Runs stopped with Ctrl+C, failed inside the harness, or ended by a provider-side failure (the adapter's code). They are excluded from scoring and redone on `--resume` |

`summary.md` reports, for each provider and arm:

- pass rate with its Wilson 95% interval, which allows for repeats of a task, and how often the visible check passed but the hidden one failed
- median tokens with the interquartile range, median output tokens, total tokens, and cost where reported
- median wall time, mean attempts and escalations
- per-task pass counts
- the pass-rate difference from the reference arm over paired runs, with a 95% interval for paired proportions that allows for repeats of a task, and how many runs had no partner (see below)

It then gives a verdict against the non-inferiority margin (`--margin`, default 5 percentage points), which is recorded in `meta.json` when the benchmark starts. `node bench/run.mjs report <dir>` rebuilds the summary from `runs.jsonl`.

### How arms are compared

Every arm runs the same tasks and repeats, so the comparison with the reference arm is paired. Within a provider, each run is matched with the reference arm's run of the same task and repeat. Each pair is one of four kinds: both passed, only the arm passed, only the reference passed, or neither passed. The difference is (only the arm passed − only the reference passed) ÷ pairs. Its 95% interval is Newcombe's method 10 for paired proportions (Newcombe 1998, *Statistics in Medicine* 17:2635–2650): a Wilson interval for each arm's pass rate over the pairs, combined using the correlation between the two arms' outcomes. When the arms pass and fail on the same runs, the interval is narrower than two independent samples would give. When they fail on different runs, it is wider.

A run without a partner is left out of the difference and shown in the "Paired runs" column. That happens when its counterpart hit a harness error or a provider failure, was interrupted, or has not run yet. The run still counts in its own arm's pass rate. So the difference can differ from the gap between the two pass rates in the outcomes table.

With more than one repeat, the pairs of one task are not independent: whatever makes a task hard for one arm and not the other, such as the rules picking too low an effort for it, shows up in every repeat. So the interval counts them as fewer, *effective* pairs. Following Rao and Scott (1992, *Biometrics* 48:577–585), the four pair counts are divided by a design effect before Newcombe's interval is computed. The design effect compares two variances of the difference: one computed between tasks (the clustered variance Obuchowski used for matched pairs: Obuchowski 1998, *Statistics in Medicine* 17:1495–1507), the other as if every pair were independent. It is kept between 1 and pairs ÷ tasks, so the interval never counts more pairs than were run or fewer than one per task. An estimate below 1 is treated as noise, not as a reason to narrow the interval. When there is nothing to estimate it from, because every pair had the same result (usually, every pair agreed) or there is only one task, each task counts once. Repeating tasks whose outcomes never vary therefore cannot produce a non-inferior verdict. A single disagreement, by contrast, looks like independent noise and gives a design effect of 1, so it can yield a narrower interval than no disagreement at all. With one repeat every task has one pair, the design effect is exactly 1, and nothing changes. The summary shows the design effect and the effective pairs when any task has more than one pair.

Other ways to allow for repeats were tried in a simulation over 11 and 20 tasks with 1 to 10 repeats, from near-deterministic to noisy tasks, including an arm that always fails a random few tasks:

- **Unadjusted pairs** (the interval without the design effect), over eleven tasks, covered the true difference in as few as 92% of samples at 3 repeats and 41% at 10.
- **One pair per task** (Newcombe over per-task pass fractions) always covered, but more repeats never narrowed it, so they would buy nothing.
- **A t-interval over per-task differences**, or **a task-clustered bootstrap**: both collapse to zero width when every task agrees, which reads as non-inferior. Over eleven tasks, with the true difference at the margin, they declared non-inferiority in up to 48% and 53% of samples, even with one repeat.
- **The design-effect interval**, at the default corpus with 3 repeats, covered 96–100% and declared non-inferiority at the margin in at most 3.2% of samples (unadjusted: 5.0%). It is closed form, needs no seed and never has zero width.

`newcombePairedByTask` in [lib/stats.mjs](lib/stats.mjs) records the reasoning. Its limits are described below.

The per-arm pass rates get the same treatment. An arm's repeats of one task share that task's difficulty, so its Wilson interval is computed on passes ÷ design effect out of runs ÷ design effect. This design effect is the between-task variance of the arm's pass/fail outcomes over their variance if every run were independent. It has the same bounds as the paired one, 1 to runs ÷ tasks, and is runs ÷ tasks when every run of the arm had the same outcome or there is only one task. Unlike the paired difference, a pass rate keeps the variation between easy and hard tasks, so its design effect is usually larger: if every task always passes or always fails, with the same number of runs each, it reaches runs ÷ tasks and the interval is the one-repeat interval. With one repeat it is exactly 1 and nothing changes. A simulation with the same task model, targeting the arm's pass rate over the population of tasks, found that over eleven tasks the unadjusted Wilson interval covered as little as 80% of the time at 3 repeats and 41% at 10. With the design effect it covered 93–98% and 86–95%. The outcomes table shows the design effect and the effective runs when any task has more than one run of an arm. `wilsonByTask` in [lib/stats.mjs](lib/stats.mjs) has the details.

The charts are separate SVG files because GitHub strips inline `<svg>` from Markdown. They paint their own light or dark surface, and every number in them is also in the tables.

### Reading the numbers honestly

- **Unknown usage is not counted as zero.** Medians and totals use only runs whose every attempt reported usage, and the summary shows how many that is. Codex reports no cost. Claude reports a resumed turn's tokens only when the turn's own stream confirms them (see [the Claude adapter notes](../docs/claude-adapter.md)), and the fake Claude CLI never does, so some Claude runs that retried have unknown token totals. That biases token comparisons toward the arms that retry less. Their cost is known: Claude Code 2.1.277 and later report the conversation's whole cost on every resumed turn, and every attempt of a run continues one conversation, so the run's cost is the last attempt's total. The harness uses that only when the probed CLI is 2.1.277 or later, and never adds totals together.
- Token fields are what each CLI reports, and the CLIs count input and cached tokens differently. Compare arms within a provider, not across providers. Claude also runs in restricted mode without a shell, so it cannot run tests itself, while Codex can.
- The paired difference removes the task-to-task variation both arms share. The per-arm Wilson intervals keep it, so they are wider than a comparison needs. Both count the repeats of one task as fewer runs. Judge a difference by its paired interval, not by whether two per-arm intervals overlap.
- **More repeats cannot replace more tasks.** The design effects are themselves estimated from eleven tasks. A failure confined to kinds of task the corpus lacks, or too rare to appear among its tasks, cannot show in any interval. In the simulations, with 10 repeats the paired interval still covered as little as 80% of the time (41% unadjusted), and the per-arm interval 86% (41% unadjusted). Repeats narrow the comparison only as far as the arms' disagreements vary within tasks. To make a verdict firmer, add tasks. A pilot cannot establish equal quality.
- The hidden check guards against accidental or opportunistic test editing, not a determined adversary: an agent that searched the disk could find this repository. `changedFiles` and `visibleTestsChanged` help spot that.
- Provider-side prompt caching can make later runs cheaper. The randomized order spreads that effect across arms instead of favoring one.

## Offline mode (the default)

Without `--live`, the real adapters drive two fake CLIs, using the same fake-process approach as `test/codex.test.mjs` and `test/claude.test.mjs`:

- [fake/codex.mjs](fake/codex.mjs) speaks the app-server JSON-RPC that [src/adapters/codex.mjs](../src/adapters/codex.mjs) uses.
- [fake/claude.mjs](fake/claude.mjs) emits the stream-json events [src/adapters/claude.mjs](../src/adapters/claude.mjs) reads.

Each simulated turn either copies the reference solution into the workspace or changes nothing. It succeeds with a made-up probability per difficulty and effort, set in [fake/model.mjs](fake/model.mjs), and reports synthetic token counts. The fake CLIs get no credentials. Their output is labeled synthetic in the summary and charts. It exercises the whole pipeline (adapters, `runTask` retries and escalation, hidden checks, JSONL, statistics, report) and says nothing about real models.

## Real runs

Real runs use your installed, signed-in Codex and Claude Code CLIs and count against your account: billed per token with an API key, or against your plan's usage limits on a subscription.

1. Install and sign in to each CLI, and confirm it with `node bin/effort.mjs doctor`. The harness starts the same CLI that `doctor` finds: `EFFORT_CODEX_BIN` or `EFFORT_CLAUDE_BIN` first, then on Windows a native `.exe` or an npm shim on `PATH`. `--codex-bin` and `--claude-bin` override that with a native executable or JavaScript entry point. They take no npm `.cmd` shim, because one cannot be started without a shell; name a shim with the environment variable instead. [PILOT.md](PILOT.md) has the plan for the first live run, with its cost estimate.
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

No real run has been made with this harness, so there is no measured cost per turn for these fixtures yet. The pilot gives you one, and [PILOT.md](PILOT.md) estimates it for Claude from the fixture sizes and current list prices. The plan bounds the size:

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

- `test/bench-stats.test.mjs` covers the Wilson and paired Newcombe intervals against published and hand-computed values, the design effects for repeats against hand-computed values (including a verdict that clustering changes, repeats that never vary staying at the one-repeat interval, and per-arm intervals unchanged with one repeat), the pairing of runs with the reference arm (including unpaired runs and a verdict that pairing changes), unknown-usage handling, the cost of retried Claude runs, provider failures left out of scoring, seeded schedules, the spend guard, and the fake-versus-live launch split.
- `test/bench-corpus.test.mjs` self-tests every task, checks the corpus's coverage and manifest validation, confirms that the hidden check replaces an agent-planted `bench_accept/`, and confirms that checks get no credentials.
- `test/bench-run.test.mjs` runs end-to-end offline benchmarks through the real adapters (including retries, escalation and unknown Claude usage), a resume after interruption, the CLI with nothing on `PATH`, the live-run refusals, and a live-mode run against a stub CLI named by `EFFORT_CLAUDE_BIN` that reports a usage limit, stops, and is redone on `--resume`.

Python tasks are skipped when Python 3.8 or later is not installed. No test can start a real provider.

## Possible next steps

The harness uses only `runTask` and the adapters as they are. `src/` has since gained what the first version of this list asked for; the harness does not use it yet:

1. **Per-turn usage for resumed Claude turns.** The Claude adapter now reports a resumed turn's tokens when the turn's own stream confirms them (`tokenScope: "turn"`, see [the Claude adapter notes](../docs/claude-adapter.md)). The fake Claude CLI does not emit per-message usage, so offline runs still show unknown usage for retried Claude runs.
2. **`maxTurns`.** `runTask` passes it to the Claude adapter. A harness option could set it and record it in `meta.json`.
3. **A shared executable resolver for the flags.** Without `--codex-bin` or `--claude-bin`, the harness already resolves the CLI through [src/provider-cli.mjs](../src/provider-cli.mjs), as `doctor` does. The flags still take their path literally, so they cannot name an npm `.cmd` shim.
