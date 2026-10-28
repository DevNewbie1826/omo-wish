# revise — a REVISE round, the switch rule, and the return path

Enter this playbook when a `round` verdict is `REVISE`, or when a gate row came back `not fixed`. The rule
is `../SKILL.md`'s round rule; `../references/contract.md` §6 and `../references/ledger.md` §9.4 are the
binding text, and this file is how it runs.

A defect found after `APPROVED` enters here as well: fix it, `wish freeze` the new head, then re-open the
approved round — `wish ledger append --event reopen --json -` with that `round`, `reason` and the new `head`
(`../references/ledger.md` §9.4) — because no round may follow `APPROVED` without it. The re-opened round
runs from step 7 on, and it is judged by a reviewer that never saw the approval.

```
ER=<evidence root>   export WISH_EVIDENCE_ROOT=$ER
PLAN=.omo/plans/wish-<slug>.md   WT=<absolute worktree>   BR=<branch>
wish() { bun "$WT/skills/wish/scripts/wish.mjs" "$@"; }
```

## The round, step by step

- [ ] 1. READ THE VERDICT: take the reviewer's findings table as filed — `class`, `file_line`, `repro_cmd`, `blocking` — and file every blocking row with `wish findings add --tsv -`; a row with no reproduction needs one written before the next gate (`status: no-command` is a defect of the finding, not a permission) [omo: session] [receipt: `findings.tsv` rows at the verdict head]
- [ ] 2. TWO-STRIKE CHECK: when `../SKILL.md`'s round rule 1 says this is the second strike on a component or class, write the one-sentence premise the failed fixes assumed and run one `architect` premise review with the `premise-review` prompt (`../references/prompts.md` §4.2); record it as `wish switch record --round <n> --kind premise --premise "<the shared assumption>" --new-approach "<what the review changed>"` [omo: `category: architect`] [receipt: `switch` event with `kind: premise`]
- [ ] 3. THIRD-OR-LATER REVISE: `status.next` reads `switch` until one is recorded, as `../SKILL.md`'s round rule 2 requires. `wish switch record` is accepted only once the REVISE round it names exists, so record the round first. Kinds: `../SKILL.md` round rule 2 [omo: session; the kinds are `../references/ledger.md` §9.4] [receipt: `switch` event with `round`, `kind`, `premise`, `new_approach`]
- [ ] 4. VARIANT SWEEP: before editing, sweep the same defect class across the component's siblings — the sibling location, the same transition, the same input shape — and file what it finds as its own findings; a fix that leaves the sibling broken comes back as the same class. A variant sweep re-runs the lane that owns the defect and files that receipt (selection: `../SKILL.md` work types). For a `code` unit that lane's command is `sweep.mjs --root $WT --config $ER/sweep.json --probe <the class's probes> --lane sweep --unit <u> --type code --receipt $ER/receipts` [omo: `quick` node + `sweep.mjs` for code, the owning lane otherwise] [receipt: the receipt of the lane that actually re-ran]
- [ ] 5. FIX: run `mass-ulw` run `wish-<run>-fix-r<n>` — one component per node, the `fix-node` prompt for a plain correction and the `switch-fix` prompt (§2.4) for a switch round; each node recreates the reported failure, captures it, fixes it, captures the pass, and commits serially [omo: `mass-ulw` + `git-master` on the commit node] [receipt: `fix` events + `receipts/build-<node>.json`]
- [ ] 6. REUSE: judge every receipt against the new head — `bun $WT/skills/wish/scripts/reuse-check.mjs <receipt> --head <H2> --referrers <lsp refs>.json --base-impact <old>..<new>` — and re-run **only** what it calls `STALE`; append one `reuse` event per receipt, naming the saved lanes [omo: `reuse-check.mjs`] [receipt: `reuse` events with `VALID`/`STALE` and the reason]
- [ ] 7. FREEZE: `wish freeze --head <H2>` and `wish freeze --check` (`../SKILL.md` stage 14) [omo: `wish.mjs`] [receipt: `freeze` event]
- [ ] 8. GATE: `wish gate --round <n> --head <H2>` re-runs every prior blocking finding's `repro_cmd` at the new head; any `not fixed` row stops the ultrabrain dispatch and sends you back to step 5 with that row as the next component's target [omo: `quick` repro node + `wish.mjs gate`] [receipt: `gate` event, or a blocked dispatch recorded with its rows]
- [ ] 9. FINAL REVIEW, NEW REVIEWER: dispatch `category: ultrabrain` again — always a **new** task, never the previous reviewer continued — with the `ultrabrain-r2` prompt (delta diff, the prior findings that must now fail to reproduce, the gate table, the axis lines per work type). A round that only re-reads the old report is not a review [omo: `category: ultrabrain`] [receipt: `receipts/final-r<n>-<head7>.md` + `round` and `verdict` events]
- [ ] 10. VERDICT LINE: `bun $WT/skills/wish/scripts/check-verdict.mjs --body <report> --head <H2> --require-approved`; `APPROVED` on the frozen head ends the loop — go to `merge`. `REVISE` returns to step 1 with the new findings [omo: `check-verdict.mjs`] [receipt: the `verdict` event naming round, verdict, report and head]

## What the loop may never do

`../SKILL.md`'s round rule and evidence rules, and `../references/prompts.md` §1.2, are the binding list.

## The owner's questions

`wish gate add --id <id> --question <text> --options <a|b> --default <a>`. The scope of an owner decision is `../SKILL.md`; a gate open longer than 15 minutes is recorded so `status` reports the wait.

## The omo caps this playbook wraps (without editing those skills)

| omo rule | What wish does |
| --- | --- |
| `ulw-execute`'s blocked-checkbox marker closes a row for that run only | wish does not run inside that loop; the register row stays `open`, and the next fix run picks it up with a switch — the "closed in this run" rule is never violated |
| `visual-qa`'s budget grows only when the requester asks | the two passes already carry the standing-budget sentence (`../references/prompts.md` §5.10–5.11), so a cap becomes a switch; a returned `NEEDS HUMAN REVIEW` is a finding plus a switch, and the fresh capture set gets a fresh double oracle |
| `ulw-research`'s repair may `deliver` with residual defects | not an approval here: residual findings become switch input (new design spec, assembly lane or reducer) and a fidelity defect is already refused by the delivery gate |

## Why this is not review reduction

The number of findings a reviewer may block on is unchanged — the same finite contract, the same
class dictionary, the same axes. What changes is that repeated failure of the *same* approach can no
longer consume unbounded rounds (`../SKILL.md` round rule).
