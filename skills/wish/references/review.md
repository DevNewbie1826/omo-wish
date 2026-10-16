# wish: verification, review, and merge

Covers steps 6-13 of the flow (see SKILL.md, The 13 steps).

## Step 6: Pre-PR verification, two parallel branches

Classify every failing test, scenario, or check before acting on it:
- In scope: it shows an IS or COMPANION row not delivered (including a pre-existing bug the plan lists and a same-pattern sibling that passes the companion guards), or a regression this change introduced. Fix it in this task.
- Environment: the check could not run as intended (a missing tool, install, credential, network, or service). Restore the prerequisite and rerun the affected check. Until it runs and passes, the criterion it proves is not met; never record it as PASS.
- Unrelated: a pre-existing failure that touches no IS or COMPANION row and that this change did not introduce. Record it in the follow-up file and the final report and leave it unfixed. It does not block the PR, the merge, or completion only when the same check fails the same way on the base commit, with both runs captured. A scenario that proves an IS or COMPANION row is never unrelated: it must pass.

Branch (a), one node: run the repository test suite, then the mutation check. Pick the 3-5 highest-risk changed behaviors (all of them if fewer changed). For each, break the production code with one small edit in a throwaway copy of the worktree, run the tests that should guard it, and record killed or survived. A mutation counts as killed only when the guard test chosen for that behavior passes on the unmutated copy, fails at its regression assertion under the mutation, and passes again after restore; a failure that was already present before the mutation, or an environment error, is not a kill. A survivor means a regression would pass unnoticed: add or strengthen that behavior's guard test in the same worktree, with the injection check of run.md, before the PR, or record a valid no-test reason in the plan's risk list. Branch (a) passes when every failure is fixed or classified unrelated under the rule above, and every mutation is killed or resolved this way. Behaviors under a valid no-test row get no mutation.

Branch (b), the agent `omo-native-qa-executor`: run the plan's QA scenarios on the real surface. Record per scenario the command, the observable, PASS or FAIL, the output capture, and the cleanup receipt for anything the scenario started. A comparator counts as evidence only when it can fail: run it once on a corrupted or missing input as a failing control, through the same comparison, and capture that failure beside the passing run. Classify a failing scenario under the rule above; an in-scope failure is fixed before the PR opens.

Both branches must pass before the PR (gate order: SKILL.md, Rules).

## Step 7: Code review round

Run `omo-native-code-reviewer` once per round, before the PR. The reviewer must load and apply the `remove-ai-slops` skill and the `programming` skill, and state in its report whether that check ran. It reports findings by severity CRITICAL, HIGH, MEDIUM, LOW. Fix the CRITICAL and HIGH findings once, then continue; the round gets no second pass. MEDIUM and LOW are notes for the report. In a REVISE round the reviewer sees only the delta diff since the last reviewed commit. Its prompt follows SKILL.md, Delegation prompts.

## Step 8: Open the PR

One PR to the repository's main branch. The body states the behavior delivered, the tests and QA run with their capture paths, and the real limits. Claims stay within what the captures hold; never retype a number or SHA that a capture already holds.

## Step 9: Final review

One review with `category: ultrabrain`, after the PR exists. It reports every CODE defect of the PR in one verdict, never stopping at the first defect, and ends APPROVED or REVISE. Its prompt follows SKILL.md, Delegation prompts.

## Step 10: Evidence problems

Evidence problems are never a REVISE reason. The verbatim rule, carried by every reviewer prompt, is in SKILL.md, Delegation prompts; apply it from there without restating it.

## Step 11: APPROVED or REVISE

- APPROVED: the working session merges the PR.
- REVISE, code problems only: go back to Step 1 (plan.md) for the cited problems: re-run discovery with the variant sweep; update the plan (Step 2: a COMPANION row for each in-scope variant, a risk row for each fix); run the fixes as a mass-ulw correction run under run.md, Step 5, in the SAME worktree and SAME PR with more commits; then run steps 6, 7 (delta diff), 8 (update the PR body), and 9 again. Steps 3 and 4 are not repeated: the plan review is one round and the goal already exists.
- `omo-native-gate-reviewer` runs only when the loop's final checkpoint requires a quality-gate record. It is bounded to checking that the evidence exists, matches the criteria, and fits the schema; it never reopens the product verdict and it follows the evidence rule (SKILL.md, Delegation prompts).

## Step 12: Post-merge verification

After the merge, one full verification pass on the merged result: `omo-native-qa-executor` runs every QA scenario, plus the repository test suite, typecheck, and build where the repository has them. Classify a failing target under the rule in Step 6. An in-scope failure is fixed and re-verified, with evidence, before the final report, through a new worktree off the merged base and its own PR under steps 5-11; never patch main directly. An environment failure is restored and rerun. An unrelated failure goes to the follow-up file and the final report. Step 13's cleanup runs after that PR merges and passes this step.

## Step 13: Cleanup and final report

- Clean up the task: remove the worktree and the branch, stop owned processes, and record a cleanup receipt for each.
- Complete the goal once the merged result passes step 12.
- Final report: results, evidence locations, limits, and every out-of-scope finding with its follow-up record path (SKILL.md, Purpose boundary). If there were none, say so.

Stop conditions and the report shape: see SKILL.md, Finish.
