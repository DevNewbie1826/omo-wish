# wish: verification, review, and merge

Covers steps 6-13 of the flow (see SKILL.md, The 13 steps).

## Step 6: Pre-PR verification, two parallel branches

A failure that touches no IS or COMPANION row and fails the same way on the base commit (both runs captured) goes to the follow-up file and the final report; every other failure, and any check that could not run, is fixed and rerun before the PR.

Branch (a), one node: run the repository test suite, then the mutation check. Pick the 3-5 highest-risk changed behaviors (all of them if fewer changed). For each, break the production code with one small edit in a throwaway copy of the worktree, run the tests that should guard it, and record killed or survived. A mutation is killed only when its guard test passes unmutated and fails under the mutation; a run that fails for any other reason is not a kill. A survivor means a regression would pass unnoticed: strengthen that behavior's guard test until the mutation is killed, or record a no-test reason in the plan's risk list. Branch (a) passes when every failure is fixed or sent to the follow-up file under the rule above, and every mutation is killed or resolved this way. Behaviors under a valid no-test row get no mutation.

Branch (b), the agent `omo-native-qa-executor`: run each plan scenario's happy case and failure case on the real surface. Record per scenario the command, the observable, PASS or FAIL, the output capture, and the cleanup receipt for anything the scenario started. A failing scenario follows the rule above.

Both branches must pass before the PR (gate order: SKILL.md, Rules).

## Step 7: Code review round

Run `omo-native-code-reviewer` once per round, before the PR. The reviewer must load and apply the `remove-ai-slops` skill and the `programming` skill, and state in its report whether that check ran. It reports findings by severity CRITICAL, HIGH, MEDIUM, LOW. Fix the CRITICAL and HIGH findings once, then continue; the round gets no second pass. MEDIUM and LOW are notes for the report. In a REVISE round the reviewer sees only the delta diff since the last reviewed commit. Its prompt follows SKILL.md, Delegation prompts.

## Step 8: Open the PR

One PR to the repository's main branch. The body states the behavior delivered, the tests and QA run with their capture paths, and the real limits. Claims stay within what the captures hold; never retype a number or SHA that a capture already holds.

## Step 9: Final review

One review with `category: ultrabrain`, after the PR exists. It reports every CODE defect of the PR in one verdict, never stopping at the first defect, and ends APPROVED or REVISE. Its prompt follows SKILL.md, Delegation prompts.

## Step 10: Evidence problems

Evidence problems are never a REVISE reason. Copy the reviewer sentence from SKILL.md, Delegation prompts, into every reviewer prompt without restating it; the memos are handled as SKILL.md step 10 says.

## Step 11: APPROVED or REVISE

- APPROVED: merge the PR yourself.
- REVISE, code problems only: go back to Step 1 (plan.md) for the cited problems: re-run discovery with the variant sweep; update the plan (Step 2: a COMPANION row for each in-scope variant, a risk row for each fix); run the fixes as a mass-ulw correction run under run.md, Step 5, in the SAME worktree and SAME PR with more commits; then run steps 6, 7 (delta diff), 8 (update the PR body), and 9 again, in that order: step 9 starts only after step 7's CRITICAL and HIGH fixes are committed and pushed, so the final review judges the final head. Steps 3 and 4 are not repeated: the plan review is one round and the goal already exists.
- `omo-native-gate-reviewer` runs only when the loop's final checkpoint requires a quality-gate record. It is bounded to checking that the evidence exists, matches the criteria, and fits the schema; it never reopens the product verdict and it follows the evidence rule (SKILL.md, Delegation prompts).

## Step 12: Post-merge verification

After the merge, one full verification pass on the merged result: `omo-native-qa-executor` runs every QA scenario, plus the repository test suite, typecheck, and build where the repository has them. A failure follows the Step 6 rule; a fix goes through steps 5-11 again from the merged base, never as a direct patch to main.

## Step 13: Cleanup and final report

- Clean up the task: remove the worktree and the branch, stop owned processes, and record a cleanup receipt for each.
- Complete the goal once the merged result passes step 12.
- Final report: results, evidence locations, limits, and every out-of-scope finding with its follow-up record path (SKILL.md, Purpose boundary). If there were none, say so.

Stop conditions and the report shape: see SKILL.md, Finish.
