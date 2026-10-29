---
name: wish
description: "Runs one authorized /wish request end to end on omo: collection, definition, one reviewed plan, a goal-bound multi-PR build, verification in order, review to APPROVED, merge, cleanup. Use when the /wish command or the user names this skill."
metadata:
  short-description: Authorized-request flow on omo, definition to merged evidence
---

# wish

One `/wish` invocation is one authorized request plus authorization to collect, define, plan, build, verify,
open PRs, review to APPROVED, merge and clean up without asking again for phases the request covers. This file is
the contract and the stage map; the work type's playbook holds the runnable steps, and `references/` holds the
machine shapes.

wish runs **on top of omo**. Every stage is executed by an omo feature — a category, a native agent, `mass-ulw`,
`ulw-loop`, `ulw-plan`'s grammar, a monitor — never by a replacement for one. The scripts under `scripts/` are
helpers those roles call: they lint a plan, run probes, check a verdict and derive state.

Speed comes from moving work earlier, never from reviewing less: the same review, the same lanes, the same
blocker definition. Review quality is a floor, not a variable.

Resolve every path relative to this file's directory. `/wish` arms ultrawork: never re-arm, reset or disarm it,
and open no goal or notepad at bootstrap; the plan file holds the notes until `goal` registers one goal per unit
through ulw-loop. Decisions are asked once, at `decide`, as one batch with a recommended default each; after that
nothing is asked, and a decision that appears mid-run parks only its own lane while every other lane continues.

## Stages — the omo feature that runs each one

`wish status` names the next stage and the receipt blocking it. `<ER>` is the ulw-loop evidenceRoot, outside the
repository on purpose: evidence never costs a commit and never moves a reviewed head. The plan lives at
`.omo/plans/wish-<slug>.md` in ulw-plan's checkbox grammar, because that is the location and the shape
`ulw-execute` selects as its plan; a plan in another place or another shape is a defect, not a preference.

| # | stage | omo feature that runs it | receipt `status` requires |
| --- | --- | --- | --- |
| 0 | `intake` | ultrawork tier triage; `todo` carries the playbook steps | `intake` event (`wish.mjs init`, which creates the plan: never pre-create it) |
| 1 | `collect` | one `mass-ulw` run `wish-<run>-collect`: harvest, extract, explore | `collect` event + `<ER>/collect.md` |
| 2 | `define` | session, seeded by the collect report | `define` event + `<ER>/define.md` + the difference rows in `<ER>/gaps.tsv` |
| 3 | `before` | session records one capture per defect row | `before` event + `before-<gap>-<tree7>.*`, captured before the first edit |
| 4 | `plan` | session writes it in ulw-plan's checkbox grammar | `plan` event (the plan) |
| 5 | `plan_lint` | `check-plan.mjs`, from the session or a `quick` node | `plan_lint` event, exit 0; `--register` only when `define` wrote a register |
| 6 | `plan_review` | `category: architect` once, plus `plan-reviewer` only in the ulw-plan branch below | `plan_review-architect-<head7>.md`, `OKAY` or blockers each with a fix |
| 7 | `decide` | session collects the decision batch | `decide` event + `<ER>/gates.md` entries with a recommended default |
| 8 | `goal` | `ulw-loop` goals; ulw-execute Boulder state as format only | `goal` event with the goal id |
| 9 | `build` | `mass-ulw` run `wish-<run>-build`, one PR per unit; the commit node loads `git-master` | `build` events + `build-<node>.json` |
| 10 | `verify_lane` | one `task` batch per head: `quick` tests and mutation, `omo-native-qa-executor`, `omo-native-code-reviewer`, `deep-high` adversarial | `verify_lane-<lane>-<head7>.json` per required lane |
| 11 | `triage` | session | `triage` event + `findings.tsv` rows |
| 12 | `fix` | `mass-ulw` run `wish-<run>-fix-r<n>`; `reuse-check.mjs` re-runs stale lanes | `fix` + `reuse` events |
| 13 | `freeze` | `wish freeze`, then `wish pr-body` | `freeze` event: `head`, `tree`, `pr` |
| 14 | `pr_open` | `gh pr create` with the generated body; `tool.monitor` on `pr-watch.mjs` | `pr_open` event |
| 15 | `round` | `wish.mjs gate`, then `category: ultrabrain` (r1 full, r2+ delta), then `check-verdict.mjs` | `final-r<n>-<head7>.md` + `round`, `verdict` events |
| — | `switch` | `architect` premise review, `deep-high` family switch, a `SWITCH:` plan row, or rediscover | `switch` event: `round`, `kind`, `premise`, `new_approach` |
| 16 | `merge` | session merges; `wish status --json` reports it | `merge` event: `sha`, `merged_at`, `pr` |
| 17 | `post_merge` | `omo-native-qa-executor`: smoke when the tree is identical, full otherwise | `post_merge` event + `post_merge-<tree7>.*` |
| 18 | `checkpoint` | `ulw-loop` `agentToolkit.checkpoint`; `omo-native-gate-reviewer` reads the evidence record | `checkpoint` event, `checkpoint_op: complete` |
| 19 | `cleanup` | session: `metrics export`, then `memory` for the classes it caught | `cleanup` event with at least one teardown receipt |

`before` and `fix` are conditional: when one truly does not apply, its step stays in the todo with
`skip: <reason>`, never silently dropped. While any unit runs, print the `PROGRESS:` line on every transition
that changes a number and at least every 30 minutes (`report.interval`); a repeat with no change is suppressed.

### The two plan branches

The default branch is the one that always exists: the session writes the plan to fit ulw-plan — its checkbox
grammar, `.omo/plans/<slug>.md` — and ONE `category: architect` review checks it. There is no approval question
to the requester, and the run continues straight to `decide` and `goal`.

The other branch opens only when the requester's own message asked for the ulw-plan workflow in their words:
then ulw-plan runs as a whole, with its approval gate, and its `plan-reviewer` agent becomes spawnable. In that
branch the plan gets BOTH reviews — `plan-reviewer` and the one `category: architect` review — and no third round
is added. `plan-reviewer` cannot be spawned because a skill's text says so: the host refuses it outside that
branch, so nothing here may depend on it. The plan's author is the planning role the run has, the reviewer is the
role `plan_review` names, and a host that offers neither leaves the review with the session, which records that
in the plan's review record.

## COLLECT, DEFINE, PLAN: the order that makes the rest honest

**COLLECT** is one `mass-ulw` run with three node families. `harvest` reads every source the request names, in
full, and every source the repository points at; `extract` reduces the harvest to the important elements, one row
each with its locator; `explore` reads from the viewpoint of the project the request serves — its domain, its
users, its constraints — and answers what the harvest raised, spawning `explore` lanes for the repository and a
`librarian` for outside sources, over-collecting on purpose. The run writes `<ER>/collect.md`, and a source that
could not be read is named as unread, never omitted.

**DEFINE** runs before any plan and states, in `<ER>/define.md`: the end user the result touches, how they use it
today and after; the ideal state as rows, each with its reason; every difference between today and that state,
each with its reason and its affected party. Those differences are the register, so the plan closes each one.
Apply the boundary exactly (`references/contract.md` §3): the request's `IS` and `COMPANION` rows are in scope,
everything else is out of scope — recorded in `<ER>/follow-ups.md` and named in the final report, never fixed
here. DEFINE writes no plan, no unit split and no test plan.

**PLAN** starts by reading the related skills and their references — `remove-ai-slops`, `frontend`,
`programming`, and the work type's own skill — and the plan-writing step then carries the required sentences and
the no-test path of `references/plan-format.md` §3, quoted there verbatim: the confirmation device for the
implementation, the confirmation device for the fix, and the visual-QA verification sentence for any plan with a
rendered surface or a visual QA scenario. Do not force test code. The confirmation device takes that role: a
repository that keeps tests for the behaviour runs them, a guard row gets its mutation, and a behaviour this
repository cannot test carries a `qa` device and a `no-test` row that names it.

**DECIDE** gathers every decision the requester owns into one batch in `<ER>/gates.md`, each with a recommended
default and one line of reasoning, and asks once. A decision that appears mid-run parks only the lane that needs
it (`parked` on its `gate` event) and appears in the `PROGRESS:` line; every other lane continues.

## Units: one request, one or more PRs

A request that holds more than one independently verifiable unit becomes **one PR per unit**: each unit owns a
disjoint write scope, its own branch and worktree, several commits inside it, and its own `## Before` and
`## After` in the PR body, so the improvement is visible without reading the diff. A request with one unit stays
one PR. The split is decided at `plan`, never mid-build; `playbooks/program.md` holds the whole-request rules and
a unit's contract is its own `IS` rows.

## Execution

After `decide`, the run does not ask again. It proceeds at maximum parallelism — every independent unit and every
independent lane in flight at once, up to the host's slots, with named dependencies as the only serialization —
and every lane verifies its own work strictly rather than trusting a green run of something else. It reports at
every milestone with the `PROGRESS:` line, which states how much of the whole is done, which PRs are merged and
open, and what the run waits on; a report that repeats unchanged numbers is suppressed. A lane that parks on an
open decision does not stop the others.

## Tiers — same depth, different waiting

| Tier | Decided by omo's LIGHT/HEAVY facts | What changes; the review depth does not |
| --- | --- | --- |
| **S** | ≤2 files and ≤150 lines by the collect estimate, and no HEAVY fact | one `explore` node; a short define; a short plan; `plan_review` may start with `build` and a blocker `amend`s the run; mutation at most one per guard row |
| **M** | more than S, ≤1 HEAVY fact, ≤3 components | every stage serial by default; the full verify wave |
| **L** | ≥2 HEAVY facts, ≥4 components, or the requester asked for thoroughness | M plus the `adversarial` lane without a high-risk row, the state and lifetime transition table run in QA, and the mutation cap |

A tier is never lowered: a HEAVY fact found mid-run raises it at once. `status` adds the `adversarial` lane for
every L unit, and below L only for a `HIGH-RISK` plan row.

## Work types

| Type | Playbook | The lanes `status` requires |
| --- | --- | --- |
| `code` | `playbooks/code.md` (patch, feature, refactor) | `tests`, `qa`, `sweep`, `code-review`, plus `adversarial` |
| `design` | `playbooks/design.md` | `draft-guard`, `capture`, `vqa-passA`, `vqa-passB`, `code-review`, `qa` |
| `research` | `playbooks/research.md` | `fact-verify`, `claim-gate`, `skeptic`, `execution-verify`, `delivery-gate` |
| `audit` | `playbooks/audit.md` | `lint`, `spot`, `register-schema` |
| `mixed` | the primary type's playbook | the primary's and secondary's lanes united; `wish init` and `sweep.mjs` take `--type mixed --primary … --secondary …` |

## Reviews, in the one order that holds

`triage`, `fix`, `freeze`, `pr_open` and `round` are one sequence, and the order is mechanical rather than
advisory: `freeze` binds the head and the tree, and `round` refuses to run unless a valid `code-review` receipt
exists **at the frozen head** — the refusal is a refused ledger event and a refused dispatch gate (exit 3), not a
reminder. The gate applies to a type whose required lanes name `code-review`; a `research` or `audit` unit never
carries that lane and is never gated on it. A verdict is valid only for the head it reviewed, so the two reviews
are never dispatched in the same wave.

The head is frozen for the whole round: a fix lands only after the verdict and opens the next round — `define`
for the cited problem, `plan`, `plan_lint`, the fix, a fresh `freeze`, the gate and a new reviewer. A head that
moves while a round is in flight is not the head the verdict covers, so a head change during a round is a
re-review, never a carried verdict, and the gate holds the freeze to it: when the observed head is not the frozen
head, `wish gate --round` refuses with exit 3 and `the head moved after the freeze`.

On `VERDICT: REVISE` the flow returns to `define` for the cited problem — DEFINE again for that problem, then
`plan` and `plan_lint` for it, then the fix lane and the same verify wave — and the fix commits are appended to
the same PR, never opened as a second one.

## The round rule — a cap is a switch, never an exit

Review has no round ceiling. `APPROVED` is the only end.

1. Two consecutive REVISE rounds on the same component **or** the same defect class stop the patch loop and force
   one `architect` premise review of the assumption the failed fixes shared.
2. A **third-or-later** REVISE round forces an approach switch, and every REVISE after it uses one more kind it
   has not used yet: `premise`, `family`, `strategy`, `split` (program only), `rediscover` — meanings in
   `references/ledger.md` §9.4.
3. After the switch: fix run, `reuse-check`, stale lanes only, `freeze`, the gate table, then a fresh ultrabrain
   reviewer on the delta and the prior findings.
4. The requester is never asked whether to keep reviewing: the decision batch closed at `decide`, and a parked
   lane never stops another lane.

`references/contract.md` §6 and `references/ledger.md` §9.4 are the binding statements; `playbooks/revise.md`
runs them.

## The finite contract — what may block

The plan's `IS` and `COMPANION` rows are the request, `INVARIANT` what must keep holding, `LIMIT` what is
knowingly not handled. Only a row not delivered or a listed invariant shown violated by a failing test (or a
`no-test` row's failing QA) blocks; everything else is a note, and every reviewer prompt carries the verbatim
rule of `references/contract.md` §5. `WARN` never blocks; a `FAIL` receipt is a claim the session reproduces
first.

## Evidence, state, and what scripts may not do

The session alone writes the plan, `ledger.jsonl`, `findings.tsv`, `gaps.tsv`, `collect.md`, `define.md`,
`gates.md` and `resume.md`; a lane writes only its own receipt; a script authors nothing. A receipt is valid while
its `tree` matches (a research unit's 64-hex sha256 is its `head` and its `tree` is `null`), a verdict while its
`patch_id` matches; `reuse-check` names the lanes a fix invalidated, and a `before` capture is never stale.
Nothing commits after the freeze: a memo goes to `<ER>`, never the branch.

`playbooks/revise.md` and `playbooks/resume.md` are the two paths that leave the linear stage list. Every reviewer
lane runs under `review-work`'s rules: a locked read-only review worktree, a QA row that names its artifact, and a
new reviewer for each re-review rather than the same child continued.

## Playbooks and references

| Playbook | When |
| --- | --- |
| `playbooks/code.md` | code work: a patch, a feature, a refactor |
| `playbooks/design.md` | rendered surfaces: `frontend` builds, `visual-qa` verifies |
| `playbooks/research.md` | investigation; `ulw-research` runs the phases and wish adds the contract |
| `playbooks/audit.md` | a complete register and report, no BUILD |
| `playbooks/program.md` | one request, several units and PRs |
| `playbooks/lens.md` | a corpus read into judgment rules, run as a COLLECT node |
| `playbooks/revise.md` | a REVISE round, the switch rule, and the return path |
| `playbooks/resume.md` | after a death, a compaction, or `--resume <run_id>` |

| Reference | Holds |
| --- | --- |
| `references/contract.md` | the finite contract, companion guards, PLAN-REVIEW, the reviewer rule |
| `references/plan-format.md` | the plan grammar, the required sentences, `DEVICE:` rows, the linter's rules |
| `references/ledger.md` | every machine shape: receipts, events, findings, gaps, `wish status --json`, CLI |
| `references/prompts.md` | every delegation prompt with its frame, TIMEBOX and FORBIDDEN |
| `references/defect-classes.md` | the class dictionary, probes and review axes |
| `references/metrics.md` | columns, `pr-watch`, targets and quality guards |

## Language

The skill is written in English. Three things are exempt, and each is exempt because removing it would lose a
guarantee rather than a preference: the `/wish` menu label in `prompts/wish.md`, which is product copy in the
requester's language; the verbatim mirror of the visual-QA skill's CJK line-breaking examples, which is a
visual-QA condition and not prose; and the test suite's non-ASCII path fixtures, which exist to prove the tooling
survives paths outside ASCII. Everything else — this contract, the readme, the playbooks, the references, the
script comments — carries no Korean text.

## Finish

Stop when the register is closed (every `defect` row `fixed`, `accepted-limit` or `out-of-scope`), every unit's PR
is merged with `post_merge` recorded, `checkpoint` completed, worktrees and branches removed with a teardown
receipt, and the final report delivered with evidence, limits and out-of-scope findings. Answer in the user's
language; prompts stay in English.
