# revise — a REVISE round, the switch rule, and the return path

Enter this playbook when a `round` verdict is `REVISE`, or when a gate row came back `not fixed`.
**Review has no round ceiling.** A cap is an approach-switch signal, never an exit: the run continues
until `APPROVED`, and the owner is never asked whether to keep reviewing. `../references/contract.md`
§6 and `../references/ledger.md` §9.4 are the binding text; this file is how they run.

```
ER=<evidence root>   export WISH_EVIDENCE_ROOT=$ER
PLAN=.omo/plans/wish-<slug>.md   WT=<absolute worktree>   BR=<branch>
wish() { bun "$WT/skills/wish/scripts/wish.mjs" "$@"; }
```

## The round, step by step

- [ ] 1. READ THE VERDICT: take the reviewer's findings table as filed — `class`, `file_line`, `repro_cmd`, `blocking` — and file every blocking row with `wish findings add --tsv -`; a row with no reproduction needs one written before the next gate (`status: no-command` is a defect of the finding, not a permission) [omo: session] [receipt: `findings.tsv` rows at the verdict head]
- [ ] 2. TWO-STRIKE CHECK: when the same component **or** the same `class` got a blocking finding in two consecutive rounds, stop patching it — write the one-sentence premise every failed fix assumed and run one `architect` premise review with the `premise-review` prompt (`../references/prompts.md` §4.2); record it as `wish switch record --round <n> --kind premise --premise "<the shared assumption>" --new-approach "<what the review changed>"` [omo: `category: architect`] [receipt: `switch` event with `kind: premise`]
- [ ] 3. THIRD-OR-LATER REVISE: a switch is **mandatory** before the next round, and `status.next` will literally read `switch` until it is recorded. `wish switch record` is accepted only once the REVISE round it names exists, so record the round first. Choose a kind you have not used in this cycle: `premise` (no premise review yet), `family` (run the fix node on a model family other than the one that produced the failed fix), `strategy` (a `SWITCH: <failed premise> -> <new approach>` plan row that redesigns the component instead of patching it), `rediscover` (lens-guided DISCOVER plus a variant sweep), or `split` (program mode only: the component becomes its own unit) [omo: session; the kinds are `../references/ledger.md` §9.4] [receipt: `switch` event with `round`, `kind`, `premise`, `new_approach`]
- [ ] 4. VARIANT SWEEP: before editing, sweep the same defect class across the component's siblings — the sibling location, the same transition, the same input shape — and file what it finds as its own findings; a fix that leaves the sibling broken comes back as the same class [omo: `quick` node running `sweep.mjs --probe <the class's probes>`] [receipt: `verify_lane-sweep-<head7>.json`]
- [ ] 5. FIX: run `mass-ulw` run `wish-<run>-fix-r<n>` — one component per node, the `fix-node` prompt for a plain correction and the `switch-fix` prompt (§2.4) for a switch round; each node recreates the reported failure, captures it, fixes it, captures the pass, and commits serially [omo: `mass-ulw` + `git-master` on the commit node] [receipt: `fix` events + `receipts/build-<node>.json`]
- [ ] 6. REUSE: judge every receipt against the new head — `bun $WT/skills/wish/scripts/reuse-check.mjs <receipt> --head <H2> --referrers <lsp refs>.json --base-impact <old>..<new>` — and re-run **only** what it calls `STALE`; append one `reuse` event per receipt, naming the saved lanes [omo: `reuse-check.mjs`] [receipt: `reuse` events with `VALID`/`STALE` and the reason]
- [ ] 7. FREEZE: `wish freeze --head <H2>` and `wish freeze --check` — nothing lands after it; a memo goes to `<ER>` [omo: `wish.mjs`] [receipt: `freeze` event]
- [ ] 8. GATE: `wish gate --round <n> --head <H2>` re-runs every prior blocking finding's `repro_cmd` at the new head; any `not fixed` row stops the ultrabrain dispatch and sends you back to step 5 with that row as the next component's target [omo: `quick` repro node + `wish.mjs gate`] [receipt: `gate` event, or a blocked dispatch recorded with its rows]
- [ ] 9. FINAL REVIEW, NEW REVIEWER: dispatch `category: ultrabrain` again — always a **new** task, never the previous reviewer continued — with the `ultrabrain-r2` prompt (delta diff, the prior findings that must now fail to reproduce, the gate table, the axis lines per work type). A round that only re-reads the old report is not a review [omo: `category: ultrabrain`] [receipt: `receipts/final-r<n>-<head7>.md` + `round` and `verdict` events]
- [ ] 10. VERDICT LINE: `bun $WT/skills/wish/scripts/check-verdict.mjs --body <report> --head <H2> --require-approved`; `APPROVED` on the frozen head ends the loop — go to `merge`. `REVISE` returns to step 1 with the new findings, and the counter never caps [omo: `check-verdict.mjs`] [receipt: the `verdict` event naming round, verdict, report and head]

## What the loop may never do

- **Never exit to the owner to stop reviewing.** "Should we keep going?" is not a question. The loop
  ends at `APPROVED`, an `unverified` area the platform blocks, or a withdrawn request.
- **Never treat a budget as approval.** A `TIMEBOX` or round-budget expiry returns the result it holds
  plus every unexamined item; an unexamined area is not a pass, and the next reviewer takes only that
  area.
- **Never reuse an approval.** An approval covers one `patch_id`; a rebase with an identical patch id
  keeps it, a different patch gets a delta round.
- **Never let a memo move the branch.** After the freeze, evidence corrections go to `<ER>` only.

## The owner's questions, and only these

Park a gate (`wish gate add --id <id> --question <text> --options <a|b> --default <a>`) when, and only
when, the decision is theirs: the fix would be irreversible or destructive, it spends money, or the
defect is the contract itself so a `LIMIT` needs accepting. While a gate is open, other units keep
running. A gate open longer than 15 minutes is recorded so `status` reports the wait.

## The omo caps this playbook wraps (without editing those skills)

| omo rule | What wish does |
| --- | --- |
| `ulw-execute`'s blocked-checkbox marker closes a row for that run only | wish does not run inside that loop; the register row stays `open`, and the next fix run picks it up with a switch — the "closed in this run" rule is never violated |
| `visual-qa`'s budget grows only when the requester asks | the two passes already carry the standing-budget sentence (`../references/prompts.md` §5.10–5.11), so a cap becomes a switch; a returned `NEEDS HUMAN REVIEW` is a finding plus a switch, and the fresh capture set gets a fresh double oracle |
| `ulw-research`'s repair may `deliver` with residual defects | not an approval here: residual findings become switch input (new design spec, assembly lane or reducer) and a fidelity defect is already refused by the delivery gate |

## Why this is not review reduction

The number of findings a reviewer may block on is unchanged — the same finite contract, the same
class dictionary, the same axes. What changes is that repeated failure of the *same* approach can no
longer consume unbounded rounds: at the third round the approach must change, which is the only rule
that both respects the owner's "keep going until it is right" and keeps a tail from becoming a week.