---
name: wish
description: "Runs one authorized /wish request end to end on omo for code, design, research and audit: triage, one linted plan with a single review, a mass-ulw build, one verify wave, fix, frozen PR, review to APPROVED, merge, cleanup. Use when the /wish command or the user names this skill."
metadata:
  short-description: Authorized-request flow on omo, intake to merged evidence
---

# wish

One `/wish` invocation is one authorized request plus authorization to plan, build, verify, open a PR, review to APPROVED, merge and clean up without asking again for phases the request covers. This file is the contract and the stage map; the work type's playbook holds the runnable steps, and `references/` holds the machine shapes.

wish v2 runs **on top of omo**. Every stage is executed by an omo feature — a category, a native agent, `mass-ulw`, `ulw-loop`, `ulw-plan`, a monitor — never by a replacement for one. The scripts under `scripts/` are helpers those roles call: they lint a plan, run probes, check a verdict and generate state.

Speed comes from moving work earlier, never from reviewing less: the same final review, the same lanes, the same blocker definition — one head instead of a serial chain, and a register built before the plan instead of rediscovered every round. Review quality is a floor, not a variable.

Resolve every path relative to this file's directory. `/wish` arms ultrawork: never re-arm, reset or disarm it, and open no goal or notepad at bootstrap — the plan file holds the notes until `goal` registers one goal per unit through ulw-loop. A genuine owner decision (irreversible, destructive, a spend, or a contract-level LIMIT) is asked through the question tool and parked in `gates.md`; nothing else is a question.

## Stages — the omo feature that runs each one

`wish status` names the next stage and the receipt blocking it; tier S may start PLAN-REVIEW with BUILD, and a program registers GOAL before PLAN. `<ER>` is `agentToolkit.status().result.evidenceRoot`, outside the repository.

| # | stage | omo feature that runs it | receipt `status` requires |
| --- | --- | --- | --- |
| 0 | `intake` | ultrawork tier triage; `todo` carries the playbook steps | `intake` event (`wish.mjs init`) |
| 1 | `lens` | `mass-ulw` run `wish-<run>-lens`: harvest → extract → reduce nodes | `lens` event + `<ER>/lens.md`; `skip: no corpus` otherwise |
| 2 | `discover` | `explore` 2–4 read-only lanes ∥ `librarian` for outside sources | `discover` event + `receipts/discover-<lane>.md` |
| 3 | `ideal` | session, seeded from the `visual-qa` checklist and `frontend` rules | `ideal` event + `<ER>/ideal.md` |
| 4 | `gap` | session merges the lanes: `remove-ai-slops` report-only, `frontend` draft-guard lint | `gap` events + `<ER>/gaps.tsv`, each defect row written once with its capture |
| 5 | `before` | session records the captures; a read-only lane may drive them | `before` event + `receipts/before-<gap>-<tree7>.*` via ulw-loop `recordEvidence` |
| 6 | `plan` | session writes it in ulw-plan's checkbox grammar | `plan` event (artifact = the plan) |
| 7 | `plan_lint` | `scripts/check-plan.mjs` from the session or a `quick` node | `plan_lint` event, exit 0 |
| 8 | `plan_review` | `category: architect` once; `plan-reviewer` only when the plan gate is open | `plan_review-architect-<head7>.md`, `OKAY` or blockers each with a fix |
| 9 | `goal` | `ulw-loop` goals; ulw-execute Boulder state as format only | `goal` event carrying the goal id |
| 10 | `build` | `mass-ulw` run `wish-<run>-build`; the commit node loads `git-master` | `build` events + `receipts/build-<node>.json` |
| 11 | `verify_lane` | one `task` batch at one head: `quick` tests+mutation and sweep, `omo-native-qa-executor`, `omo-native-code-reviewer` (+`remove-ai-slops`, `programming`), `deep-high` adversarial | `verify_lane-<lane>-<head7>.json` per required lane |
| 12 | `triage` | session | `triage` event + `findings.tsv` rows |
| 13 | `fix` | `mass-ulw` run `wish-<run>-fix-r<n>`; `reuse-check.mjs` re-runs only stale lanes | `fix` + `reuse` events |
| 14 | `freeze` | `wish.mjs freeze`, then `wish.mjs pr-body` | `freeze` event: `head`, `tree`, `pr` |
| 15 | `pr_open` | `gh pr create` with the generated body; `tool.monitor` on `pr-watch.mjs` | `pr_open` event |
| 16 | `round` | `wish.mjs gate`, then `category: ultrabrain` (r1 full, r2+ delta+regression), then `check-verdict.mjs` | `final-r<n>-<head7>.md` + `round`, `verdict` events |
| — | `switch` | `architect` premise review, `deep-high` family switch, a `SWITCH:` plan row, or rediscover | `switch` event: `round`, `kind`, `premise`, `new_approach` |
| 17 | `merge` | session merges; `wish status --json` reports it | `merge` event: `sha`, `merged_at`, `pr` |
| 18 | `post_merge` | `omo-native-qa-executor`: smoke when the tree is identical, full otherwise | `post_merge` event + `post_merge-<tree7>.*` |
| 19 | `checkpoint` | `ulw-loop` `agentToolkit.checkpoint`; `omo-native-gate-reviewer` reads the evidence record | `checkpoint` event, `checkpoint_op: complete` |
| 20 | `cleanup` | session: `metrics export`, then `memory` for the classes it caught | `cleanup` event with at least one teardown receipt |

`lens`, `ideal`, `gap`, `before`, `fix` and `switch` are conditional: when one truly does not apply, its step stays in the todo with `skip: <reason>`, never silently dropped. While any unit runs, print `wish status --progress` on every transition that changes a number and at least every 30 minutes (`report.interval`); a repeat with no change is suppressed.

## Tiers — same depth, different waiting

| Tier | Decided by omo's LIGHT/HEAVY facts | What changes; the review depth does not |
| --- | --- | --- |
| **S** | ≤2 files and ≤150 lines by the discover estimate, and no HEAVY fact | one explore lane; a short plan; PLAN-REVIEW starts with BUILD and a blocker `amend`s the run; mutation at most one per guard row |
| **M** | more than S, ≤1 HEAVY fact, ≤3 components | every stage serial by default; the full verify wave |
| **L** | ≥2 HEAVY facts, ≥4 components, or the requester asked for thoroughness | M plus the `adversarial` lane without a high-risk row, the state/lifetime transition table run in QA, and the mutation cap |

A tier is never lowered: a HEAVY fact found mid-run raises it at once. `status` adds the `adversarial` lane for every L unit, and below L only for a `HIGH-RISK` plan row.

## Work types

| Type | Playbook | The lanes `status` requires |
| --- | --- | --- |
| `code` | `playbooks/code.md` (patch, feature, refactor) | `tests`, `qa`, `sweep`, `code-review`, plus `adversarial` |
| `design` | `playbooks/design.md` | `draft-guard`, `capture`, `vqa-passA`, `vqa-passB`, `code-review`, `qa` |
| `research` | `playbooks/research.md` | `fact-verify`, `claim-gate`, `skeptic`, `execution-verify`, `delivery-gate` |
| `audit` | `playbooks/audit.md` | `lint`, `spot`, `register-schema` |
| `mixed` | the primary type's playbook | the primary's and secondary's lanes united; `wish init` and `sweep.mjs` take `--type mixed --primary … --secondary …` |

The primary type owns the deliverable and the end condition; the secondary adds lanes and dictionary entries. A program (one request, several units, one PR each) adds `playbooks/program.md`.
## The round rule — a cap is a switch, never an exit

Review has no round ceiling. `APPROVED` is the only end.

1. Two consecutive REVISE rounds on the same component **or** the same defect class stop the patch loop and force one `architect` premise review of the assumption the failed fixes shared.
2. A **third-or-later** REVISE round forces an approach switch, and every REVISE after it uses one more kind it has not used yet: `premise`, `family` (a model family other than the failed fix's), `strategy` (a `SWITCH:` row that redesigns the component), `split` (program only), `rediscover` — meanings in `references/ledger.md` §9.4.
3. After the switch: fix run, `reuse-check`, stale lanes only, `freeze`, the gate table, then a fresh ultrabrain reviewer on the delta plus the prior findings that must not reproduce.
4. The owner is never asked whether to keep reviewing; only for a decision that is theirs — and while a gate is open, other units keep running.

`references/contract.md` §6 and `references/ledger.md` §9.4 are the binding statements; `playbooks/revise.md` runs them.

## The finite contract — what may block

The plan's `IS` and `COMPANION` rows are the request, its `INVARIANT` rows what must keep holding, its `LIMIT` rows what it knowingly does not handle. Only a row not delivered or a listed invariant shown violated by a failing test (or a `no-test` row's failing QA scenario) blocks; everything else is a note or a follow-up, and every reviewer prompt carries the verbatim rule of `references/contract.md` §5. `WARN` never blocks; a `FAIL` receipt is a claim the session reproduces first. A unit's contract is its own `IS` rows; PLAN-REVIEW is where a hole in it is caught.

## Evidence, state, and what scripts may not do

The session alone writes the plan, `ledger.jsonl`, `findings.tsv`, `gaps.tsv`, `lens.md`, `ideal.md`, `gates.md` and `resume.md`; a lane writes only its own receipt; a script validates and computes and authors nothing. Evidence lives under `<ER>`, never in the repository, so evidence never moves a reviewed head. A receipt is valid while its `tree` matches (a research unit's 64-hex sha256 is its `head` and its `tree` is `null`), a verdict while its `patch_id` matches; `reuse-check` names the lanes a fix invalidated, and a `before` capture is never stale. Nothing commits after the freeze: a memo goes to `<ER>`, never the branch.

`playbooks/revise.md` and `playbooks/resume.md` are the two paths that leave the linear stage list. Every reviewer lane runs under `review-work`'s rules: a locked read-only review worktree, a QA row that names its artifact, and a new reviewer for each re-review rather than the same child continued.

## Playbooks

| Playbook | When |
| --- | --- |
| `playbooks/code.md` | code work: a patch, a feature, a refactor (a characterization test comes first) |
| `playbooks/design.md` | rendered surfaces: `frontend` builds, `visual-qa` verifies |
| `playbooks/research.md` | investigation; `ulw-research` runs the phases and wish adds the contract |
| `playbooks/audit.md` | a complete register and report, no BUILD |
| `playbooks/program.md` | one request, several units and PRs |
| `playbooks/lens.md` | a corpus read into judgment rules |
| `playbooks/revise.md` | a REVISE round, the switch rule, and the return path |
| `playbooks/resume.md` | after a death, a compaction, or `--resume <run_id>` |

## References

| Reference | Holds |
| --- | --- |
| `references/contract.md` | the finite contract, companion guards, PLAN-REVIEW, the reviewer rule |
| `references/plan-format.md` | the plan grammar, `DEVICE:` rows per type, the linter's rules |
| `references/ledger.md` | every machine shape: receipts, events, findings, gaps, `wish status --json`, CLI |
| `references/prompts.md` | every delegation prompt with its frame, TIMEBOX and FORBIDDEN |
| `references/defect-classes.md` | the class dictionary per type, the probes, and the review axes |
| `references/metrics.md` | the measurement columns, `pr-watch`, the targets and the quality guards |

## Finish

Stop when the register is closed (every `defect` row `fixed`, `accepted-limit` or `out-of-scope`), every unit's PR is merged with `post_merge` recorded, `checkpoint` completed, worktrees and branches removed with a teardown receipt, and the final report delivered with evidence, limits and out-of-scope findings. Answer in the user's language; prompts stay in English.