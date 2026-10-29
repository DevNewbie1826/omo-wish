# program — one request, several units, several PRs

A program is one request whose honest delivery is more than one PR: a register of gaps grouped into
units that do not share write scopes. For a multi-unit request the unit split is the default, not an option. Each unit is a full run of the stage machine — its own worktree,
branch, PR, goal and contract. This playbook adds the program layer on top of the type playbook
(`code.md`, `design.md`, `research.md`, `audit.md`) that each unit follows.

```
ER=<evidence root>   export WISH_EVIDENCE_ROOT=$ER
PROGRAM=p-<slug>     BASE=<the repository's integration branch for this request>
```

## Unit and wave

- A **unit** is one PR: `wish init --run-id w-<slug>-u<N>-<yyyymmdd-hhmm> --program $PROGRAM --unit u<N> --type <type> --tier <S|M|L> --plan
  .omo/plans/wish-<slug>-u<N>.md --worktree <abs> --branch <branch> --fact "<each fact>"` (init creates
  the plan (`../SKILL.md`, the `intake` row); the run id is required and unique per
  unit). The unit-contract rule is in `../SKILL.md` and `../references/contract.md` §2.
- A **mixed** unit is the one unit whose type is not concrete: it passes `--type mixed --primary <type>
  --secondary <type>` to `wish init` (`../SKILL.md`, the mixed row).
- A **wave** holds the units whose write scopes do not overlap. Wave size is `min(host model slots,
  non-overlapping units)`; never more. Capacity is shared: at most two `mass-ulw` runs and one wish
  program per session, and at most five workers in one batch — so the six lanes a `design` unit requires
  run as two batches, and none of them is skipped. "Maximum parallelism" means up to the slots, never
  past them.
- A unit whose scope overlaps a running unit waits for the next wave. After a wave merges, rebase the
  next one and judge which receipts survived with the reuse rule (`../references/ledger.md` §2: tree match →
  VALID; else changed files ∩ `scope`), re-running only the STALE lanes.

## The program steps

- [ ] 1. INTAKE: run the audit half first (its COLLECT and DEFINE) — an `audit` unit produces `<ER>/gaps.tsv` and the report; that register is the program's denominator [omo: `playbooks/audit.md`] [receipt: the audit unit's `cleanup` event, register on disk]
- [ ] 2. DEFINE: `<ER>/define.md` and the register are complete before any unit is planned; every `defect` row is `open` with a `unit` assigned [omo: session] [receipt: `define` event + `<ER>/define.md` + every row carrying a `unit`]
- [ ] 3. BEFORE: every `defect` row gets its pre-edit capture before the **first** edit anywhere in the program, and the row is inserted exactly once with that `before_artifact` (`../SKILL.md`, the `before` row); a unit's capture belongs to the tree it was taken on [omo: session + a capture lane] [receipt: `before` events, one per defect row]
- [ ] 4. PLAN: one plan per unit, linted with `check-plan.mjs` and decided in one DECIDE batch, each with its wave, its `unit`, its own `IS`/`DEVICE` rows, and a `LIMIT` for anything it deliberately leaves to another unit [omo: session + `check-plan.mjs` per unit] [receipt: `plan`, `plan_lint` and `decide` events per unit]
- [ ] 5. GOAL: one goal per unit, one paragraph each, criteria = that unit's gap rows (`scenario` = its `before` device, `expectedEvidence` = its `after` artifact); the devices are the ones PLAN fixed [omo: `ulw-loop` goals] [receipt: `goal` event per unit]
- [ ] 6. BUILD: one `mass-ulw` run for the wave, whose nodes are per-unit changes with the unit's worktree pin [omo: `mass-ulw`] [receipt: `build` events per node]
- [ ] 7. VERIFY-LANE: one `task` batch, unit × lane, at each unit's own head — plus the extra capture batch a `design` unit needs before its two visual passes; a lane never judges another unit's scope [omo: the type playbook's lanes] [receipt: `verify_lane` receipts per unit and lane]
- [ ] 8. PER-UNIT TAIL: `triage` → `fix` → `freeze` → `pr_open` → `round` (with its gate) → `merge` → `post_merge` run **independently per unit**; one unit's REVISE never blocks another unit's merge [omo: as the type playbook says] [receipt: `round`, `verdict`, `merge`, `post_merge` events per unit]
- [ ] 9. SPLIT (only here): when a unit keeps failing on one component, the `split` switch makes that component its own unit and PR; the gap row stays `open` and moves to the new unit — this is a re-split, never a scope cut [omo: `architect` premise review + `wish switch record --kind split`] [receipt: `switch` event with `kind: split` and the new unit in the register]
- [ ] 10. PROGRESS: print the machine line (`../SKILL.md`: cadence and suppression) — `wish status --progress` prints `PROGRESS: run <id> · units <done>/<total> · gaps <fixed>/<total defect> · prs <merged> merged <open> open · wave <k>/<n> · round r<n> on <#pr|none> · switch <count> · waiting <what|none>`. Only the `waiting` field may differ [omo: `wish.mjs status --progress`; the host's relay consumes the line, the skill never names a channel] [receipt: `progress` events]
- [ ] 11. CLOSE: the program is complete per `../SKILL.md`'s finish condition, unit by unit [omo: session] [receipt: the last unit's `cleanup` event and the register's final state]

## Rules that keep a program honest

- A reviewer of unit A cannot demand unit B's delivery, and a
  register row that moved to another unit is not "missing" from this PR.
- Completeness lives in the register, quality lives in each unit's review. Do not trade one for the
  other.
- The first program run is **diagnostic only**: its rows are recorded, never judged against targets,
  because it has no control group.
- One wave at a time per repository unless the write scopes are provably disjoint.
