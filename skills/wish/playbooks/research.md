# research: the wish playbook for investigation

Type `research`. wish does **not** re-implement research: `ulw-research` runs the phases, its scripts
own the facts, and its gates decide fidelity. wish adds the contract (which questions a verified claim
must answer), one frozen artifact, the register, the progress line, one verdict, and the switch rule.
Read `../SKILL.md`, then `ulw-research`'s SKILL.md before this playbook's step 10.

Identity: `../SKILL.md`'s research note applies to every receipt and to the freeze. The deliverable ships as a PR.
A research unit carries no `code-review` lane, so its round has no code-review gate.

```
ER=<evidence root>   export WISH_EVIDENCE_ROOT=$ER
PLAN=.omo/plans/wish-<slug>.md   WT=<absolute worktree>   BR=<branch>
BASE=<the repository's integration branch for this request>
wish() { bun "$WT/skills/wish/scripts/wish.mjs" "$@"; }
```

## The steps

- [ ] 1. INTAKE: `wish init --run-id w-<slug>-<yyyymmdd-hhmm> --type research --tier <S|M|L> --plan $PLAN --worktree $WT --branch $BR --fact "<each fact>"`; the decision this report must support is the first fact [omo: session + `todo` + ultrawork tier triage] [receipt: `intake` event]
- [ ] 2. COLLECT: ONE `mass-ulw` run `wish-<run>-collect` that reads the corpus: `harvest` reads every named source in full plus `ulw-research`'s source floor (what counts as evidence, which domains must be represented, what a counter-search must cover), `extract` applies `playbooks/lens.md`'s extract rules and builds the source inventory and the first claim graph, `explore` lanes cover the repository and one `librarian` covers outside documents; nothing is summarized as a finding yet; write `<ER>/collect.md` and append `wish ledger append --event collect --json -` with `{"event":"collect","sources":<number of sources read>,"elements":<number of extracted elements>,"report":"$ER/collect.md"}`; the stage completes only when `elements` is positive, because an empty extraction is not a collection [omo: `mass-ulw` harvest → extract → explore, `explore` ∥ `librarian`; `ulw-research`'s source floor as the first rows] [receipt: `collect` event + `<ER>/collect.md`]
- [ ] 3. DEFINE: write `<ER>/define.md`: the reader the report serves and the decision they make with it, the ideal state as the expected truth for each question (which `ulw-research` keeps as `intent-diff.md`'s expectation column), and each expectation as `true`, `violated` or `unknown`; insert every `violated`/`unknown` as ONE register row with `wish gaps add --tsv -` (`kind: defect`, the research class); append `define` [omo: session; `ulw-research` owns the original table, this is its mirror] [receipt: `define` event + `<ER>/define.md` + `<ER>/gaps.tsv`]
- [ ] 4. BEFORE: `skip: no defect row` when the register holds none; otherwise snapshot each row's source, since the fact row as it stands today is the pre-edit state, and append a `before` event with its `gap_id` [omo: session + `ulw-research`'s fact ledger] [receipt: one `before-<gap>-<sha7>` per defect row]
- [ ] 5. PLAN: first read the related skills (`remove-ai-slops`, `frontend`, `programming`, `ulw-research`) and their references, then write `$PLAN` in the `../references/plan-format.md` grammar: `AXIS:` rows (each with the question it must answer), `CLAIM:` rows (`C1`…), `IS` rows that name the claim each one must support, `LIMIT` rows for what the report will not settle, and one `DEVICE: claim C<n> gate(primary, domains>=2, counter-search)` per claim; carry (a) and (b) verbatim, and (c) when the report has a rendered surface or a visual QA scenario. A plan forces no test code (`../references/plan-format.md` §3) [omo: session; grammar is `ulw-plan`'s checkbox contract] [receipt: `plan` event]

      ```
      (a) Implement it, and also include, strictly, a device that confirms the implementation was done.
      (b) In addition, fix it, and also include, strictly, a device that confirms the fix was made.
      (c) Proceed with ulw-plan, and make the plan include the following: fix this; also include, strictly, a device that confirms the fix was made; and verify the visual QA conditions specifically and in detail, with not a single one omitted.
      ```
- [ ] 6. PLAN-LINT: `bun $WT/skills/wish/scripts/check-plan.mjs $PLAN [--register $ER/gaps.tsv]` must exit 0; a `claim C<n>` device must cite a declared `CLAIM` row [omo: `check-plan.mjs`] [receipt: `plan_lint` event, exit 0]
- [ ] 7. PLAN-REVIEW: one `category: architect` review: are the axes the ones that actually answer the request, and is each claim supportable by the evidence the plan requires [omo: `category: architect`] [receipt: `receipts/plan_review-architect-<head7>.md` + `plan_review` event]
- [ ] 8. DECIDE: one decision batch in `<ER>/gates.md`, each entry with a recommended default, added with `wish gate add --id <id> --question <text> --options <a|b> --default <a>` and asked once; a wave-ceiling extension `ulw-research` may need later is listed here with its default [omo: session] [receipt: `decide` event + `<ER>/gates.md` entries with a recommended default]
- [ ] 9. GOAL: one paragraph per unit pairing each claim with its gate; register through ulw-loop, write the Boulder record that hands the plan to ulw-execute, then record the BEFORE snapshots with `recordEvidence({status:"fail"})` [omo: `ulw-loop` goals + Boulder as format only] [receipt: `goal` event]
- [ ] 10. BUILD: restate (d) verbatim before dispatching, then run `ulw-research` Phases 0–3 as the unit's build, one PR per independently verifiable unit with a disjoint write scope, several commits inside it, `## Before` / `## After` in each PR body, a one-unit request staying one PR; the session is the research orchestrator; use a `mass-ulw` mass-research DAG for a large corpus (60+ angles, harvest → expand → verify → reduce) and a team only under ulw-loop's team rules; `ulw-research`'s own convergence rule is the build's stop rule, and an extension request is an owner gate, not a wish question [omo: `ulw-research` Phases 0–3, `mass-ulw` for a mass study] [receipt: `build` events + `receipts/build-<node>.json`]

      ```
      (d) After that, don't ask the requester. Proceed exactly as written in this content with mass-ulw, ulw-loop, and ulw-execute, at maximum parallelism, verifying rigorously. Deliver the work as several pull requests, include the before/after directly inside each pull request, and make the improvements clearly visible. As you proceed, report status to the requester very frequently, every time, saying how much of the whole work is done and which parts are done.
      ```
- [ ] 11. VERIFY-LANE: `ulw-research`'s gates as the five lanes at one head: `fact-verify` (`ulw-research`'s own `report-tools.mjs fact verify`), `claim-gate` (the non-code claim lock), `skeptic` (`ultrabrain` family attacking each claim), `execution-verify` (`deep-low`, settling a claim by running code), `delivery-gate` (the five delivery gates in order, the `writing` correction lane included) [omo: `ulw-research` gates + `category: ultrabrain` + `category: deep-low`] [receipt: `fact-verify`, `claim-gate`, `skeptic`, `execution-verify`, `delivery-gate`, all five]
- [ ] 12. TRIAGE: file each gate finding with its research class (`untraceable_number`, `value_mismatch`, `quote_not_verbatim`, `unbound_sentence`, `meaning_drift_*`, `fidelity_unresolved`, `claim_unresolved`, `claim_refuted`); a gate failure inside the contract blocks [omo: session, bugbot trichotomy] [receipt: `triage` event + `findings.tsv` rows]
- [ ] 13. FIX: `skip: no blocking finding`; `mass-ulw` run `wish-<run>-fix-r<n>` re-runs the affected phase or gate, `reuse-check` judges every receipt against the new artifact hash, and only stale lanes re-run [omo: `mass-ulw` + `reuse-check.mjs`] [receipt: `fix` and `reuse` events]
- [ ] 14. FREEZE: `wish freeze --head <artifact sha256>` binds the artifact hash, not a commit; `wish pr-body --out $ER/pr-body.md` writes the body with each claim's before (`unresolved`) and after (`supported`, source count) row [omo: session + `wish.mjs`] [receipt: `freeze` event with the 64-hex head and `tree: null`]
- [ ] 15. PR-OPEN: commit the artifact, `gh pr create --base $BASE --head $BR --body-file $ER/pr-body.md`, append `pr_open`, arm `tool.monitor` on `pr-watch.mjs` [omo: `gh` + `tool.monitor`] [receipt: `pr_open` event]
- [ ] 16. ROUND: `wish gate --round <n> --head <artifact sha256>` (no code-review gate on this type), then one `category: ultrabrain` review that plays `ulw-research`'s refinement-team role once, never twice: its input is the fact view, the verified claims and the gate record; `check-verdict.mjs --require-approved`. On `REVISE`, run `playbooks/revise.md` (DEFINE, PLAN, PLAN-LINT for the cited problem, fix commits in the same PR); a research `deliver` verdict that ships with residual defects is **not** an approval, and its residual findings become switch input [omo: `wish.mjs gate` + `category: ultrabrain`] [receipt: `receipts/final-r<n>-<head7>.md` + `round` and `verdict` events, plus the `switch` event a REVISE round requires]
- [ ] 17. MERGE: after `APPROVED` and all five gates PASS, merge the deliverable PR and append `merge`; the closing briefing and `team_delete` belong to the same step when a team ran [omo: session + `ulw-research` closing rules] [receipt: `merge` event]
- [ ] 18. POST-MERGE: the artifact hash must match the frozen one; a mismatch is the full gate set again [omo: `omo-native-qa-executor` for any runnable check] [receipt: `post_merge` event + `receipts/post_merge-<tree7>.*`]
- [ ] 19. CHECKPOINT: ulw-loop `checkpoint`, then `omo-native-gate-reviewer` on the evidence record [omo: `ulw-loop` + `omo-native-gate-reviewer`] [receipt: `checkpoint` event, `checkpoint_op: complete`]
- [ ] 20. CLEANUP: `wish metrics export`, `memory` for the classes caught, teardown of team, worktree and temp sources, then append `cleanup` [omo: session + `metrics.mjs` + `memory`] [receipt: `cleanup` event with ≥1 teardown receipt]

## What the research type enforces

- A number without a traceable source, a value that differs from its source, a quote that is not verbatim, or a sentence bound to no evidence is a blocking finding: those are the gate codes, not style.
- A claim state is `unresolved` or `refuted` until its gate passes; `supported` needs the gate record, never the prose.
- An extension the requester must grant is an owner gate (`../SKILL.md`); anything else is settled by evidence.

## Forbidden

Re-implementing a research gate in the playbook; treating a gate's PASS as an ultrabrain approval; shipping an artifact whose hash differs from the frozen one; editing the fact ledger by hand.
