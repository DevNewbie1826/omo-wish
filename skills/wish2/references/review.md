# wish2: verification, review, and merge

Covers steps 6-13 of the flow (see SKILL.md, The 13 steps).

## Step 6: Pre-PR verification, two parallel branches

Branch (a), one node: run the repository test suite, then the mutation check. Pick the 3-5 highest-risk changed behaviors (all of them when fewer changed). For each, break the production code with one small edit in a throwaway copy of the worktree, run the tests that should guard it, and record killed (a test failed) or survived (none did). A survivor is a finding for the node that owns that behavior. Behaviors under a valid no-test row get no mutation.

Branch (b), the agent `omo-native-qa-executor`: run the plan's QA scenarios on the real surface. Record per scenario the command, the observable, PASS or FAIL, the output capture, and the cleanup receipt for anything the scenario started. A comparator counts as evidence only when it can fail: run it once on a corrupted or missing input as a failing control, through the same comparison, and capture that failure beside the passing run. A scenario that fails is in scope by definition: fix it before the PR opens.

Both branches must pass before the PR (gate order: SKILL.md, Rules).

## Step 7: Code review round

Run `omo-native-code-reviewer` once per round, before the PR. The reviewer must load and apply the `remove-ai-slops` skill and the `programming` skill, and state in its report whether that check ran. It reports findings by severity CRITICAL, HIGH, MEDIUM, LOW. Fix the CRITICAL and HIGH findings once, then continue; the round gets no second pass. MEDIUM and LOW are notes for the report. In a REVISE round the reviewer sees only the delta diff since the last reviewed commit. Its prompt follows SKILL.md, Delegation prompts.

## Step 8: Open the PR

One PR to the repository's main branch. The body states the behavior delivered, the tests and QA run with their capture paths, and the real limits. Claims stay within what the captures hold; never retype a number or SHA that a capture already holds.

## Step 9: Final review

One review with `category: ultrabrain`, after the PR exists. It reports every CODE defect of the PR in one verdict, never stopping at the first defect, and ends APPROVED or REVISE. Prompt per SKILL.md, Delegation prompts.

## Step 10: Evidence problems

Evidence problems are never a REVISE reason. The verbatim rule, carried by every reviewer prompt, is in SKILL.md, Delegation prompts; apply it from there without restating it.

## Step 11: APPROVED or REVISE

- APPROVED: the working session merges the PR.
- REVISE, code problems only: go back to Step 1 (plan.md) for the cited problems, re-run discovery with the variant sweep, fix in the SAME worktree and SAME PR with more commits, then run steps 6-9 again, with the step-7 review scoped to the delta diff.
- `omo-native-gate-reviewer` runs only when the loop's final checkpoint requires a quality-gate record. It is bounded to checking that the evidence exists, matches the criteria, and fits the schema; it never reopens the product verdict and it follows the evidence rule (SKILL.md, Delegation prompts).

## Step 12: Post-merge verification

After the merge, one full verification pass on the merged result: `omo-native-qa-executor` runs every QA scenario, plus the repository test suite, typecheck, and build where the repository has them. A failing target is a defect of this change: fix and re-verify it, with evidence, before the final report.

## Step 13: Cleanup and final report

- Clean up the task: remove the worktree and the branch, stop owned processes, and record a cleanup receipt for each.
- Complete the goal once the merged result passes step 12.
- Final report: results, evidence locations, limits, and every out-of-scope finding with its follow-up record path (SKILL.md, Purpose boundary). If there were none, say so.

Stop conditions and the report shape: see SKILL.md, Finish.
