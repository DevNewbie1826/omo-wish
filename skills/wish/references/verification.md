# wish: verification, PR, review, and merge

This file covers stage 3. Define these closing nodes when you define the task DAG in stage 2, before the DAG starts; they run after the production nodes settle (`SKILL.md`, Stages and required reads).

## Combined verification

Run the task's QA scenarios through their real surfaces, plus the tests the repository keeps for the changed behavior. Tests alone don't prove the user-visible behavior; each scenario needs its own artifact. Record the command, the observable, PASS or FAIL, and cleanup receipts for anything the QA started.

Check the plan's risk list. For every `guard` row, the named test exists and passes, and its injection diff, injection-failure, and restore-pass captures exist, with the diff producing the regression the guard names. For every `no-test` row, the reason is one of the allowed ones and any QA scenario it names passed. A missing guard test, a missing capture, an injection that doesn't produce the guard's regression, an injection that stayed green, or a `no-test` reason outside the list is invalid evidence. An untested behavior that isn't on the list is a follow-up note, unless it shows the request isn't delivered or this change introduced a regression.

If a scenario fails, it's in scope by definition. Fix it in the same worktree before opening the PR.

## Evidence reuse per target

Evidence is valid for a target (a scenario, test, or review claim) until something it depends on changes. Before reusing it:

1. Check what changed since capture: the files it exercised, its dependencies, and the environment it ran in. At minimum, treat as affected the tests of every file the change touched and of the files that import it, and the scenarios that exercise them.
2. If none of those changed, reuse it. Keep the original capture's provenance (when, where, which commit) and write down why it's still valid.
3. If any changed, or you can't tell, rerun that target.

Don't invalidate all evidence because one file changed, and don't rerun the full matrix after every patch. The one full pass happens before the final report (see Merge and finish).

## PR

Follow `SKILL.md` rule 6 and Task shape for PR timing and shape. The body lists the behavior delivered, the tests and QA run, and the real limits. No blanket enforcement claims.

## Final ultrabrain review

After the PR exists, spawn one review with `category: "ultrabrain"`. Follow `SKILL.md`, Delegation prompts, and pass the diff, the goal and criteria, the plan's risk list, and the QA artifacts. It ends with APPROVED or REVISE. On REVISE it lists required changes, and each one must show goal failure, an introduced regression, or invalid evidence, including risk-list evidence that fails the check under Combined verification. Anything else it raises is a follow-up note.

This review is mandatory and isn't replaced by anything below.

## Loop checkpoint gate

The ulw-loop final checkpoint may require a quality-gate record whose reviewer field accepts only certain category literals. If `ultrabrain` isn't accepted there, run one separate audit with an accepted category (the checkpoint doc lists them). Bound it to checking that the evidence exists, matches the criteria, and fits the schema. It isn't a second product review, and it doesn't reopen the ultrabrain verdict.

## REVISE

1. Follow `SKILL.md`, Task shape and Stages and required reads, for the correction run's worktree and PR.
2. Build a new mass-ulw correction run from the required changes only, under `SKILL.md` rule 4. Independent fixes run in parallel.
3. Rerun the QA that the fixes affect, using the reuse rule above for the rest.
4. End with an ultrabrain delta re-review by a new reviewer, never the one that returned REVISE: the delta diff, the required changes it cited, and fresh evidence for the affected targets. Don't paste an old approval onto changed code, and don't run a fresh whole-project review each round.

Repeat until APPROVED. There is no round limit; see the owner policy in `SKILL.md`, Native skills and mode.

## Merge and finish

- Follow `SKILL.md` rule 6 and Task shape for approved merges.
- If integrating with other merges changes a task's behavior, rerun only the affected targets. If the approved implementation changes substantively, get an ultrabrain re-review by a new reviewer before merging.
- After all tasks merge, right before the final report, run the full verification set once on the merged result: every QA scenario plus the repository's test suite, typecheck, and build where it has them. Until that point the per-target reuse rule decides what reruns; this one full pass is the only exception. Record loop evidence and the final checkpoint from this final pass so the loop's tree-hash rule is satisfied. For a failing target, follow `SKILL.md`, Task shape, for post-merge continuation.
- When the goal is satisfied, perform the cleanup in `SKILL.md`, Finish, complete the loop goal, and deliver the report below.

## Final report checklist

- Results: what was delivered and merged.
- Evidence: the QA scenarios and tests, with artifact locations.
- Limits: what wasn't proven or what the host couldn't do.
- Separate findings: follow `SKILL.md`, Follow-up record.
