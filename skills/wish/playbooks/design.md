# design: the wish playbook for rendered surfaces

Type `design`: web UI, TUI, slides, documents, images, anything a person looks at. wish does not
re-implement the visual work: `frontend` builds inside the BUILD nodes and `visual-qa` verifies inside
the verify wave, both with their own prompts. wish adds the contract, one head, the register, the
before/after pairs and the verdict. Read `../SKILL.md` first; copy these steps into `todo` verbatim.

```
ER=<evidence root>   export WISH_EVIDENCE_ROOT=$ER
PLAN=.omo/plans/wish-<slug>.md   WT=<absolute worktree>   BR=<branch>
BASE=<the repository's integration branch for this request>
wish() { bun "$WT/skills/wish/scripts/wish.mjs" "$@"; }
```

The before matrix is `visual-qa`'s: each case × `{390, 1440}` (add 1920 when the surface has it) ×
light/dark, plus the scroll end and each interaction frame. `wish init` writes the front matter (`../SKILL.md`, the `intake` row); the body is appended at this playbook's step 5.

## The steps

- [ ] 1. INTAKE: `wish init --run-id w-<slug>-<yyyymmdd-hhmm> --type design --tier <S|M|L> --plan $PLAN --worktree $WT --branch $BR --fact "<each fact>"`; the design surface list is the first fact [omo: session + `todo` + ultrawork tier triage] [receipt: `intake` event with `tier` and `facts`]
- [ ] 2. COLLECT: ONE `mass-ulw` run `wish-<run>-collect` with `harvest`, `extract` and `explore` nodes; the `visual-qa` checklist `A1`–`J2` and the `frontend` build rules are the first harvested sources, a named design corpus is read with `playbooks/lens.md`'s extract rules, `explore` lanes go one per surface group and return surfaces, states and current behavior (never a fix), and one `librarian` covers outside design sources; write `<ER>/collect.md` and append `wish ledger append --event collect --json -` with `{"event":"collect","sources":<number of sources read>,"elements":<number of extracted elements>,"report":"$ER/collect.md"}`; the stage completes only when `elements` is positive, because an empty extraction is not a collection [omo: `mass-ulw` harvest → extract → explore, `explore` ∥ `librarian`, `visual-qa` and `frontend` as the first sources] [receipt: `collect` event + `<ER>/collect.md`]
- [ ] 3. DEFINE: write `<ER>/define.md`: the end user, the journey, per surface the ideal state and the collected rules it must instantiate, and every rule × surface difference, then insert each as ONE register row with `wish gaps add --tsv -` (`kind: defect|taste`, `rule: L<n>|skill:<skill>:<code>`); the boundary is `../references/contract.md` §3; append `define` [omo: session merging the `remove-ai-slops` report-only lane and the `frontend` draft-guard lint] [receipt: `define` event + `<ER>/define.md` + `<ER>/gaps.tsv`]
- [ ] 4. BEFORE: `skip: no defect row` when the register holds none; otherwise take each defect row's pre-edit capture across the before matrix and append a `before` event with its `gap_id` [omo: `capture-lane` prompt; a TUI captures through the xterm.js web terminal, never a pane dump] [receipt: one `before-<gap>-<tree7>` capture and JSON per defect row]
- [ ] 5. PLAN: first read `remove-ai-slops`, `frontend`, `programming` and `visual-qa` with their references, then write `$PLAN` in the `../references/plan-format.md` grammar: one `SCREEN:` row per surface (the frontend brief: the one primary action, priorities 1–3, what a generated version would add and this one will not, every required input and label, the `Layout:` line), `IS`/`COMPANION`/`INVARIANT`/`LIMIT` rows, `QA-n` rows that drive a real interaction and end in `run:`, and one `DEVICE: vqa <item ids> @ <matrix cells> pair <case>-<state>-<width>-<theme>` per IS, so every visual-QA condition is verified and none is omitted; decide the unit split here; carry these sentences verbatim, (c) always on this type. A plan forces no test code (`../references/plan-format.md` §3) [omo: session; grammar is `ulw-plan`'s checkbox contract] [receipt: `plan` event]

      ```
      (a) Implement it, and also include, strictly, a device that confirms the implementation was done.
      (b) In addition, fix it, and also include, strictly, a device that confirms the fix was made.
      (c) Proceed with ulw-plan, and make the plan include the following: fix this; also include, strictly, a device that confirms the fix was made; and verify the visual QA conditions specifically and in detail, with not a single one omitted.
      ```
- [ ] 6. PLAN-LINT: `bun $WT/skills/wish/scripts/check-plan.mjs $PLAN [--register $ER/gaps.tsv]` must exit 0; a `code` device on a `design` plan is a complaint [omo: `check-plan.mjs`] [receipt: `plan_lint` event, exit 0]
- [ ] 7. PLAN-REVIEW: one `category: architect` review of the contract (does each `SCREEN` row promise what the request needs, is every visual-QA condition carried by a device, is every limit real); `plan-reviewer` only in the ulw-plan branch [omo: `category: architect`] [receipt: `receipts/plan_review-architect-<head7>.md` + `plan_review` event]
- [ ] 8. DECIDE: one decision batch in `<ER>/gates.md`, each entry with a recommended default, added with `wish gate add --id <id> --question <text> --options <a|b> --default <a>` and asked once; append `decide` [omo: session] [receipt: `decide` event + `<ER>/gates.md` entries with a recommended default]
- [ ] 9. GOAL: one paragraph per unit pairing the `SCREEN` and `IS` rows with their devices; register through ulw-loop, write the Boulder record that hands the plan to ulw-execute, then record the BEFORE captures with `recordEvidence({status:"fail"})` [omo: `ulw-loop` goals + Boulder as format only] [receipt: `goal` event]
- [ ] 10. BUILD: restate this sentence verbatim before dispatching any build lane, then `mass-ulw` run `wish-<run>-build`: one PR per independently verifiable unit with a disjoint write scope, several commits inside it, a `## Before` and an `## After` in each PR body, and a one-unit request stays one PR; a design node runs `frontend`'s brief → build → **subtract** → verify order and ends with the draft-guard checker at exit 0 on its own output; one node owns its change and its proof, the commit node loads `git-master` [omo: `mass-ulw` + the `frontend` skill inside each node] [receipt: `build` events + `receipts/build-<node>.json`]

      ```
      (d) After that, don't ask the requester. Proceed exactly as written in this content with mass-ulw, ulw-loop, and ulw-execute, at maximum parallelism, verifying rigorously. Deliver the work as several pull requests, include the before/after directly inside each pull request, and make the improvements clearly visible. As you proceed, report status to the requester very frequently, every time, saying how much of the whole work is done and which parts are done.
      ```
- [ ] 11. VERIFY-LANE: two `task` batches at head H1. Batch 1: `draft-guard` (`quick`, `sweep.mjs --root $WT --config $ER/sweep.json --probe draft-guard --lane draft-guard --unit <u> --type design --receipt $ER/receipts`), `capture` (the full matrix on the **post-edit** build; a capture older than the last edit is not evidence), `code-review` (`omo-native-code-reviewer` on the implementation diff, with `remove-ai-slops` and `programming`), and `qa` (`omo-native-qa-executor` driving the interactions and state transitions); then batch 2, at the same head and only once those captures exist, runs `vqa-passA` and `vqa-passB` (both `unspecified-high`, read-only, fresh reviewers, prompts verbatim from `../references/prompts.md`, which already carry the extended-budget sentence that makes a cap an approach switch), each checking every visual-QA condition the plan carries. Each writes its own receipt: `vqa-passA-<head7>`, `vqa-passB-<head7>`, `vqa-capture-<head7>`, or `verify_lane-<lane>-<head7>.json` for `draft-guard`, `code-review` and `qa` [omo: two `task` batches: `quick` draft-guard, `omo-native-qa-executor`, two `unspecified-high` visual-qa passes, `omo-native-code-reviewer`] [receipt: `draft-guard`, `capture`, `vqa-passA`, `vqa-passB`, `code-review`, `qa`, all six]
- [ ] 12. TRIAGE: file each pass's findings; a `[defect]` from either pass blocks inside the contract, a `[taste]` is planned only when it rides a defect fix on the same surface, and a `NEEDS HUMAN REVIEW` is a finding plus a switch trigger, never an end [omo: session, bugbot trichotomy] [receipt: `triage` event + `findings.tsv` rows]
- [ ] 13. FIX: `skip: no blocking finding`; `mass-ulw` run `wish-<run>-fix-r<n>` with `fix-node`, then `reuse-check` every receipt against H2 (a design receipt is stale when its `tree` or its `env_sha`, the build artifact hash, moved) and re-run only the stale lanes, including a **fresh** double oracle on fresh captures [omo: `mass-ulw` + `reuse-check.mjs`] [receipt: `fix` and `reuse` events]
- [ ] 14. FREEZE: for each fixed gap produce `after-<gap>-<tree7>.png` and the pair image `<case>-<state>-<width>-<theme>-pair.png` (plus the image-diff JSON where the tool measured one), append `after`, and set the row with `wish gaps set --id <G<n>> --status fixed --fixed-head <sha>`; then `wish freeze --head <H2>` (the design head carries the build artifact hash as `env_sha`) and `wish pr-body --out $ER/pr-body.md`, which builds the `## Before` / `## After` table from the pairs [omo: session + `wish.mjs`; `visual-qa`'s pair rule] [receipt: `freeze` event + one `after-<gap>-<tree7>` per fixed defect row + the before/after table in the body]
- [ ] 15. PR-OPEN: `gh pr create --base $BASE --head $BR --body-file $ER/pr-body.md`, append `pr_open`, arm `tool.monitor` on `pr-watch.mjs` [omo: `gh` + `tool.monitor`] [receipt: `pr_open` event]
- [ ] 16. ROUND: `wish gate --round <n> --head <H2>` refuses the dispatch (exit 3) unless a valid `code-review` receipt exists at the frozen head; then one `category: ultrabrain` review whose input is the integrated visual-qa verdict, the pairs, the checklist rows and the diff (it judges the contract and the delivery; the visual judgment stays `visual-qa`'s); `check-verdict.mjs --require-approved`. On `REVISE`, run `playbooks/revise.md` (DEFINE, PLAN, PLAN-LINT for the cited problem, fix commits in the same PR); a redesign is a `strategy` switch, and an unreachable surface is recorded as `unverified`, never as a defect [omo: `wish.mjs gate` + `category: ultrabrain`] [receipt: `receipts/final-r<n>-<head7>.md` + `round` and `verdict` events, plus the `switch` event a REVISE round requires]
- [ ] 17. MERGE: after `APPROVED` **and** the visual-qa completion gate (every page's fresh captures passed an independent reviewer, `defect` count 0, taste only), merge and append `merge` [omo: session] [receipt: `merge` event]
- [ ] 18. POST-MERGE: `omo-native-qa-executor` runs what the tree comparison calls for (`../SKILL.md`, the `post_merge` row) [omo: `omo-native-qa-executor`] [receipt: `post_merge` event + `receipts/post_merge-<tree7>.*`]
- [ ] 19. CHECKPOINT: ulw-loop `checkpoint`, then `omo-native-gate-reviewer` on the evidence record [omo: `ulw-loop` + `omo-native-gate-reviewer`] [receipt: `checkpoint` event, `checkpoint_op: complete`]
- [ ] 20. CLEANUP: `wish metrics export`, `memory` for the design classes caught, teardown of captures, browser contexts and worktrees, then append `cleanup` [omo: session + `metrics.mjs` + `memory`] [receipt: `cleanup` event with ≥1 teardown receipt]

## What the design type enforces

- The `before`/`after` pair per defect row is `../SKILL.md`'s.
- Every visual-QA condition the plan carries is verified by a pass; none is omitted, and an unchecked condition is a finding.
- A capture older than the last edit is not evidence; a re-review after a fix is a **fresh** double oracle (`../SKILL.md`, review rule).
- `taste` never blocks; a reviewer that treats taste as a defect is wrong, and the finding is filed as `note` (`../references/defect-classes.md` §5).
- A TUI is captured through a real terminal renderer; a pane dump is not visual evidence.

## Forbidden

Letting one pass review its own fix; dispatching a pass with no fresh captures; treating an unreachable platform as a pass.
