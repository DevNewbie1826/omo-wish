# wish v2 — measurement and metrics (M7)

Two tools and two files carry wish v2's measurement. `scripts/metrics.mjs` derives and
validates the shared experiment rows; `scripts/pr-watch.mjs` watches one pull request and
prints a machine-readable state line for an omo `monitor`. Both are helper commands an omo
session calls: they never decide a stage, dispatch a review, or replace an omo role. The
session owns every number it passes in and every file it writes; the scripts compute and
check.

The shapes come from the interface contract (`references/ledger.md`, `scripts/lib/schema.mjs`).
The header of a file is the ported shared columns first, then the v2 suffix, never reordered:
`MEASUREMENTS_COLUMNS + V2_MEASUREMENTS_SUFFIX` and `ROUNDS_COLUMNS + V2_ROUNDS_SUFFIX`.
`validateCsvHeader` accepts exactly those two forms, so a hand-written header cannot drift.

## 1. How the files are called

| Caller | Command | Result |
| --- | --- | --- |
| session, before CLOSE | `bun skills/wish/scripts/metrics.mjs export --ledger <ER>/ledger.jsonl [--findings <ER>/findings.tsv] [--gaps <ER>/gaps.tsv] [--extra <file>] [--out <ER>/metrics]` | writes `measurements.csv` (one row) and `rounds.csv` (one row per `round` event) |
| session, after any edit | `bun … metrics.mjs validate --dir <ER>/metrics` (or `--file <path>`) | exit 1 with `row[n].<column>` paths on a contract violation |
| M1 `wish.mjs metrics export` | `metrics.mjs export …` | the same rows, so the verb has one implementation |
| M1 `wish.mjs metrics post-merge --days N [--pr n]` | read the `merge` event (`sha`, `merged_at`) and call `metrics.mjs post-merge --merged-at <merged_at> --merge-sha <sha> --repo-dir <worktree> --days N` | the count of commits after the merge that touch the merged PR's files |
| step 8 (a monitor) | `bun … pr-watch.mjs --pr <n> --repo <owner/name> [--until merged]` | NDJSON state lines; the monitor watches stdout and stops on the terminal line |

`--merge-sha` exists because M1 cannot derive a file list from the ledger: the `merge` event
carries `sha`, `merged_at`, `pr` and `head`, nothing else. One module owns the git logic, and
it is this one; `metrics.mjs` derives the list with
`git diff-tree -z -r --no-commit-id --name-only -m --first-parent <sha>` (the `-z` form, so
every name is exactly the bytes Git stored).

The window is applied in code, not with `git log --since`: git prunes traversal on committer
dates, so a backdated descendant can hide an eligible commit. The scan uses
`--diff-merges=first-parent` (a merge shows what it introduced against its first parent) and
`-z`, so every path is the exact bytes Git stored — NUL-separated, never C-quoted, and a
leading space or a double quote is part of the name. `--files` takes those exact names too;
nothing is trimmed. The reader keeps up to 64 MiB of Git output and reports an overflow as an
error (exit 3, `overflow: true`) instead of silently cutting the history. `--max-commits`
defaults to 0 (no cap); when it is set and the scan reaches it, the command reports
`truncated: true` and exits 3 instead of claiming a clean result. A ref is any name Git
accepts without revision syntax (`release+qa` is valid; `~ ^ : ? * [ \` and whitespace are
not).

## 2. Column contract

Every column below is either **derived** from the ledger/findings/gaps input, **passed in**
(`--repo`, `--arm`, `--extra`), or **empty**. Empty means "the input does not contain this
measurement"; it is never 0, and a zero appears only when the input shows a real count of zero.

### 2.1 `measurements.csv` — one row per unit

| Column | Source | Rule |
| --- | --- | --- |
| `pr` | `pr_open` / `merge` | the PR number; required — a row without it is rejected |
| `repo`, `arm` | `--repo`, `--arm` | `arm` defaults to `v2` |
| `common_arms`, `route_class`, `size_bucket`, `stacked_on` | `--extra` | empty otherwise |
| `opened_at` | `pr_open.started_at` | ISO-8601 UTC |
| `merged_at` | `merge.merged_at` | ISO-8601 UTC |
| `open_to_merge_min` | the two above | minutes with one decimal; empty when either is absent |
| `rounds_total` | `round` events | count for the unit |
| `ultrabrain_calls` | `verdict` events | one per dispatched final review; a gate-blocked round has a `round` event and no verdict |
| `code_reviewer_calls` | `verify_lane` with `lane = code-review` | count |
| `architect_calls` | `plan_review` events + `switch` events of kind `premise` | count |
| `content_commits_after_approval` | — | empty; commits after the frozen head are a git fact the ledger does not store |
| `step12_result` | last `post_merge.verdict` | empty when the stage has not run |
| `post_merge_refix`, `blind_rereview`, `invalid_flag`, `notes` | `metrics post-merge`, the blind re-review block, the session | empty otherwise |
| `type`, `unit`, `program_id` | the ledger's own fields | `program_id` empty for a single unit |
| `switch_count` | `switch` events | count |
| `rounds_after_switch` | `round` events | count of rounds whose `round` is greater than the **first** `switch.round`; empty when `switch_count` is 0 |
| `lens_rules` | last `lens.rules_total` | empty when no lens ran |
| `gaps_total`, `gaps_fixed` | `gaps.tsv` | **defect** rows only (`kind = defect`; fixed = `status = fixed`), identical to the `progress` values of `status --json` |
| `before_receipts` | `before` events | the count of pre-edit captures in the ledger; independent of whether a register was supplied |

### 2.2 `rounds.csv` — one row per round

| Column | Source | Rule |
| --- | --- | --- |
| `pr`, `round_index` | the ledger | `round_index` is the round number, unique per PR |
| `round_kind` | `first`, `revise`, `delta`, `gate-blocked` | round 1 is `first`; a round is `gate-blocked` only while a gate opened before it is still open (a later `resolved` event for the same id closes it); `delta` is passed in `--extra` (the ledger does not record review scope) |
| `verdict_head` | `round.head` | validated with `headErrors(row.type, cell)`: 40 hex for a commit, 64 hex for a `research` artifact; a `mixed` row accepts its primary's identity form (the contract's §2 rule), so either length validates |
| `dispatch_at`, `verdict_at`, `minutes` | `round.started_at`, `round.ended_at`, `duration_s` | `started_at` is the dispatch and `ended_at` the verdict receipt; minutes come from `duration_s` or the timestamps, never estimated |
| `reviewer`, `reviewer_family` | `round.category` / `round.agent`, `round.model_family` | the role and the model family that produced the verdict |
| `defect_count`, `defect_axes` | `findings.tsv` rows of that round | count and the sorted unique `class` values joined with `;` |
| `finding_scope` | those rows' `file_line` | `test` when every path is a test path, `plan` when every path is a plan/doc path, `mixed` when both kinds appear, `prod` otherwise, `none` when no path is recorded |
| `counterexample_present` | those rows' `repro_cmd` | `1` when any row carries a command other than `no command` |
| `gate_rows_fixed`, `gate_rows_not_fixed`, `gate_rows_no_command` | the previous round's findings | the dispatch gate re-runs the prior blockers on the new head; the counts are their `status` values |
| `c2_split`, `axis_lines_present`, `verdict_line_present`, `verdict_head_match` | `--extra` | empty otherwise |
| `switch_count`, `switch_kinds` | `switch` events up to that round | cumulative; kinds joined with `;`, unique |

### 2.3 CSV dialect and value sets

The files are RFC 4180: a cell containing `,`, `"`, CR or LF is double-quoted and `"` is
doubled, and a CR inside a quoted cell is preserved verbatim (only an unquoted CR or CRLF
ends a record). Multi-valued cells join with `;`. The value sets live in `metrics.mjs`
(`ROUND_KINDS`, `FINDING_SCOPES`, `INT_COLUMNS`, `SWITCH_KINDS` from the contract) and this
table mirrors them; `test/metrics.test.js` checks the v2 column names and the terms below
against this file, so the doc and the code fail together.

`invalid_flag`, `counterexample_present`, `axis_lines_present`, `verdict_line_present` and
`verdict_head_match` are `0`, `1` or empty. Integer columns reject a leading zero and a
negative value; `open_to_merge_min` and `minutes` accept a non-negative decimal.

## 3. `pr-watch.mjs`

One NDJSON object per observation, one line per poll when `--all` is set, otherwise only when
the state or the reason set changes:

```
{"seq":1,"at":"…","pr":49,"repo":"owner/name","state":"BLOCKED","reasons":["conflict"],"head":"…","checks":{"total":3,"failing":0,"pending":1},"next_poll_s":60,"error":null}
```

States are `READY`, `WAITING`, `BLOCKED`, `MERGED`, `CLOSED`. A blocker always names its
reason: `conflict`, `checks-failing`, `changes-requested`, `blocked`, `unknown-state`,
`query-failed`. Waiting reasons: `draft`, `checks-pending`, `review-required`, `behind`,
`merge-state-unknown`.

The wait is `min(max(interval, 60) * 2^(attempt - 1), max_interval)` and the attempt count
resets to 1 whenever the state changes, so a transition is observed quickly and a quiet PR
costs at most `max_interval`. A check whose state cannot be read, and a rollup that is not an
array, count as pending — an unknown shape never becomes `READY`.

Exit codes: `0` for the requested terminal state, `1` for a different terminal state, a
`CLOSED` PR, or exhausted poll failures, `2` for a usage mistake, `3` for an auth or
not-found failure (reported once, never retried). No caller value reaches a shell: every argv
is an array and `--repo`/`--pr` are validated before `gh` is spawned. Values of `GH_TOKEN`
and `GITHUB_TOKEN` (or the names given by `--token-env`) and any `ghp_…`/`github_pat_…`
pattern are replaced by `[redacted]` in output; an empty value is never "redacted", and any
non-empty value is redacted however short it is (a short value mangles the line rather than
leaking it).

## 4. Baseline (ported from the shared ledger, 2026-10-27)

The numbers below are the #43 record, recomputed from the same CSV and stored with the ledger
in `docs/experiments/baseline-data.csv`; this file repeats only the summary a v2 judgement
needs.

| Metric | Baseline |
| --- | --- |
| merged PRs | 104 |
| open → merge median / p90 | 92.8 / 544.5 min |
| open → merge median, no final REVISE (n=62) | 51.3 min |
| open → merge median, final REVISE ≥1 (n=42) | 171.8 min |
| final review REVISE ≥1 / ≥2 | 42/104 (40.4%) / 17/104 (16.3%) |
| a delta round after approval | 8/104, median 341.7 min |
| ≥3 commits after open | 37/104, REVISE rate 75.7%, median 252.0 min |
| tail (REVISE ≥4) | 8/104 |
| rounds at the final review / all rounds | 70/92 |
| test-only REVISE rounds | 10/74 review rounds (13.5%) |

## 5. v2 targets and the round rule

A round cap is an approach switch, not an exit: a third-or-later REVISE round requires a
`switch` event, the review continues with a new approach, and it ends only at `APPROVED`
(`references/ledger.md` §9.4). The metrics therefore measure switching, not stopping.

| Metric | Target | Note |
| --- | --- | --- |
| open → merge median | ≤55 min | the v2 treatment target |
| open → merge p90 | reported, no target | the old 180-minute figure came from the removed cap and is no longer a target |
| final review REVISE ≥1 | ≤20% (accept ≤25%) | a rate of 40% or more cancels the treatment |
| blocking defects per round | ≤1.0 | baseline 2.64 |
| content commits after approval | 0 | the frozen head |
| `switch` recorded on every third-or-later REVISE round | 100% | a missing switch means the review stopped without approval, which is not an outcome |
| `rounds_after_switch` median | ≤2 | the switch must actually change the outcome |
| test-only REVISE rounds | reported separately | `rounds` rows with `finding_scope = test` and `defect_count > 0`; this is a separate report column and never changes a pre-registered cancel criterion |
| tail (≥4 rounds) | reported, no cap | review continues to `APPROVED` |

Judging order, identical to the shared ledger: (0) a quality-guard violation cancels;
(1) the row's cancel condition cancels; (2) its continue condition keeps it; (3) otherwise
cancel. A cancel and a continue condition both true: cancel wins. A row that names an
extension uses it once.

`tier`, `lanes_reused`, `sweep_findings` and the per-stage `stage_minutes` map are ledger
facts, not CSV columns: the frozen M0 header has no cell for them, so they are read from
`ledger.jsonl` and reported beside the table instead of being smuggled into `notes`.

## 6. Quality guards

1. **Blind re-review.** Every block of ten merged v2 PRs samples three at random and compares
   them with three v1 PRs from the same window. The reviewer is `category: architect` (a
   different model family from the `ultrabrain` final review) and sees only the approved diff
   and the finite contract — no receipts, no verdict, no arm name, a neutral directory name.
   The guard is "v2 defects per PR ≤ v1 defects per PR" within the block, and both numbers are
   recorded. Per type: a design unit is re-reviewed against fresh captures with a new double
   oracle, a research unit with `fact verify` plus a meaning check, an audit unit against the
   register's coverage and a spot re-run, a code unit against the diff.
2. **Post-merge refix.** `metrics.mjs post-merge` counts commits in
   `(merged_at, merged_at + days]` that touch the merged PR's files; any count above zero is a
   guard violation for that PR.
3. **Post-merge verification failures.** A `post_merge` verdict of `FAIL`, including on a
   smoke-only run, is a guard violation.
4. **Mutation kills.** Killed guards per guard row must be at least the v1 rate.
5. **Compliance.** The share of units whose required receipts all exist (the `status` gate)
   must stay at or above 90%; below that the result is recorded as a delivery failure, not as
   "no effect".
6. **Invalid samples.** A provider outage, a dead session or a rebase conflict that poisons a
   wall-clock measurement sets `invalid_flag`; that PR leaves the median and stays in the
   denominator of every rate.

A program's **first** run is diagnostic only: it has no control group, so its rows are
recorded and read, never judged against the targets above. Judgement starts with the second
program.