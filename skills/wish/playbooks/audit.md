# audit — the wish v2 playbook for a complete register

Type `audit`: enumerate every surface, judge every rule against it, and report. **There is no BUILD** —
`status` skips `build` for this type. The register and the report are the deliverable, and the verify
wave proves the register **correct** rather than proving a fix.

The audit is also the front half of any program: an audit unit answers "what is wrong and where", and
the fix units follow as their own PRs.

```
ER=<evidence root>   export WISH_EVIDENCE_ROOT=$ER
PLAN=.omo/plans/wish-<slug>.md   WT=<absolute worktree>   BR=<branch>   BASE=wish-v2
wish() { bun "$WT/skills/wish/scripts/wish.mjs" "$@"; }
```

`wish init` creates `$PLAN` when it does not exist — never pre-create an empty file — and the body is
appended at this playbook's step 7.

## The steps

- [ ] 1. INTAKE: `wish init --run-id w-<slug>-<yyyymmdd-hhmm> --type audit --tier <S|M|L> --plan $PLAN --worktree $WT --branch $BR --fact "<each fact>"`; the rule corpus and the surface list are the first two facts [omo: session + `todo` + ultrawork tier triage] [receipt: `intake` event]
- [ ] 2. LENS: the rule corpus **is** the lens — one `L<n>` row per rule it defines, with its source anchor; when the corpus is an omo skill (`remove-ai-slops` categories, `visual-qa` items, `frontend` rules) reuse its own ids instead of inventing rows [omo: `mass-ulw` lens run only when the corpus is a document set; otherwise session] [receipt: `lens` event + `<ER>/lens.md`]
- [ ] 3. DISCOVER: enumerate **every** surface first — every page, screen, route, artifact or file class, not a sample; then `explore` lanes read them against the lens questions [omo: `explore` ∥ `librarian`] [receipt: `discover` event + `receipts/discover-<lane>.md`]
- [ ] 4. IDEAL: one paragraph per surface describing what compliance with its rules looks like [omo: session] [receipt: `ideal` event + `<ER>/ideal.md`]
- [ ] 5. GAP: every rule × surface pair gets `PASS`, `FAIL` or `N/A` (a surface with no instance of a rule is `N/A`, never `PASS`); for each `FAIL` take the lint output or capture first and then insert ONE row — `wish gaps add --tsv -` with `rule`, `kind: defect|taste`, the audit class id and `before_artifact` set, because `gaps set` cannot add an artifact and `gaps add` refuses a duplicate id [omo: session merging the `remove-ai-slops` report-only lane and the `frontend` draft-guard lint] [receipt: `gap` events + `<ER>/gaps.tsv` — one row per violation]
- [ ] 6. BEFORE: record each artifact from step 5 as a `before` event with its `gap_id`; the register row's `before_artifact` is the same file, so the two never disagree [omo: session, or a read-only lane running the corpus' own linter] [receipt: one `before-<gap>-<tree7>` per defect row]
- [ ] 7. PLAN: write `$PLAN` with one `RULE:` row per audited rule id, `IS` rows that promise the register's coverage and correctness, `LIMIT` rows for what the audit does not judge, and `DEVICE: lint <command> exit 0` or `DEVICE: spot <n> rows reproduce` per IS [omo: session; grammar from `../references/plan-format.md` §4.6 and §5.2] [receipt: `plan` event]
- [ ] 8. PLAN-LINT: `bun $WT/skills/wish/scripts/check-plan.mjs $PLAN --register $ER/gaps.tsv` must exit 0 [omo: `check-plan.mjs`] [receipt: `plan_lint` event, exit 0]
- [ ] 9. PLAN-REVIEW: one `category: architect` review — is the surface list complete, and does each rule have a decider [omo: `category: architect`] [receipt: `receipts/plan_review-architect-<head7>.md` + `plan_review` event]
- [ ] 10. GOAL: one paragraph pairing the coverage promise with its devices; register through ulw-loop [omo: `ulw-loop` goals + Boulder as format only] [receipt: `goal` event]
- [ ] 11. BUILD: `skip: audit has no build` — the register is the artifact, and nothing in this type edits the product [omo: none; `status` skips this stage for `audit`] [receipt: none]
- [ ] 12. VERIFY-WAVE: one `task` batch — `lint` (`quick`, re-run the corpus' own linter and diff its findings against the register), `spot` (`quick`, reproduce a random sample of `n` rows from the register — the register is a claim, and an unreproducible row is a defect), `register-schema` (`quick`, `check-plan.mjs --register` plus the `gaps.tsv` column and pairing rules) [omo: `quick` nodes; `check-plan.mjs` and the corpus linter] [receipt: `lint`, `spot`, `register-schema` — all three]
- [ ] 13. TRIAGE: a row that does not reproduce, a missing rule × surface judgment, or a schema break is a blocking finding; a disagreement with the rule itself is a note or an owner question [omo: session] [receipt: `triage` event + `findings.tsv` rows]
- [ ] 14. FIX: `skip: no blocking finding`; the fix edits the **register or the report**, never the product — `wish gaps set --id <G<n>> --status <...>`, then `reuse-check` the affected receipts, re-running only what went stale [omo: `mass-ulw` fix run for a large correction + `reuse-check.mjs`] [receipt: `fix` and `reuse` events]
- [ ] 15. FREEZE: `wish freeze --head <H>`; the register and the report hashes travel in the body [omo: session + `wish.mjs`] [receipt: `freeze` event]
- [ ] 16. PR: commit the register and the report, `gh pr create --base $BASE --head $BR --body-file $ER/pr-body.md`, append `pr_open` [omo: `gh` + `tool.monitor`] [receipt: `pr_open` event]
- [ ] 17. ROUND: `wish gate --round <n>`, then one `category: ultrabrain` review — it judges **coverage** (every rule × surface pair is decided) and the spot accuracy, not the product's quality; `check-verdict.mjs --require-approved` [omo: `wish.mjs gate` + `category: ultrabrain`] [receipt: `receipts/final-r<n>-<head7>.md` + `round` and `verdict` events]
- [ ] 18. REVISE: on `REVISE`, go to `playbooks/revise.md`; for an audit the usual switch is `rediscover` — a surface group was missed, not a patch miswritten [omo: as `revise.md` says] [receipt: the `switch` event the round requires]
- [ ] 19. MERGE: after `APPROVED`, merge and append `merge` [omo: session] [receipt: `merge` event]
- [ ] 20. POST-MERGE: re-check that the merged register equals the frozen one and every `FAIL` row still reproduces [omo: `omo-native-qa-executor` when a command is involved] [receipt: `post_merge` event]
- [ ] 21. CHECKPOINT and CLEANUP: ulw-loop `checkpoint`, `omo-native-gate-reviewer`, `wish metrics export`, `memory` for the classes and the coverage numbers, teardown, then append `cleanup` [omo: `ulw-loop` + `omo-native-gate-reviewer` + `metrics.mjs` + `memory`] [receipt: `checkpoint` event then `cleanup` event with ≥1 teardown receipt]

## What the audit type enforces

- Completeness is the deliverable: a rule that was never judged on a surface is a hole, and `N/A` is a judgment, `PASS` is not a default.
- The register is a claim to verify, not evidence: a spot sample that does not reproduce is a blocking finding.
- An audit never edits the product. A fix it finds belongs to a fix unit (program mode) or to the requester.

## Forbidden

Sampling the surface list; treating "the linter exits 0" as coverage; writing a fix into an audit's branch; leaving a row without a decider.