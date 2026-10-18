# Pilot plan: the first live benchmark

Proposed on 2026-10-18. **Nothing here has been run against a real model.** The live stages need the owners' approval of the budget below first.

The pilot does two things: it checks the live pipeline on Windows with Claude Code, and it measures what each arm costs, so the full benchmark can be sized. It cannot show that Effort keeps quality equal. With eleven tasks the pass-rate interval stays far too wide for that (see [What eleven tasks can show](#what-eleven-tasks-can-show)).

## Setup found on the Windows machine

- **Claude Code 2.1.299 ships inside the Claude desktop app**, at `%LOCALAPPDATA%\Packages\Claude_pzs8sxrjxfjjc\LocalCache\Roaming\Claude\claude-code\<version>\<build>\claude.exe`. With `EFFORT_CLAUDE_BIN` set to it, `node bin/effort.mjs doctor` reports `claude: 2.1.299 (Claude Code) (EFFORT_CLAUDE_BIN)`. Its `--help` lists every flag the adapter requires, and the bundle defines the hidden `--max-turns <turns>`.
- **That CLI is not signed in.** `claude auth status` reports "Not logged in", both with the environment the adapter gives it and with the full environment. The desktop app keeps its own sign-in and does not share it with child processes. A one-time `auth login` is needed (commands below).
- Codex is not installed, so the pilot runs Claude only.
- Node.js 24.19.0 and Python 3.14.7 are present.

Offline validation on this machine, on the final code: `self-test` passed all 11 tasks in 4 s. The default plan ran 110 runs through the real adapters and fake CLIs in 70 s, and all seven arms with 3 repeats ran 462 runs in 3 min 55 s, both without a harness error. `report` rebuilt the summary. `npm test` gives 263 passed, 0 failed, 5 skipped (POSIX-only), and `npm run check` passes.

Preparing the pilot turned up four bugs, all fixed with regression tests (see the changelog):

1. A live run probed the bare name `claude` for its version and ignored `EFFORT_CLAUDE_BIN`, so a CLI that `doctor` found was refused before the first run.
2. A run ended by a provider-side failure, such as not being signed in or a usage limit, was scored as a failed task and was not redone on `--resume`. Such runs are now excluded, the benchmark stops, and `--resume` redoes them.
3. The cost of a retried Claude run was dropped, although its last attempt reports the conversation's total. Cost comparisons left out exactly the runs that retried.
4. The Claude adapter turned a usage-limit stop into a generic CLI failure when the result's wording was not one it recognized, which hid case 2.

## What runs

| Setting | Pilot | Reason |
| --- | --- | --- |
| Provider and model | Claude, `--claude-model claude-sonnet-5-5` | Half the list price of Opus 5.5. The adapter refuses Haiku models, so Haiku 5.5 is not an option. With the model pinned, a different model stops the benchmark instead of mixing into the results |
| Arms | the five default arms | `fixed-low`, `fixed-medium`, `fixed-high`, `auto-rules`, `auto-escalate` |
| Tasks and repeats | all 11, 1 repeat | 55 runs, at most 77 provider turns |
| Fixed before the run | margin 5 pp, reference `fixed-high`, seed `pilot-2026-10`, 600 s per run | Recorded in `meta.json` when the benchmark starts |

Stage 0 is a smoke test of 2 runs: `node-paginate` with `fixed-low` and `auto-escalate`. Stage 1 is the pilot. Each stage starts only after the one before it has been checked.

## Cost estimate

No live run exists to measure from, so the estimate rests on these assumptions per CLI turn (one attempt):

| Quantity | Low | Central | High | Basis |
| --- | --- | --- | --- | --- |
| Fixed prompt: Claude Code's system prompt, 5 tool schemas, environment | 5k | 8k | 15k tokens | Not measured. The plugin's live check (Haiku 5.5, all default tools) cost about $0.004 per short run, which suggests 12–15k with every tool |
| API calls per turn at low / medium / high effort | 3 / 3 / 4 | 4 / 5 / 6 | 6 / 8 / 10 | Each task touches 1–3 small files |
| Tool results per turn | 1k | 2k | 4k tokens | Each task's files total 0.7–2.6 KB, about 200–750 tokens |
| Output, thinking included, at low / medium / high | 1k / 2k / 4k | 2k / 4k / 8k | 6k / 12k / 24k tokens | A guess; the pilot measures it |
| `auto-escalate` runs that need a 2nd / a 3rd turn | 15% / 5% | 25% / 10% | 40% / 20% | A guess |

Each new token is written to the prompt cache once. Each later API call reads the fixed prompt back, plus on average half of what the turn has added. Nothing is shared between runs, because every run has its own working directory. Claude Code caches almost all input, so base input is ignored. Prices are from [Anthropic's pricing page](https://platform.claude.com/docs/en/about-claude/pricing), read on 2026-10-18, in $ per million tokens:

| Model | 5-minute cache write | 1-hour cache write | Cache read | Output |
| --- | --- | --- | --- | --- |
| Claude Sonnet 5.5 | 2.50 | 4.00 | 0.10 | 10 |
| Claude Opus 5.5 | 5.00 | 8.00 | 0.20 | 20 |
| Claude Fable 5.1 | 12.50 | 20.00 | 0.25 | 50 |

That gives these list-price estimates for the pilot on Sonnet 5.5, with an API key (5-minute cache writes):

| Arm | Turns in 11 runs | Central | Low–high | Every attempt used, high tokens |
| --- | --- | --- | --- | --- |
| `fixed-low` | 11 at low | $0.58 | $0.32–1.46 | $1.46 |
| `fixed-medium` | 11 at medium | $0.87 | $0.45–2.35 | $2.35 |
| `fixed-high` | 11 at high | $1.45 | $0.74–4.11 | $4.11 |
| `auto-rules` | 2 low, 7 medium, 2 high | $0.92 | $0.48–2.51 | $2.51 |
| `auto-escalate` | as `auto-rules`, plus retries | $1.29 | $0.59–4.27 | $8.80 |
| **Pilot, 55 runs** | 55–77 | **$5.12** | **$2.58–14.69** | **$19.23** |

Per run that is about $0.05 at low, $0.08 at medium and $0.13 at high effort, for about 2k, 4k and 8k output tokens. Other choices for the same 55 runs:

| Model and sign-in | Central | Low–high | Worst case |
| --- | --- | --- | --- |
| Sonnet 5.5, Claude subscription | $6.41 | $3.29–17.73 | $23.12 |
| Opus 5.5, API key | $10.24 | $5.16–29.38 | $38.46 |
| Opus 5.5, Claude subscription | $12.81 | $6.58–35.46 | $46.25 |
| Fable 5.1, API key | $24.91 | $12.67–70.78 | $92.65 |

The smoke test costs about $0.15 on Sonnet 5.5, and at most about $1. With an API key (`auth login --console`), runs are billed at these prices. On a Claude subscription (`auth login --claudeai`, the default), they count against the plan's 5-hour and weekly usage windows and nothing is billed, unless usage credits are on. Claude Code's cost figure is then an estimate at list price with 1-hour cache writes, which is why the subscription rows are higher.

Time was not measured. At 30–90 s per turn the pilot takes about 30–120 minutes; the ceiling is 55 × 600 s, 9.2 hours.

## Spend cap and commands

**Proposed cap: $25 at list price for stages 0 and 1 together on Sonnet 5.5**, above their combined worst case of about $20–24. For Opus 5.5 instead, $50. The cap is held in place by:

- `--max-runs 2`, then `--max-runs 55`. The harness refuses a larger plan before starting anything.
- At most 3 attempts and 600 s per run.
- The account. With an API key, set a $25 spend limit on the Console workspace that Claude Code bills. On a subscription, keep usage credits off, or give them a monthly spend limit.
- A checkpoint after stage 0. If the measured cost per turn is more than twice the central estimate above, stop and re-plan.
- During stage 1, `node bench/run.mjs report <out>` rebuilds `summary.md` from the finished runs at any time. Its "Total cost, known runs" column is the spend so far. Ctrl+C stops after cancelling the current run.

The harness has no dollar cap of its own: `--max-runs` bounds activity, not the bill.

Run these from the repository root in a normal PowerShell window, not inside a Claude Code session. Don't update the desktop app while the benchmark runs, because that changes the CLI's path and version.

```powershell
$env:EFFORT_CLAUDE_BIN = (Get-ChildItem "$env:LOCALAPPDATA\Packages\Claude_*\LocalCache\Roaming\Claude\claude-code\*\*\claude.exe" | Sort-Object { [version]$_.Directory.Parent.Name } | Select-Object -Last 1).FullName
node bin/effort.mjs doctor
& $env:EFFORT_CLAUDE_BIN auth login
& $env:EFFORT_CLAUDE_BIN auth status --text
```

`auth login` opens the browser. Add `--console` for API billing; without it, the CLI signs in with the Claude subscription. Stage 0, the smoke test:

```powershell
node bench/run.mjs --live --max-runs 2 --providers claude --claude-model claude-sonnet-5-5 --tasks node-paginate --arms fixed-low,auto-escalate --seed pilot-smoke --out bench/results/pilot-smoke
```

Check it before going on:

- `meta.json` shows `"claude": "2.1.299 (Claude Code)"` under `providerVersions`.
- In `runs.jsonl`, each run has `providerError: null`, `model.observed` is `["claude-sonnet-5-5"]`, `usage.costUsd` and `usage.totalTokens` are not null, and a passing run's `changedFiles` names `src/paginate.mjs`.
- The cost and `wallMs` of each run are close to the estimate. If `auto-escalate` retried, known tokens on that run mean Claude Code 2.1.299 confirms a resumed turn's tokens.

Stage 1, the pilot:

```powershell
node bench/run.mjs --live --max-runs 55 --providers claude --claude-model claude-sonnet-5-5 --seed pilot-2026-10 --out bench/results/pilot-sonnet-5-5
```

If it stops, for example with exit code 3 when a usage window runs out, run the same command with `--resume` added once the cause is fixed. `bench/results/` is git-ignored, so publishing a result takes `git add -f`.

## How the result will be read

This is fixed now, before any live run.

**Primary comparison: `auto-rules` against `fixed-high`.** Both get one attempt, so the difference is the rules' choice of effort and nothing else. The secondary comparisons are descriptive:

- `auto-escalate` against `fixed-high` is what `effort run` does by default. Its retries also raise its pass rate, so it does not isolate routing.
- `fixed-medium` against `fixed-high`: if a lower fixed level does as well, the rules add nothing over it. Compare `auto-rules` with `fixed-medium` in the per-arm tables.

"Effort saves tokens at an equal pass rate" holds only if all three of these hold for the primary comparison:

1. The verdict is **non-inferior**: the whole 95% paired interval for the pass-rate difference lies above −5 pp.
2. The median tokens are lower than `fixed-high`'s, with usage known for every run of both arms, **and** the total estimated cost is lower. For Claude the harness counts uncached input plus output as tokens. Cache reads and writes, which carry most of the input, appear only in the cost, so the two must agree.
3. The run is clean. Only one model was observed, no excluded run is left after `--resume`, and every run that changed visible tests has been reviewed. Runs stopped by the turn or time limit (`claude:max_turns`, `claude:timeout` in `diagnostics`) are reported per arm and not concentrated in one arm.

The same three conditions for `auto-escalate` support only a narrower statement: `effort run`'s defaults used fewer tokens than one high-effort attempt, at an equal pass rate.

These do not count:

- An inconclusive or inferior verdict, whatever the token ratio. Then the honest summary is "fewer tokens; an equal pass rate is not shown".
- Savings with incomplete usage (the summary's "Incomplete usage" note), or with excluded runs left over.
- Any result from the fake providers.
- A margin, arm set, task set, model or primary comparison chosen after seeing the data, or results pooled across models.
- Any statement beyond these eleven small tasks and this model.

### What eleven tasks can show

The harness's own interval code gives these limits:

- If both arms pass and fail on the same tasks, the paired interval stays at about ±22–26 pp however many repeats run, because each task then counts once.
- With no disagreements at all, a 5 pp verdict needs about 58 tasks at an 80% pass rate and 73 at 100%. If the arm loses one task, it needs about 100.
- Repeats narrow the interval only when outcomes vary within tasks. In the offline 3-repeat run, where every repeat is an independent synthetic draw, the design effect was 1.00 and `auto-escalate` came out non-inferior. Real models may vary less.

So the likely pilot result is a measured token and cost ratio with a wide, inconclusive pass-rate interval. That measures the size of the savings and the corpus needed. It is not the claim.

## After the pilot

These are the owners' decisions:

1. Publish the pilot summary as a calibration result, labeled as such.
2. Stage 2: 3 repeats with the opt-in `medium-escalate` and `medium-retry` arms, 231 runs at about 4–5 times the pilot's measured cost. It shows how much outcomes vary within tasks.
3. For the claim itself, a held-out corpus of 60–100 tasks written without looking at the rules (see "Keep the corpus held out" in [README.md](README.md)). A private one is being built outside this repository. Its first three rounds have 60 tasks, 30 Node.js and 30 Python, covering all seven categories, and every hidden check rejects its task's plausible wrong fixes (one to seven per task, 174 in all). Each round's prompts were frozen in a commit of that corpus before any run applied the rules to them: round 1 in `9fbff27b9381c603e319a173a49da318004317de`, round 2 in `8e8713b3bcb97b96c6b547bebb69e14655940b1b`, round 3 in `f2352868d7869255f17df287e1d44613ddf0e1ff`. The corpus's README records what each round's author saw of the rules. The corpus stays private until the claim's results are published with it.

## Known gaps

- **Unrecognized usage-limit wording.** The adapter recognizes a usage limit from the stream's `rate_limit` error field, or from "usage limit", "rate limit" or 429 in the error text. Other wording ends as a generic failure, which is scored as a failed task. If several runs in a row end within seconds as "fail · usage unknown", stop with Ctrl+C. Check `diagnostics` in `runs.jsonl`, delete those lines, and resume.
- **Turn limit.** Claude gets the adapter's default of 12 agentic turns per attempt in every arm; the harness does not set `maxTurns`. A turn that hits the limit ends blocked and still gets the hidden check.
- **Token counts of retried runs.** A retried run's tokens are known only when the resumed turn's stream confirms them, which stage 0 can show. Its cost is known on Claude Code 2.1.277 and later.
- **Agent-written code.** The checks run it as your user account. The fixtures are this repository's own tasks.
