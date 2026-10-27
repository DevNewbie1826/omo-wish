# research — the wish v2 playbook for investigation

Type `research`. wish does **not** re-implement research: `ulw-research` runs the phases, its scripts
own the facts, and its gates decide fidelity. wish adds the contract (which questions a verified claim
must answer), one frozen artifact, the register, the progress line, one verdict, and the switch rule.
Read `../SKILL.md`, then `ulw-research`'s SKILL.md before this playbook's step 11.

Identity note: a research unit has **no git tree**. Its `head` is the frozen artifact's 64-hex sha256,
every receipt sets `tree: null`, and `freeze` records that pair. `status` still requires `pr_open`,
`merge` and `post_merge`, so the deliverable is committed on the branch and shipped as a PR — a
docs-only or artifact-only PR is the normal case.

```
ER=<evidence root>   export WISH_EVIDENCE_ROOT=$ER
PLAN=.omo/plans/wish-<slug>.md   WT=<absolute worktree>   BR=<branch>   BASE=wish-v2
wish() { bun "$WT/skills/wish/scripts/wish.mjs" "$@"; }
```

A research unit has no git tree, so nothing here can be frozen by commit: the artifact hash is the
identity, and a source snapshot is what a `before` receipt holds.

## The steps

- [ ] 1. INTAKE: `wish init --run-id w-<slug>-<yyyymmdd-hhmm> --type research --tier <S|M|L> --plan $PLAN --worktree $WT --branch $BR --fact "<each fact>"`; the decision this report must support is the first fact [omo: session + `todo` + ultrawork tier triage] [receipt: `intake` event]
- [ ] 2. LENS: the lens is the requester's expected truths plus `ulw-research`'s source floor — what counts as evidence, which domains must be represented, what a counter-search must cover; write `<ER>/lens.md` and append `lens`, or `skip: no corpus` when the request states no standard beyond the question [omo: `mass-ulw` lens run; `ulw-research`'s source floor as the first rows] [receipt: `lens` event + `<ER>/lens.md`]
- [ ] 3. DISCOVER: `explore` lanes build the source inventory and the first claim graph; `librarian` covers outside documents; nothing is summarized as a finding yet [omo: `explore` ∥ `librarian`] [receipt: `discover` event + `receipts/discover-<lane>.md`]
- [ ] 4. IDEAL: write `<ER>/ideal.md` from the expectation list — the expected truth for each question, which `ulw-research` keeps as `intent-diff.md`'s expectation column [omo: session] [receipt: `ideal` event + `<ER>/ideal.md`]
- [ ] 5. GAP: every expectation is `true`, `violated` or `unknown`; for each `violated`/`unknown` snapshot the source first and then insert ONE register row — `wish gaps add --tsv -` with `kind: defect`, the research class and `before_artifact` set, (`../SKILL.md` stage 4) [omo: session; `ulw-research` owns the original table, this is its mirror] [receipt: `gap` events + `<ER>/gaps.tsv`]
- [ ] 6. BEFORE: record each snapshot from step 5 as a `before` event with its `gap_id`; the fact row as it stands today is the pre-edit state; the SDK write is `../SKILL.md` stage 5's [omo: session + `ulw-research`'s fact ledger] [receipt: one `before-<gap>-<sha7>` per defect gap]
- [ ] 7. PLAN: write `$PLAN` with the two sections the linter requires, `## Todos` (`- [ ] <N>. <title>`) and `## Final verification wave` (`- [ ] F<n>. <title>`), then `AXIS:` rows (each with the question it must answer), `CLAIM:` rows (`C1`…), `IS` rows that name the claim each one must support, `LIMIT` rows for what the report will not settle, and one `DEVICE: claim C<n> gate(primary, domains>=2, counter-search)` per claim [omo: session; grammar from `../references/plan-format.md` §4.6 and §5.2] [receipt: `plan` event]
- [ ] 8. PLAN-LINT: `bun $WT/skills/wish/scripts/check-plan.mjs $PLAN [--register $ER/gaps.tsv]` must exit 0 (register rule: `../SKILL.md` stage 7); a `claim C<n>` device must cite a declared `CLAIM` row [omo: `check-plan.mjs`] [receipt: `plan_lint` event, exit 0]
- [ ] 9. PLAN-REVIEW: one `category: architect` review — are the axes the ones that actually answer the request, and is each claim supportable by the evidence the plan requires [omo: `category: architect`] [receipt: `receipts/plan_review-architect-<head7>.md` + `plan_review` event]
- [ ] 10. GOAL: one paragraph per unit pairing each claim with its gate; register through ulw-loop, write the Boulder record, then record the step-6 `before` snapshots with `recordEvidence({status:"fail"})` (`../SKILL.md`, stage 5) [omo: `ulw-loop` goals + Boulder as format only] [receipt: `goal` event]
- [ ] 11. BUILD: run `ulw-research` Phases 0–3 as the unit's build — the session is the research orchestrator; use a `mass-ulw` mass-research DAG for a large corpus (60+ angles, harvest → expand → verify → reduce) and a team only under ulw-loop's team rules; `ulw-research`'s own convergence rule (including the wave ceiling that asks the requester for an extension) is the build's stop rule, and that extension request is an owner gate, not a wish question [omo: `ulw-research` Phases 0–3, `mass-ulw` for a mass study] [receipt: `build` events + `receipts/build-<node>.json`]
- [ ] 12. VERIFY-WAVE: `ulw-research`'s gates as the five lanes at one head — `fact-verify` (`ulw-research`'s own `report-tools.mjs fact verify`), `claim-gate` (the non-code claim lock), `skeptic` (`ultrabrain` family attacking each claim), `execution-verify` (`deep-low`, settling a claim by running code), `delivery-gate` (the five delivery gates in order, the `writing` correction lane included) [omo: `ulw-research` gates + `category: ultrabrain` + `category: deep-low`] [receipt: `fact-verify`, `claim-gate`, `skeptic`, `execution-verify`, `delivery-gate` — all five]
- [ ] 13. TRIAGE: file each gate finding with its research class (`untraceable_number`, `value_mismatch`, `quote_not_verbatim`, `unbound_sentence`, `meaning_drift_*`, `fidelity_unresolved`, `claim_unresolved`, `claim_refuted`); a gate failure inside the contract blocks [omo: session, bugbot trichotomy] [receipt: `triage` event + `findings.tsv` rows]
- [ ] 14. FIX: `skip: no blocking finding`; `mass-ulw` run `wish-<run>-fix-r<n>` re-runs the affected phase or gate, `reuse-check` judges every receipt against the new artifact hash, and only stale lanes re-run [omo: `mass-ulw` + `reuse-check.mjs`] [receipt: `fix` and `reuse` events]
- [ ] 15. FREEZE: `wish freeze --head <artifact sha256>` binds the artifact hash, not a commit; `wish pr-body --out $ER/pr-body.md` writes the body with each claim's before (`unresolved`) and after (`supported`, source count) row [omo: session + `wish.mjs`] [receipt: `freeze` event with the 64-hex head and `tree: null`]
- [ ] 16. PR: commit the artifact, `gh pr create --base $BASE --head $BR --body-file $ER/pr-body.md`, append `pr_open`, arm `tool.monitor` on `pr-watch.mjs` [omo: `gh` + `tool.monitor`] [receipt: `pr_open` event]
- [ ] 17. ROUND: `wish gate --round <n>`, then one `category: ultrabrain` review — it plays `ulw-research`'s refinement-team role once, never twice: its input is the fact view, the verified claims and the gate record; `check-verdict.mjs --require-approved` [omo: `wish.mjs gate` + `category: ultrabrain`] [receipt: `receipts/final-r<n>-<head7>.md` + `round` and `verdict` events]
- [ ] 18. REVISE: on `REVISE`, go to `playbooks/revise.md`. A research `deliver` verdict that ships with residual defects is **not** an approval — the residual findings become switch input (a new design spec, a new assembly lane, a new reducer), and fidelity findings are already refused by the delivery gate [omo: as `revise.md` says] [receipt: the `switch` event the round requires]
- [ ] 19. MERGE: after `APPROVED` and all five gates PASS, merge the deliverable PR and append `merge`; the closing briefing and `team_delete` belong to the same step when a team ran [omo: session + `ulw-research` closing rules] [receipt: `merge` event]
- [ ] 20. POST-MERGE: the artifact hash must match the frozen one; a mismatch is the full gate set again [omo: `omo-native-qa-executor` for any runnable check] [receipt: `post_merge` event + `receipts/post_merge-<tree7>.*`]
- [ ] 21. CHECKPOINT and CLEANUP: ulw-loop `checkpoint`, `omo-native-gate-reviewer` on the evidence record, `wish metrics export`, `memory` for the classes caught, teardown of team, worktree and temp sources, then append `cleanup` [omo: `ulw-loop` + `omo-native-gate-reviewer` + `metrics.mjs` + `memory`] [receipt: `checkpoint` event then `cleanup` event with ≥1 teardown receipt]

## What the research type enforces

- A number without a traceable source, a value that differs from its source, a quote that is not verbatim, or a sentence bound to no evidence is a blocking finding — those are the gate codes, not style.
- A claim state is `unresolved` or `refuted` until its gate passes; `supported` needs the gate record, never the prose.
- An extension the requester must grant (a wave ceiling, a paid source) is an owner gate; anything else is settled by evidence.

## Forbidden

Re-implementing a research gate in the playbook; treating a gate's PASS as an ultrabrain approval; shipping an artifact whose hash differs from the frozen one; editing the fact ledger by hand.