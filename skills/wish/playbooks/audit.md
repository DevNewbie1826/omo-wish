# audit: the wish playbook for a complete register

Type `audit`: enumerate every surface, judge every rule against it, and report. The type's stage set is `../SKILL.md`'s, without BUILD. The register and the report are the deliverable, and the verify wave proves the register **correct** rather than proving a fix. An audit unit carries no `code-review` lane, so its round has no code-review gate.

The audit is also the front half of any program: an audit unit answers "what is wrong and where", and
the fix units follow as their own PRs.

```
ER=<evidence root>   export WISH_EVIDENCE_ROOT=$ER
PLAN=.omo/plans/wish-<slug>.md   WT=<absolute worktree>   BR=<branch>
BASE=<the repository's integration branch for this request>
wish() { bun "$WT/skills/wish/scripts/wish.mjs" "$@"; }
```

`wish init` writes the front matter (`../SKILL.md`, the `intake` row); the body is
appended at this playbook's step 5.

## The steps

- [ ] 1. INTAKE: `wish init --run-id w-<slug>-<yyyymmdd-hhmm> --type audit --tier <S|M|L> --plan $PLAN --worktree $WT --branch $BR --fact "<each fact>"`; the rule corpus and the surface list are the first two facts [omo: session + `todo` + ultrawork tier triage] [receipt: `intake` event]
- [ ] 2. COLLECT: ONE `mass-ulw` run `wish-<run>-collect`: `harvest` reads the rule corpus in full, `extract` turns it into one `L<n>` row per rule with its source anchor by `playbooks/lens.md`'s extract rules (when the corpus is an omo skill, such as `remove-ai-slops` categories, `visual-qa` items or `frontend` rules, reuse its own ids), and `explore` first enumerates **every** surface (every page, screen, route, artifact or file class, not a sample), then reads them against the rules with `explore` lanes plus one `librarian` for outside sources; write `<ER>/collect.md` and append `collect` [omo: `mass-ulw` harvest → extract → explore, `explore` ∥ `librarian`] [receipt: `collect` event + `<ER>/collect.md`]
- [ ] 3. DEFINE: write `<ER>/define.md`: who reads the report, per surface what compliance with its rules looks like, and every rule × surface pair judged `PASS`, `FAIL` or `N/A`; insert each `FAIL` as ONE row with `wish gaps add --tsv -` (`rule`, `kind: defect|taste`, the audit class id); append `define` [omo: session merging the `remove-ai-slops` report-only lane and the `frontend` draft-guard lint] [receipt: `define` event + `<ER>/define.md` + `<ER>/gaps.tsv`, one row per violation]
- [ ] 4. BEFORE: `skip: no defect row` when the register holds none; otherwise record each row's lint output or capture as a `before` event with its `gap_id`; the register row's `before_artifact` is the same file, so the two never disagree [omo: session, or a read-only lane running the corpus' own linter] [receipt: one `before-<gap>-<tree7>` per defect row]
- [ ] 5. PLAN: first read the related skills (`remove-ai-slops`, `frontend`, `programming`) and their references, then write `$PLAN` in the `../references/plan-format.md` grammar: one `RULE:` row per audited rule id, `IS` rows that promise the register's coverage and correctness, `LIMIT` rows for what the audit does not judge, and `DEVICE: lint <command> exit 0` or `DEVICE: spot <n> rows reproduce` per IS; carry (a) and (b) verbatim, and (c) when an audited surface is rendered or a visual QA scenario exists. A plan forces no test code (`../references/plan-format.md` §3) [omo: session; grammar is `ulw-plan`'s checkbox contract] [receipt: `plan` event]

      ```
      (a) Implement it, and also include, strictly, a device that confirms the implementation was done.
      (b) In addition, fix it, and also include, strictly, a device that confirms the fix was made.
      (c) Proceed with ulw-plan, and make the plan include the following: fix this; also include, strictly, a device that confirms the fix was made; and verify the visual QA conditions specifically and in detail, with not a single one omitted.
      ```
- [ ] 6. PLAN-LINT: `bun $WT/skills/wish/scripts/check-plan.mjs $PLAN [--register $ER/gaps.tsv]` must exit 0 [omo: `check-plan.mjs`] [receipt: `plan_lint` event, exit 0]
- [ ] 7. PLAN-REVIEW: one `category: architect` review: is the surface list complete, and does each rule have a decider [omo: `category: architect`] [receipt: `receipts/plan_review-architect-<head7>.md` + `plan_review` event]
- [ ] 8. DECIDE: one decision batch in `<ER>/gates.md`, each entry with a recommended default, added with `wish gate add --id <id> --question <text> --options <a|b> --default <a>` and asked once; append `decide` [omo: session] [receipt: `decide` event + `<ER>/gates.md` entries with a recommended default]
- [ ] 9. GOAL: one paragraph pairing the coverage promise with its devices; register through ulw-loop, write the Boulder record that hands the plan to ulw-execute, then record the BEFORE captures with `recordEvidence({status:"fail"})` [omo: `ulw-loop` goals + Boulder as format only] [receipt: `goal` event]
- [ ] 10. VERIFY-LANE: one `task` batch: `lint` (`quick`, re-run the corpus' own linter and diff its findings against the register), `spot` (`quick`, reproduce a random sample of `n` rows from the register; the register is a claim, and an unreproducible row is a defect), `register-schema` (`quick`, `check-plan.mjs --register` plus the `gaps.tsv` column and pairing rules) [omo: `quick` nodes; `check-plan.mjs` and the corpus linter] [receipt: `lint`, `spot`, `register-schema`, all three]
- [ ] 11. TRIAGE: a row that does not reproduce, a missing rule × surface judgment, or a schema break is a blocking finding; a disagreement with the rule itself is a note or an owner question [omo: session] [receipt: `triage` event + `findings.tsv` rows]
- [ ] 12. FIX: `skip: no blocking finding`; the fix edits the **register or the report**, never the product: `wish gaps set --id <G<n>> --status <...>`, then `reuse-check` the affected receipts, re-running only what went stale [omo: `mass-ulw` fix run for a large correction + `reuse-check.mjs`] [receipt: `fix` and `reuse` events]
- [ ] 13. FREEZE: commit the register and the report first (that commit is the head), then `wish freeze --head <H>`; the register and report hashes travel in the body, written by `wish pr-body --out $ER/pr-body.md` with the register's `## Before` and `## After` [omo: session + `wish.mjs`] [receipt: `freeze` event]
- [ ] 14. PR-OPEN: `gh pr create --base $BASE --head $BR --body-file $ER/pr-body.md`, append `pr_open`, arm `tool.monitor` on `pr-watch.mjs` [omo: `gh` + `tool.monitor`] [receipt: `pr_open` event]
- [ ] 15. ROUND: `wish gate --round <n> --head <H>` (no code-review gate on this type), then one `category: ultrabrain` review that judges **coverage** (every rule × surface pair is decided) and the spot accuracy, not the product's quality; `check-verdict.mjs --require-approved`. On `REVISE`, run `playbooks/revise.md` (DEFINE, PLAN, PLAN-LINT for the cited problem, fix commits in the same PR); for an audit the usual switch is `rediscover`, because a surface group was missed, not a patch miswritten [omo: `wish.mjs gate` + `category: ultrabrain`] [receipt: `receipts/final-r<n>-<head7>.md` + `round` and `verdict` events, plus the `switch` event a REVISE round requires]
- [ ] 16. MERGE: after `APPROVED`, merge and append `merge` [omo: session] [receipt: `merge` event]
- [ ] 17. POST-MERGE: re-check that the merged register equals the frozen one and every `FAIL` row still reproduces [omo: `omo-native-qa-executor` when a command is involved] [receipt: `post_merge` event]
- [ ] 18. CHECKPOINT: ulw-loop `checkpoint`, then `omo-native-gate-reviewer` on the evidence record [omo: `ulw-loop` + `omo-native-gate-reviewer`] [receipt: `checkpoint` event, `checkpoint_op: complete`]
- [ ] 19. CLEANUP: `wish metrics export`, `memory` for the classes and the coverage numbers, teardown, then append `cleanup` [omo: session + `metrics.mjs` + `memory`] [receipt: `cleanup` event with ≥1 teardown receipt]

## What the audit type enforces

- Completeness is the deliverable: a rule that was never judged on a surface is a hole, and `N/A` is a judgment, `PASS` is not a default.
- The register is a claim to verify, not evidence: a spot sample that does not reproduce is a blocking finding.
- An audit never edits the product. A fix it finds belongs to a fix unit (program mode) or to the requester.

## Forbidden

Sampling the surface list; treating "the linter exits 0" as coverage; writing a fix into an audit's branch; leaving a row without a decider.
