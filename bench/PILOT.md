# Pilot plan: the first live benchmark

Proposed on 2026-10-18 and run the same day, after the owners approved the $25 cap. The plan below is kept as it was fixed before the run. The outcome is under [Results](#results).

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

Note added 2026-11-16: the adapter has accepted Haiku 5.x since 2026-11-16 because it supports effort. The table above preserves the recorded pilot plan and its model choice.

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

## Results

Run on 2026-10-18 on Claude Sonnet 5.5 through Claude Code 2.1.299, signed in with a Claude Max account, so the runs used plan usage and nothing was billed. All 55 runs were scored, with usage known for every one, and only `claude-sonnet-5-5` was observed. By Claude Code's list-price estimate the pilot cost $1.13 and the smoke test $0.03, well under the $25 cap. The 55 runs took about 14 minutes.

| Arm | Passed | Median tokens | vs `fixed-high` | Total cost | vs `fixed-high` |
| --- | --- | --- | --- | --- | --- |
| `fixed-low` | 11/11 | 735 | 0.75× | $0.195 | 0.69× |
| `fixed-medium` | 11/11 | 846 | 0.87× | $0.209 | 0.74× |
| `fixed-high` | 11/11 | 978 | 1.00× | $0.282 | 1.00× |
| `auto-rules` | 11/11 | 821 | 0.84× | $0.213 | 0.76× |
| `auto-escalate` | 11/11 | 906 | 0.93× | $0.234 | 0.83× |

Read as fixed before the run:

- **The primary comparison is inconclusive.** `auto-rules` against `fixed-high` gives a pass-rate difference of +0.0 pp, with a 95% interval from −25.9 to +25.9 pp. "Effort saves tokens at an equal pass rate" therefore does not hold. What the pilot shows is that `auto-rules` used fewer tokens and less cost; an equal pass rate is not shown.
- **The seed corpus does not separate effort levels for this model.** Every arm, `fixed-low` included, passed all eleven tasks. On these tasks a fixed low or medium level was as cheap as the rules or cheaper. The rules chose high for `node-money-refactor` and `py-async-cache`, which low also solved.
- **`auto-escalate` never retried**, because every first attempt passed the visible check. It measured the same as `auto-rules`, plus noise.
- **The run was clean.** One model was observed, and no excluded run was left. No run hit the turn or time limit. One run changed visible tests (`fixed-high` on `node-csv-quotes`); on review it only added test cases. One run had a permission denial (`fixed-high` on `py-async-cache`): the model tried to write a scratch test file outside its workspace, `--restricted` refused it, and the run still passed.

Median per turn, Claude Code's estimate with 1-hour cache writes:

| Effort | Cost | Output tokens | Cached prompt tokens |
| --- | --- | --- | --- |
| low | $0.015 | 668 | about 15k |
| medium | $0.018 | 840 | about 15k |
| high | $0.028 | 1,659 | about 20k |

That is 3–5 times below the central estimate, mostly because output was much smaller than assumed.

Getting there took two adapter fixes and one harness fix, each with a regression test:

- **Startup refusal.** Claude Code 2.1.299 reports two built-in plugins at startup, so the adapter refused every turn with `isolation_mismatch` before any model call. The allowlist now names exactly those two.
- **Bash request.** In the 42nd run, the model asked for `Bash` after finishing its edit, and the CLI refused. The adapter stopped the turn and called it `isolation_mismatch`, which the harness treated as a provider failure, so it stopped the benchmark. That request is now `tool_not_allowed` and counts against the arm. The run was redone on `--resume` (its first attempt had also passed the hidden check), and the summary names the commit the resumed runs used.

What would make the evidence stronger, for the owners to decide:

- **Harder tasks, not more repeats.** When every arm agrees, each task counts once, so repeats of these tasks cannot narrow the interval. The claim needs harder held-out tasks.
- **Possibly a model where effort matters more.** Sonnet 5.5 solved every seed task even at low effort.
- **A rough cost for the next step.** At about $0.02 per run, a held-out run of 100 tasks with five arms (500 runs) would cost roughly $10 at list price for tasks of this size. Harder tasks would cost more.

The raw results (`runs.jsonl`, `meta.json`, `summary.md`, chart) are not committed. Publishing them with `git add -f` is the owners' call.

## Codex and Gemini pilots, 2026-11-16

The same pilot was run on the other two providers after Gemini support was added: the 11 seed tasks, the five default arms, 1 repeat, 55 runs each, margin 5 pp, reference `fixed-high`, seed `pilot-2026-11`, 600 s per run. A 2-run smoke test on `node-paginate` came first for each. Both ran on macOS (Node 26.13.0) on subscription sign-ins, so nothing was billed and neither CLI reports a cost. The harness was at commit `1a0a406`; the commits after it changed the Claude adapter and documentation only.

```sh
node bench/run.mjs --live --max-runs 55 --providers codex --codex-model gpt-6.1-sol --seed pilot-2026-11 --out bench/results/pilot-codex-gpt-6.1-sol
node bench/run.mjs --live --max-runs 55 --providers gemini --gemini-model gemini-4-argon --seed pilot-2026-11 --out bench/results/pilot-gemini-4-argon
```

| Provider and model | Arm | Passed | Median tokens | vs `fixed-high` | Median output tokens | Median wall time |
| --- | --- | --- | --- | --- | --- | --- |
| Codex 0.160.0, `gpt-6.1-sol` | `fixed-low` | 11/11 | 168,627 | 1.00× | 858 | 37.2 s |
| | `fixed-medium` | 11/11 | 155,891 | 0.92× | 1,237 | 39.3 s |
| | `fixed-high` | 11/11 | 168,581 | 1.00× | 1,830 | 50.9 s |
| | `auto-rules` | 11/11 | 166,913 | 0.99× | 1,264 | 41.3 s |
| | `auto-escalate` | 11/11 | 155,125 | 0.92× | 998 | 32.8 s |
| Antigravity 1.5.9, `gemini-4-argon` | `fixed-low` | 11/11 | 21,390 | 0.79× | 1,168 | 56.3 s |
| | `fixed-medium` | 11/11 | 21,962 | 0.81× | 1,504 | 49.3 s |
| | `fixed-high` | 11/11 | 27,088 | 1.00× | 3,013 | 73.8 s |
| | `auto-rules` | 11/11 | 22,569 | 0.83× | 1,976 | 63.1 s |
| | `auto-escalate` | 11/11 | 22,446 | 0.83× | 2,262 | 64.3 s |

Read by the rules fixed before the first pilot:

- **The primary comparison is inconclusive on both providers.** `auto-rules` against `fixed-high` gives +0.0 pp with a 95% interval from −25.9 to +25.9 pp. "Effort saves tokens at an equal pass rate" does not hold here either.
- **The seed corpus does not separate effort levels for these models.** Every arm passed all eleven tasks, `fixed-low` included, as on Claude Sonnet 5.5. `auto-escalate` never retried.
- **Codex token counts are dominated by input.** Each run reads about 155,000 tokens of fixed prompt and tools, so the effort level moves the total by a few percent at most; the output tokens (858 at low, 1,830 at high) show the difference. No cost is reported, so the cost condition cannot be checked on Codex or Gemini.
- **Gemini's rules arm used fewer tokens than `fixed-high`** (0.83×), about the same as a fixed medium level (0.81×). On these tasks the rules add nothing over a lower fixed level.
- **Both runs were clean.** All 55 runs were scored with usage known, one model was observed per provider, and no run was excluded. For Gemini the observed model is the pinned id, and the backend's display label was recorded for each run: "Gemini 4 Argon" at Low for 15 runs, Medium for 25 and High for 15, which matches the arms.

These pilots used a pinned model in every arm, as the Claude pilot did. They do not test the model choice added on 2026-11-16; that needs an arm that routes the model too, and harder held-out tasks. The raw results are in the git-ignored `bench/results/` on the machine that ran them and are not committed.

## Model-routing pilot, 2026-11-17

The first benchmark in which the model is routed too. It used the arms added the same night (`--arms routing`): `fixed-daily` (the daily model at medium, what most people run), `fixed-frontier` (the frontier model at high, the reference), `auto-route` (the rules pick the model and effort) and `auto-route-escalate` (`effort run`'s defaults). The 17 tasks are the 11 seed tasks plus six harder ones added that night. Policy `rules-0.3`, macOS, Node 26.13, Claude Code 2.1.310, codex-cli 0.160.0, agy 1.5.9. Margin 5 pp, 600 s per run, fixed before the runs. Pass rates use `wilsonByTask` and differences use `newcombePairedByTask` from `bench/lib/stats.mjs`; pooled Claude figures combine two benchmark runs (seeds `overnight-2026-11-17` with one repeat and `overnight-2026-11-17-r2` with two), paired within each run.

| Provider | Arm | Passed | Pass rate (95% CI) | vs `fixed-frontier` (95% CI) | Usage |
| --- | --- | --- | --- | --- | --- |
| Claude | `fixed-frontier` (Fable, high) | 51/51 | 100% (81.6–100) | reference | $8.67 |
| Claude | `fixed-daily` (Sonnet, medium) | 49/51 | 96.1% (80.6–99.3) | −3.9 pp (−19.4 to +9.8), inconclusive | $1.06 |
| Claude | `auto-route` | 49/51 | 96.1% (80.6–99.3) | −3.9 pp (−19.4 to +9.8), inconclusive | $1.39 |
| Claude | `auto-route-escalate` | 49/51 | 96.1% (80.6–99.3) | −3.9 pp (−19.4 to +9.8), inconclusive | $1.45 |
| Codex | `fixed-frontier` (gpt-6-astra, high) | 17/17 | 100% (81.6–100) | reference | 3.30M tokens |
| Codex | `fixed-daily` (gpt-6.1-sol, medium) | 17/17 | 100% | 0.0 pp (−18.4 to +18.4), inconclusive | 3.13M tokens |
| Codex | `auto-route` | 17/17 | 100% | 0.0 pp (−18.4 to +18.4), inconclusive | 3.17M tokens |
| Codex | `auto-route-escalate` | 17/17 | 100% | 0.0 pp (−18.4 to +18.4), inconclusive | 3.21M tokens |
| Gemini | `fixed-frontier` (argon, high) | 17/17 | 100% (81.6–100) | reference | 533k tokens |
| Gemini | `fixed-daily` (argon, medium) | 14/15 | 93.3% (70.2–98.8) | −6.7 pp (−29.8 to +14.4), inconclusive | 360k tokens |
| Gemini | `auto-route` | 15/16 | 93.8% (71.7–98.9) | −6.3 pp (−28.3 to +13.8), inconclusive | 432k tokens |
| Gemini | `auto-route-escalate` | 14/15 | 93.3% (70.2–98.8) | −6.7 pp (−29.8 to +14.4), inconclusive | 396k tokens |

Codex ran the six hard tasks and the eleven seed tasks as two benchmarks with the same seed; Codex reports tokens, not cost. Gemini stopped at 63 of 68 runs when the provider reported `rate_limited`; that run was excluded, and `--out bench/results/gemini-routing-r1 --resume` with the same options finishes it. Gemini reports tokens, not cost. The rules picked the daily model for most tasks: Claude sonnet 45, haiku 3, fable 3 of 51 `auto-route` runs; Codex gpt-6.1-sol 15, luna 1, astra 1.

What this shows and does not show:

- **Every failure is one task.** All eight failed runs, across Claude and Gemini, are `node-bank-ledger`, and the frontier arm passed it every time. The rules sent it to the daily tier at medium because its prompt ("bank event replay", "transfers without enough funds", "balances") names no word on the risk list. In every failure the visible check passed and the hidden check failed, so `auto-route-escalate` had no failing test to react to.
- **Against always using the frontier model**, routing cost about a sixth on Claude ($1.39 against $8.67) with a pass-rate difference whose interval still reaches −19 pp. Equal quality is not shown.
- **Against simply defaulting to the daily model**, routing did not help on this corpus: same pass rate, slightly higher cost on Claude ($1.39 against $1.06), because it picked the daily model for most tasks and Fable for three. Its fast-tier picks saved little because the fast tasks are already cheap.
- **On Codex, model and effort barely move the bill.** About 190,000 tokens per run are fixed prompt and tools, so the four arms differ by under 6% in total tokens.
- **Caveats.** The six new tasks were written the same night by a worker that knew the rules exist (told not to game them). The rule that only counts a comment edit with an edit verb was changed after seeing the rules' picks on these prompts, before any live run. Seventeen tasks give intervals about ±19 pp wide; only the private held-out corpus can support a claim.

Next steps the data points to: treat money movement (transfers, funds, balances, ledger) as risky; and compare `auto-route` against `fixed-daily`, not only against the frontier, on the held-out corpus.
