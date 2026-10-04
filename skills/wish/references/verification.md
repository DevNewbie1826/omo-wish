# wish: verification, PR, review, and merge

Read this before defining a task's DAG, because the DAG's closing nodes follow it. Those nodes execute after the production nodes settle. It covers the end of every task DAG and the REVISE loop. The stage ends when the task is merged, verified on the merged result, and cleaned up.

## Combined verification

Run the task's QA scenarios through their real surfaces, plus the tests the repository keeps for the changed behavior. Tests alone don't prove the user-visible behavior; each scenario needs its own artifact. Record the command, the observable, PASS or FAIL, and cleanup receipts for anything the QA started.

If a scenario fails, it's in scope by definition. Fix it in the same worktree before opening the PR.

## Evidence reuse per target

Evidence is valid for a target (a scenario, test, or review claim) until something it depends on changes. Before reusing it:

1. Check what changed since capture: the files it exercised, its dependencies, and the environment it ran in. At minimum, treat as affected the tests of every file the change touched and of the files that import it, and the scenarios that exercise them.
2. If none of those changed, reuse it. Keep the original capture's provenance (when, where, which commit) and write down why it's still valid.
3. If any changed, or you can't tell, rerun that target.

Don't invalidate all evidence because one file changed, and don't rerun the full matrix after every patch. The one full pass happens before the final report (see Merge and finish).

## PR

Open one PR for the task after combined verification passes. The body lists the behavior delivered, the tests and QA run, and the real limits. No blanket enforcement claims.

## Final ultrabrain review

After the PR exists, spawn one review with `category: "ultrabrain"`. Pass the original request, the task's scope, the blocker definitions, the diff, the goal and criteria, and the QA artifacts. It ends with APPROVED or REVISE. On REVISE it lists required changes, and each one must show goal failure, an introduced regression, or invalid evidence. Anything else it raises is a follow-up note.

This review is mandatory and isn't replaced by anything below.

## Loop checkpoint gate

The ulw-loop final checkpoint may require a quality-gate record whose reviewer field accepts only certain category literals. If `ultrabrain` isn't accepted there, run one separate audit with an accepted category (the checkpoint doc lists them). Bound it to checking that the evidence exists, matches the criteria, and fits the schema. It isn't a second product review, and it doesn't reopen the ultrabrain verdict.

## REVISE

1. Stay in the same worktree and PR.
2. Build a new mass-ulw correction DAG from the required changes only. The lead **NEVER** applies the fixes directly, even a one-line fix. Independent fixes run in parallel.
3. Rerun the QA that the fixes affect, using the reuse rule above for the rest.
4. End with an ultrabrain delta re-review by a new reviewer, never the one that returned REVISE: the delta diff, the required changes it cited, and fresh evidence for the affected targets. Don't paste an old approval onto changed code, and don't run a fresh whole-project review each round.

Repeat until APPROVED.

## Merge and finish

- Never merge before APPROVED. Merge approved tasks one at a time without waiting on unrelated tasks.
- If integrating with other merges changes a task's behavior, rerun only the affected targets. If the approved implementation changes substantively, get an ultrabrain re-review before merging.
- After all tasks merge, right before the final report, run the full verification set once on the merged result: every QA scenario plus the repository's test suite, typecheck, and build where it has them. Until that point the per-target reuse rule decides what reruns; this one full pass is the only exception. A failing target becomes a fix task through the same flow.
- When the goal is satisfied, remove this wish's worktrees and merged task branches, complete the loop goal, and report to the user in their language.

## Final report checklist

- Results: what was delivered and merged.
- Evidence: the QA scenarios and tests, with artifact locations.
- Limits: what wasn't proven or what the host couldn't do.
- Separate findings: for each out-of-scope finding, the finding, its impact, why it wasn't fixed now, and the follow-up file path recorded in the plan, with a matching memory entry pointing to that same file. If there were none, write that explicitly and create no dummy records. Listing them only in a file doesn't count.
