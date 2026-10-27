---
name: wish
description: "Runs one user-authorized /wish request end to end on top of omo, for code, design, research and audit: tier triage, an optional lens and gap register, one linted plan with a single plan review, a goal-bound mass-ulw build, one verify wave of independent lanes at one head, triage and fix, a frozen PR, a final review that runs until APPROVED, merge, post-merge verification and cleanup. Use when the /wish command or the user names this skill."
metadata:
  short-description: Authorized-request flow on omo, intake to merged evidence
---

# wish

One `/wish` invocation is one authorized request plus authorization to plan, build, verify, open a PR, review to APPROVED, merge and clean up, without asking again for phases the request covers. This file is the contract and the stage map; the playbook for the work type holds the runnable steps, and `references/` holds the machine shapes.

wish v2 runs **on top of omo**. Every stage is executed by an omo feature — a category, a native agent, `mass-ulw`, `ulw-loop`, `ulw-plan`, a monitor — and never by a replacement for one. The scripts under `scripts/` are helper commands those roles call: they lint a plan, run probes, check a verdict, compare patches and generate state. No omo role is re-implemented here.

Speed comes from moving work earlier, never from reviewing less: the same final review, the same lanes, the same blocker definition — one head instead of a serial chain, and a gap register built before the plan instead of rediscovered every round. Review quality is a floor, not a variable.

Resolve every path relative to this file's directory. `/wish` arms ultrawork: never re-arm, reset or disarm it, and open no goal or notepad at bootstrap — the plan file holds the notes until `goal` registers one goal per unit through ulw-loop. A genuine owner decision (irreversible, destructive, a spend, or a contract-level LIMIT to accept) is asked through the question tool and parked in `gates.md`; nothing else is a question.

## Stages — the omo feature that runs each one

`wish.mjs status` names the only stage you may dispatch and the receipt blocking it; dispatch nothing else. `<ER>` is `agentToolkit.status().result.evidenceRoot`, outside the repository.

| # | stage | omo feature that runs it | receipt `status` requires |
| --- | --- | --- | --- |
| 0 | `intake` | ultrawork tier triage by the session; `todo` carries the playbook steps | `intake` event with `tier` and `facts` (`wish.mjs init`) |
| 1 | `lens` | `mass-ulw` run `wish-<run>-lens`: harvest → extract → reduce nodes | `lens` event + `<ER>/lens.md`; `skip: no corpus` otherwise |
| 2 | `discover` | `explore` 2–4 read-only lanes ∥ `librarian` for outside sources | `discover` event + `receipts/discover-<lane>.md` |
| 3 | `ideal` | session, seeded first from the `visual-qa` checklist and the `frontend` rules | `ideal` event + `<ER>/ideal.md` |
| 4 | `gap` | session merges the lanes: `remove-ai-slops` report-only lane, `frontend` draft-guard lint | `gap` events + `<ER>/gaps.tsv`, each defect row written once with its pre-edit capture |
| 5 | `before` | session records the captures; a read-only lane may drive the capture matrix | `before` event + `receipts/before-<gap>-<tree7>.*` via ulw-loop `recordEvidence` |
| 6 | `plan` | session writes it in ulw-plan's checkbox grammar | `plan` event (artifact = the plan) |
| 7 | `plan_lint` | `scripts/check-plan.mjs` from the session or a `quick` node | `plan_lint` event, exit 0 |
| 8 | `plan_review` | `category: architect` once; `plan-reviewer` only when the plan gate is open | `receipts/plan_review-architect-<head7>.md`, `OKAY` or blockers each with a fix |
| 9 | `goal` | `ulw-loop` goals; ulw-execute Boulder state as format only | `goal` event carrying the goal id |
| 10 | `build` | `mass-ulw` run `wish-<run>-build`; the commit node loads `git-master` | `build` events + `receipts/build-<node>.json` |
| 11 | `verify_lane` | one `task` batch at one head: `quick` tests+mutation, `omo-native-qa-executor`, `quick` sweep probes, `omo-native-code-reviewer` (+`remove-ai-slops`, `programming`), `deep-high` adversarial | one `verify_lane-<lane>-<head7>.json` per lane the type requires |
| 12 | `triage` | session, bugbot trichotomy: fix, dismiss, ask | `triage` event + `findings.tsv` rows |
| 13 | `fix` | `mass-ulw` run `wish-<run>-fix-r<n>`; `reuse-check.mjs` re-runs only stale lanes | `fix` + `reuse` events |
| 14 | `freeze` | `wish.mjs freeze`, then `wish.mjs pr-body` | `freeze` event: `head`, `tree`, `pr` |
| 15 | `pr_open` | `gh pr create` with the generated body; `tool.monitor` on `pr-watch.mjs` | `pr_open` event |
| 16 | `round` | `wish.mjs gate`, then `category: ultrabrain` (r1 full, r2+ delta+regression), then `check-verdict.mjs` | `receipts/final-r<n>-<head7>.md` + `round`, `verdict` events |
| — | `switch` | `architect` premise review, `deep-high` family switch, a `SWITCH:` plan row, or rediscover | `switch` event: `round`, `kind`, `premise`, `new_approach` |
| 17 | `merge` | session merges; `wish.mjs status --json` reports the state | `merge` event: `sha`, `merged_at`, `pr` |
| 18 | `post_merge` | `omo-native-qa-executor`: smoke when the tree is identical, full otherwise | `post_merge` event + `receipts/post_merge-<tree7>.*` |
| 19 | `checkpoint` | `ulw-loop` `agentToolkit.checkpoint`; `omo-native-gate-reviewer` reads the evidence record | `checkpoint` event, `op: complete` |
| 20 | `cleanup` | session: `metrics export`, then `memory` for the classes and QA invocations it caught | `cleanup` event with at least one teardown receipt |

`lens`, `ideal`, `gap`, `before`, `fix` and `switch` are conditional: when one truly does not apply, its step stays in the todo with `skip: <reason>`, never silently dropped.

## Tiers — same depth, different waiting

| Tier | Decided by omo's LIGHT/HEAVY facts | What changes; the review depth does not |
| --- | --- | --- |
| **S** | ≤2 files and ≤150 lines by the discover estimate, and no HEAVY fact | one explore lane; a short plan; PLAN-REVIEW starts in parallel with BUILD and a blocker `amend`s the run; mutation at most one per guard row |
| **M** | more than S, ≤1 HEAVY fact, ≤3 components | every stage serial by default; the full verify wave |
| **L** | ≥2 HEAVY facts, ≥4 components, or the requester asked for thoroughness | M plus the `adversarial` lane without a high-risk row, the state/lifetime transition table run in QA, and the mutation cap |

A tier is never lowered: a HEAVY fact found mid-run raises it at once. `status` adds the `adversarial` lane for every L unit, and below L only when a `HIGH-RISK` plan row is recorded.

## Work types

| Type | Playbook | The lanes `status` requires |
| --- | --- | --- |
| `code` | `playbooks/code.md` (patch, feature, refactor) | `tests`, `qa`, `sweep`, `code-review`, plus `adversarial` |
| `design` | `playbooks/design.md` | `draft-guard`, `capture`, `vqa-passA`, `vqa-passB`, `code-review`, `qa` |
| `research` | `playbooks/research.md` | `fact-verify`, `claim-gate`, `skeptic`, `execution-verify`, `delivery-gate` |
| `audit` | `playbooks/audit.md` | `lint`, `spot`, `register-schema` |
| `mixed` | the primary type's playbook | the union of the primary's and the secondary's lanes |

The primary type owns the deliverable and the end condition; the secondary adds lanes and dictionary entries. A program (one request, several units, one PR each) adds `playbooks/program.md`.

## The round rule — a cap is a switch, never an exit

Review has no round ceiling. `APPROVED` is the only end.

1. Two consecutive REVISE rounds on the same component **or** the same defect class stop the patch loop and force one `architect` premise review of the assumption every failed fix shared.
2. A **third-or-later** REVISE round forces an approach switch, and every REVISE after it uses one more kind it has not used yet: `premise`, `family` (a fix node from a model family other than the failed fix's), `strategy` (a `SWITCH:` plan row that redesigns the component), `split` (program mode only: the failing component becomes its own unit), `rediscover` (lens-guided DISCOVER plus a variant sweep).
3. After the switch: fix run, `reuse-check`, the stale lanes only, `freeze`, the gate table, then a fresh ultrabrain reviewer on the delta plus the prior findings that must now fail to reproduce.
4. The owner is never asked whether to keep reviewing. The owner is asked only for a decision that is theirs — and while a gate is open, other units keep running.

`references/contract.md` §6 and `references/ledger.md` §9.4 are the binding statements; `playbooks/revise.md` runs them.

## The finite contract — what may block

The plan's `IS` and `COMPANION` rows are the request, its `INVARIANT` rows are what must keep holding, and its `LIMIT` rows are what it knowingly does not handle. Only a row not delivered or a listed invariant shown violated by a failing test (or, for a `no-test` row, its failing QA scenario) blocks. Everything else is a note or a follow-up, and every reviewer prompt carries the verbatim rule of `references/contract.md` §5. `WARN` never blocks; a `FAIL` receipt is a claim the session reproduces before it becomes a blocking finding. A unit's contract is that unit's `IS` rows only. PLAN-REVIEW judges the contract itself: it is the one place a hole can be caught.

## Evidence, state, and what scripts may not do

The session alone writes the plan, `ledger.jsonl`, `findings.tsv`, `gaps.tsv`, `lens.md`, `ideal.md`, `gates.md` and `resume.md`; a lane writes only its own receipt; a script validates and computes and authors nothing. Evidence lives under `<ER>`, never in the repository, so evidence never moves a reviewed head. A receipt is valid while its `tree` matches (a research unit's 64-hex artifact sha256 replaces both head and tree); a verdict is valid while its `patch_id` matches; `reuse-check` decides which lanes a fix invalidated, and a `before` capture is never stale. Nothing commits after the freeze: a memo goes to `<ER>`, never to the branch.

`playbooks/revise.md` and `playbooks/resume.md` are the two paths that leave the linear stage list. Every reviewer lane runs under `review-work`'s rules: a locked read-only review worktree, a QA row that names its artifact, and a new reviewer for each re-review rather than the same child continued.

## Playbooks

| Playbook | When |
| --- | --- |
| `playbooks/code.md` | code work: a patch, a feature, a refactor (a characterization test comes first) |
| `playbooks/design.md` | rendered surfaces: `frontend` builds, `visual-qa`'s two passes verify |
| `playbooks/research.md` | investigation; `ulw-research` runs the phases and wish adds the contract |
| `playbooks/audit.md` | a complete register and a report, with no BUILD |
| `playbooks/program.md` | one request, several units, several PRs |
| `playbooks/lens.md` | reading a corpus into judgment rules |
| `playbooks/revise.md` | a REVISE round, the switch rule, and the return path |
| `playbooks/resume.md` | after a death, a compaction, or `/wish --resume <run_id>` |

## References

| Reference | Holds |
| --- | --- |
| `references/contract.md` | the finite contract, companion guards, PLAN-REVIEW, the verbatim reviewer rule |
| `references/plan-format.md` | the plan grammar, `DEVICE:` rows per type, and the linter's rule list |
| `references/ledger.md` | every machine shape: receipts, ledger events, findings, gaps, `wish status --json`, the CLI |
| `references/prompts.md` | every delegation prompt, with the frame and its TIMEBOX and FORBIDDEN fields |
| `references/defect-classes.md` | the class dictionary per type, the probes, and the review axes |
| `references/metrics.md` | the measurement columns, `pr-watch`, the targets and the quality guards |

## Finish

Stop when the request's register is closed (every `defect` row `fixed`, `accepted-limit` or `out-of-scope`), every unit's PR is merged with `post_merge` recorded, `checkpoint` completed, the worktrees and branches removed with a teardown receipt, and the final report delivered with its evidence paths, limits and out-of-scope findings. Answer in the user's language; agent prompts stay in English.