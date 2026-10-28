# resume — after a death, a compaction, or `/wish --resume <run_id>`

The state is the authority, never memory. `ledger.jsonl`, the receipts and the plan's front matter
survive a killed session, so a restart re-runs nothing that is still valid (`../SKILL.md`, evidence rules). Follow the steps in order; do not re-plan from scratch and do not re-derive a decision
that the ledger already records.

```
ER=<evidence root>   export WISH_EVIDENCE_ROOT=$ER
PLAN=.omo/plans/wish-<slug>.md   WT=<absolute worktree>
wish() { bun "$WT/skills/wish/scripts/wish.mjs" "$@"; }
```

## The steps

- [ ] 1. REBIND: `agentToolkit.status()` gives the binding and the `evidenceRoot`; confirm it is the root the ledger lives in. If the root moved, the ledger is not the run's — stop and say so rather than starting a second state [omo: `ulw-loop` SDK] [receipt: the root path recorded in the `resume` event]
- [ ] 2. READ THE STATE: `wish status --json` prints `stage`, `type`, `tier`, `head`, `tree`, `round`, `valid_receipts`, `stale_receipts`, `blocking`, `next`, `units`, `wave`, `progress`; `wish resume-plan` prints the first invalid stage and the actions that clear it [omo: `wish.mjs status` / `resume-plan`] [receipt: the printed state, kept under `<ER>/resume.md`]
- [ ] 3. JUDGE, DO NOT TRUST: `status` already re-judged every receipt against the current tree; a `VALID` receipt is not re-run, a `STALE` one is. Never re-run a lane to "make sure" — that is the cost this design exists to remove [omo: `reuse-check` logic inside `status`] [receipt: the valid and stale lists]
- [ ] 4. REATTACH THE RUN: a `mass-ulw` run is journaled and idempotent by key — re-enter `wish-<run>-collect`, `wish-<run>-build` or `wish-<run>-fix-r<n>` with the same key instead of creating a new one [omo: `mass-ulw` attach/start] [receipt: the run id and its node states]
- [ ] 5. JUDGE THE DEAD CHILDREN BY THEIR RECEIPTS: a lane whose receipt exists **and judges `VALID` at the current head** is done, whatever its child's fate; a lane with no receipt, or one `status` calls `STALE`, is re-spawned once. File existence alone is not completion [omo: `task` batch, one retry] [receipt: the re-spawned lane's receipt]
- [ ] 6. RESUME FROM THE FIRST INVALID STAGE: dispatch only what `status.next` names, one of `intake`, `collect`, `define`, `before`, `plan`, `plan_lint`, `plan_review`, `decide`, `goal`, `build`, `verify_lane`, `triage`, `fix`, `freeze`, `pr_open`, `round`, `merge`, `post_merge`, `checkpoint`, `cleanup`; a parked `decide` gate parks only its own lane; append `wish ledger append --event resume --json -` with `{"event":"resume","note":"<the first invalid stage>"}` [omo: session] [receipt: `resume` event]
- [ ] 7. CHECK THE BOULDER PATH: when `.omo/boulder.json` names this plan with unchecked rows, ulw-execute holds it as checkbox work and the harness re-injects the next turn, while `status` still owns the stage order; confirm it does on this host. If it does not, this playbook **is** the recovery path — never wait on a hook that is not firing [omo: ulw-execute Boulder record, format only] [receipt: the Boulder entry's `active_plan` and `status`]

## Pause safely, before a long wait

Before an `ultrabrain` dispatch, a CI wait or an owner gate, write `<ER>/resume.md` — intent, current
stage, valid receipts, the one next action — and make sure nothing is uncommitted that the resume
would lose. A `wip:` commit is allowed **before** the freeze only (`../SKILL.md`, the `freeze` row).

## Failure modes and their one retry

| Symptom | Retry |
| --- | --- |
| provider 524, timeout, a child that died without a receipt | the same lane once, then record the lane as failed |
| context cap, out-of-memory, a run too large | narrow the scope (fewer nodes, one component) and retry once |
| a tool error that looks like the tool, not the work | one step down the category ladder, or another model family |
| unknown | once, then a `switch` — never a third identical attempt |
| a late lane result arriving after the head moved | adopt it only when its `head`/`tree` still matches; otherwise discard it and re-run the lane |

Two identical failures at one step is a signal to change the approach (`playbooks/revise.md` step 3),
never a reason to loop the same call again. Concurrency is capped in every brief: at most eight
processes, one retry, no relaunch loops.

## What a resume never does

- Re-plan a plan that already exists, or edit a plan row to match what the code now does.
- Re-open a resolved gate or re-ask a question the owner already answered at `decide`.
- Trust a stale `head`: the ledger's last `freeze` is the state.