# design — the wish v2 playbook for rendered surfaces

Type `design`: web UI, TUI, slides, documents, images — anything a person looks at. wish does not
re-implement the visual work: `frontend` builds inside the BUILD nodes and `visual-qa` verifies inside
the verify wave, both with their own prompts. wish adds the contract, one head, the register, the
before/after pairs and the verdict. Read `../SKILL.md` first; copy these steps into `todo` verbatim.

```
ER=<evidence root>   export WISH_EVIDENCE_ROOT=$ER
PLAN=.omo/plans/wish-<slug>.md   WT=<absolute worktree>   BR=<branch>   BASE=wish-v2
wish() { bun "$WT/skills/wish/scripts/wish.mjs" "$@"; }
```

The before matrix is `visual-qa`'s: each case × `{390, 1440}` (add 1920 when the surface has it) ×
light/dark, plus the scroll end and each interaction frame. `wish init` writes the front matter (`../SKILL.md` stage 0); the body is appended at this playbook's step 7.

## The steps

- [ ] 1. INTAKE: `wish init --run-id w-<slug>-<yyyymmdd-hhmm> --type design --tier <S|M|L> --plan $PLAN --worktree $WT --branch $BR --fact "<each fact>"`; the design surface list is the first fact [omo: session + `todo` + ultrawork tier triage] [receipt: `intake` event with `tier` and `facts`]
- [ ] 2. LENS: seed the lens from what omo already distilled — the `visual-qa` checklist `A1`–`J2` and the `frontend` build rules become the first rows of `<ER>/lens.md` — and read a corpus only for rules those do not already hold; run the `mass-ulw` lens graph with `playbooks/lens.md` [omo: `mass-ulw` lens run, `visual-qa` and `frontend` as the first sources] [receipt: `lens` event + `<ER>/lens.md`]
- [ ] 3. DISCOVER: `explore` lanes steered by the lens questions, one lane per surface group, plus `librarian` for an outside design source; each lane returns surfaces, states and current behavior, never a fix [omo: `explore` ∥ `librarian`, read-only] [receipt: `discover` event + `receipts/discover-<lane>.md`]
- [ ] 4. IDEAL: `skip: single surface`; otherwise write `<ER>/ideal.md` — one paragraph per surface naming the lens rules it must instantiate and what the ideal state looks like [omo: session] [receipt: `ideal` event + `<ER>/ideal.md`]
- [ ] 5. GAP: `skip: single surface`; otherwise every rule × surface pair gets a verdict, and for each violation you take the pre-edit capture first and then insert ONE row — `wish gaps add --tsv -` with `kind: defect|taste`, `rule: L<n>|skill:<skill>:<code>` and `before_artifact` set (`../SKILL.md` stage 4) [omo: session merging the `remove-ai-slops` report-only lane and the `frontend` draft-guard lint] [receipt: `gap` events + `<ER>/gaps.tsv`]
- [ ] 6. BEFORE: record every capture from step 5 as a `before` event with its `gap_id` (`../SKILL.md` stage 5). The SDK write is `../SKILL.md` stage 5's [omo: `capture-lane` prompt; a TUI captures through the xterm.js web terminal, never a pane dump] [receipt: one `before-<gap>-<tree7>` capture and JSON per defect gap]
- [ ] 7. PLAN: write `$PLAN` with the two sections the linter requires, `## Todos` (`- [ ] <N>. <title>`) and `## Final verification wave` (`- [ ] F<n>. <title>`), then one `SCREEN:` row per surface (the frontend brief: the one primary action, priorities 1–3, what a generated version would add and this one will not, every required input and label, the `Layout:` line), `IS`/`COMPANION`/`INVARIANT`/`LIMIT` rows, `QA-n` rows that drive a real interaction and end in `run:`, and one `DEVICE: vqa <item ids> @ <matrix cells> pair <case>-<state>-<width>-<theme>` per IS [omo: session; grammar from `../references/plan-format.md` §4.6 and §5.2] [receipt: `plan` event]
- [ ] 8. PLAN-LINT: `bun $WT/skills/wish/scripts/check-plan.mjs $PLAN [--register $ER/gaps.tsv]` must exit 0 (register rule: `../SKILL.md` stage 7) — a `code` device on a `design` plan is a complaint [omo: `check-plan.mjs`] [receipt: `plan_lint` event, exit 0]
- [ ] 9. PLAN-REVIEW: one `category: architect` review of the contract (does each `SCREEN` row promise what the request needs, is every limit real); `plan-reviewer` only when the ulw-plan gate is open [omo: `category: architect`] [receipt: `receipts/plan_review-architect-<head7>.md` + `plan_review` event]
- [ ] 10. GOAL: one paragraph per unit pairing the `SCREEN` and `IS` rows with their devices; register through ulw-loop, write the Boulder record, then record the step-6 captures with `recordEvidence({status:"fail"})` (`../SKILL.md`, stage 5) [omo: `ulw-loop` goals + Boulder as format only] [receipt: `goal` event]
- [ ] 11. BUILD: `mass-ulw` run `wish-<run>-build`; a design node runs `frontend`'s brief → build → **subtract** → verify order and ends with the draft-guard checker at exit 0 on its own output; one node owns its change and its proof, the commit node loads `git-master` [omo: `mass-ulw` + the `frontend` skill inside each node] [receipt: `build` events + `receipts/build-<node>.json`]
- [ ] 12. VERIFY-WAVE: two `task` batches at head H1. Batch 1 — `draft-guard` (`quick`, `sweep.mjs --root $WT --config $ER/sweep.json --probe draft-guard --lane draft-guard --unit <u> --type design --receipt $ER/receipts`), `capture` (the full matrix on the **post-edit** build; a capture older than the last edit is not evidence), `code-review` (`omo-native-code-reviewer` on the implementation diff, with `remove-ai-slops` and `programming`), and `qa` (`omo-native-qa-executor` driving the interactions and state transitions); then batch 2, at the same head and only once those captures exist, runs `vqa-passA` and `vqa-passB` (both `unspecified-high`, read-only, fresh reviewers, prompts verbatim from `../references/prompts.md` §5.10–5.11, which already carry the extended-budget sentence that makes a cap an approach switch). Each writes its own receipt — `vqa-passA-<head7>`, `vqa-passB-<head7>`, `vqa-capture-<head7>`, or `verify_lane-<lane>-<head7>.json` for `draft-guard`, `code-review` and `qa` [omo: two `task` batches: `quick` draft-guard, `omo-native-qa-executor`, two `unspecified-high` visual-qa passes, `omo-native-code-reviewer`] [receipt: `draft-guard`, `capture`, `vqa-passA`, `vqa-passB`, `code-review`, `qa` — all six]
- [ ] 13. PAIR: for each fixed gap produce `after-<gap>-<tree7>.png` and the pair image `<case>-<state>-<width>-<theme>-pair.png`, plus the image-diff JSON where the tool measured one; append `after` and set the gap `fixed` with its head — `wish gaps set --id <G<n>> --status fixed --fixed-head <sha>` [omo: `visual-qa`'s pair rule; `wish.mjs gaps`] [receipt: one `after-<gap>-<tree7>` per fixed defect row]
- [ ] 14. TRIAGE: file each pass's findings — a `[defect]` from either pass blocks inside the contract, a `[taste]` is planned only when it rides a defect fix on the same surface; a `NEEDS HUMAN REVIEW` is a finding plus a switch trigger, never an end [omo: session, bugbot trichotomy] [receipt: `triage` event + `findings.tsv` rows]
- [ ] 15. FIX: `skip: no blocking finding`; `mass-ulw` run `wish-<run>-fix-r<n>` with `fix-node`, then `reuse-check` every receipt against H2 — a design receipt is stale when its `tree` or its `env_sha` (the build artifact hash) moved — and re-run only the stale lanes, including a **fresh** double oracle on fresh captures [omo: `mass-ulw` + `reuse-check.mjs`] [receipt: `fix` and `reuse` events]
- [ ] 16. FREEZE: `wish freeze --head <H2>`; the design head carries the build artifact hash as `env_sha`; `wish pr-body --out $ER/pr-body.md` builds the `## Before / After` table from the pairs [omo: session + `wish.mjs`] [receipt: `freeze` event + the before/after table in the body]
- [ ] 17. PR: `gh pr create --base $BASE --head $BR --body-file $ER/pr-body.md`, append `pr_open`, arm `tool.monitor` on `pr-watch.mjs` [omo: `gh` + `tool.monitor`] [receipt: `pr_open` event]
- [ ] 18. ROUND: `wish gate --round <n>`, then one `category: ultrabrain` review whose input is the integrated visual-qa verdict, the pairs, the checklist rows and the diff — it judges the contract and the delivery, and the visual judgment itself stays `visual-qa`'s; `check-verdict.mjs --require-approved` [omo: `wish.mjs gate` + `category: ultrabrain`] [receipt: `receipts/final-r<n>-<head7>.md` + `round` and `verdict` events]
- [ ] 19. REVISE: on `REVISE`, go to `playbooks/revise.md`; a redesign is a `strategy` switch, and an unreachable surface is recorded as `unverified`, never as a defect [omo: as `revise.md` says] [receipt: the `switch` event the round requires]
- [ ] 20. MERGE: after `APPROVED` **and** the visual-qa completion gate — every page's fresh captures passed an independent reviewer, `defect` count 0, taste only — merge and append `merge` [omo: session] [receipt: `merge` event]
- [ ] 21. POST-MERGE: `omo-native-qa-executor` runs what the tree comparison calls for (`../SKILL.md` stage 18) [omo: `omo-native-qa-executor`] [receipt: `post_merge` event + `receipts/post_merge-<tree7>.*`]
- [ ] 22. CHECKPOINT and CLEANUP: ulw-loop `checkpoint`, `omo-native-gate-reviewer` on the evidence record, `wish metrics export`, `memory` for the design classes caught, teardown of captures, browser contexts and worktrees, then append `cleanup` [omo: `ulw-loop` + `omo-native-gate-reviewer` + `metrics.mjs` + `memory`] [receipt: `checkpoint` event then `cleanup` event with ≥1 teardown receipt]

## What the design type enforces

- The `before`/`after` pair per defect row is `../SKILL.md` stage 5's.
- A capture older than the last edit is not evidence; a re-review after a fix is a **fresh** double oracle (`../SKILL.md`, review rule).
- `taste` never blocks; a reviewer that treats taste as a defect is wrong, and the finding is filed as `note` (`../references/defect-classes.md` §5).
- A TUI is captured through a real terminal renderer; a pane dump is not visual evidence.

## Forbidden

Letting one pass review its own fix; dispatching a pass with no fresh captures; treating an unreachable platform as a pass.
