# wish: verification, review, and merge

Covers steps 6-13 of the flow (see SKILL.md, The 13 steps).

## Step 6: Pre-PR verification, two parallel branches

A failure that touches no IS or COMPANION row and fails the same way on the base commit (both runs captured) goes to the follow-up file and the final report; every other failure, and any check that could not run, is fixed and rerun before the PR.

Branch (a), one node: run the repository test suite, then the mutation check. Make one mutation per guard row of the plan's risk list: break the production code the row guards with one small edit in a throwaway copy of the worktree, run that row's guard test, and record killed or survived for the row. A mutation is killed only when its guard test passes unmutated and fails under the mutation; a run that fails for any other reason is not a kill. A survivor means a regression would pass unnoticed: strengthen that row's guard test until the mutation is killed, or record a no-test reason in the plan's risk list. Branch (a) passes when every failure is fixed or sent to the follow-up file under the rule above, and every mutation is killed or resolved this way. Behaviors under a valid no-test row get no mutation.

Branch (b), the agent `omo-native-qa-executor`: run each plan scenario's happy case and failure case on the real surface. Record per scenario the command, the observable, PASS or FAIL, the output capture, and the cleanup receipt for anything the scenario started. A failing scenario follows the rule above.

Run the relevant first-use and resume paths through the shipped composition, with the same input and event routes a user takes, and include process exit and owned-resource cleanup. A missing surface is a failure, not a reason to test only the surfaces already implemented. Mark external authentication or unavailable platforms unverified when only a local fixture was exercised.

Both branches must pass before the PR (gate order: SKILL.md, Rules).

## Step 7: Code review round

Run `omo-native-code-reviewer` once per round, before the PR. The reviewer must load and apply the `remove-ai-slops` skill and the `programming` skill, and state in its report whether that check ran. It reports findings by severity CRITICAL, HIGH, MEDIUM, LOW. Severity ranks a finding; it does not decide whether it blocks. Apply the finite-contract blocker rule of Step 10. Fix every reproduced in-contract code blocker once, then continue without a second code-review pass. All other findings remain notes. In a REVISE round the reviewer sees only the delta diff since the last reviewed commit. Its prompt follows SKILL.md, Delegation prompts.

## Step 8: Open the PR

One PR to the repository's main branch. The body states the behavior delivered, the tests and QA run with their capture paths, and the real limits. Claims stay within what the captures hold; never retype a number or SHA that a capture already holds.

Take the head SHA, commands, exit codes, counts, and the base each result is attributed to from their captures; label claims about earlier heads as history, separate from final-head claims, and keep the source reports until step 13 cleanup.

## Step 9: Final review

One review with `category: ultrabrain`, after the PR exists. It reports every CODE defect of the PR in one verdict, never stopping at the first defect, and ends APPROVED or REVISE. Its prompt follows SKILL.md, Delegation prompts. A test finding blocks only under Step 10's test-finding rule, and a round whose only findings are non-blocking test memos ends APPROVED with the memos recorded.

## Step 10: Evidence problems

Evidence problems are never a REVISE reason, and neither is a finding outside the plan's finite contract (invariants, known limits, IS and COMPANION rows): such a finding is a note for the report or a follow-up record. Copy the reviewer sentences from SKILL.md, Delegation prompts, into every reviewer prompt without restating them; the memos are handled as SKILL.md step 10 says.

### Test-code findings

A finding about TEST code (a test file, a test helper, a fixture, a QA or mutation harness, or a plan row that only adds a test) blocks only when the report carries a reproduction of one of:

- (a) a production defect the test exposes: the failing command and its output on the PR head;
- (b) a guard mutation that survives: the edit that removes the guard, the guard test that still passes under it, and the restored run that passes unmutated;
- (c) a vacuous or flaky test: the run where the assertion cannot fail, or the reproduction of the flake.

A test that an IS or COMPANION row requires and that is absent altogether is that row not delivered: it blocks as a row, with the row's id and the path or command showing where the test is missing. That is the only test finding that blocks without one of the three reproductions.

Every other test finding is a non-blocking memo: style, naming, structure, coverage that no IS or COMPANION row requires, or an opinion that an assertion should be stronger. The reviewer records it in the report and it never makes the verdict REVISE. A round whose only findings are those memos is APPROVED with the memos recorded in the report and the PR body.

This rule narrows the verdict, nothing else. Steps 5, 6, and 7 keep every test requirement: the injection check, the mutation check with one mutation per guard row, the repository tests, and the code reviewer's test findings that reproduce. No test is replaced by a QA scenario and no test mention is removed from a plan, a prompt, or a report. A test finding that reproduces (a), (b), or (c) still goes through Step 11 as a code problem, and a guard row that survives its mutation is still resolved or given a no-test reason at Step 6.

## Step 11: APPROVED or REVISE

- APPROVED: merge the PR yourself. An approval whose report holds only non-blocking memos (evidence corrections, test-style notes) is still an approval: record the memos in the PR body and merge; a memo never opens a round.
- REVISE, code problems only: go back to Step 1 (plan.md) for the cited problems: re-run discovery with the variant sweep; update the plan (Step 2: a COMPANION row for each in-scope variant, a risk row for each fix); run the fixes as a mass-ulw correction run under run.md, Step 5, in the SAME worktree and SAME PR with more commits; then run steps 6, 7 (delta diff), 8 (update the PR body), and 9 again, in that order: step 9 starts only after step 7's reproduced in-contract code blockers are fixed, verified, committed, and pushed, so the final review judges the final head. Steps 3 and 4 are not repeated: the plan review is one round and the goal already exists.
- Two strikes: when the same component (the file or module a blocking finding cites) gets REVISE in two consecutive rounds, stop patching it. Before the next fix, write in the plan the one-sentence premise every failed fix assumed, run one architect review (`category: architect`, prompt per SKILL.md, Delegation prompts) of the cause and that premise, and fix from its answer. That review judges only the cause and the premise; it is not a second plan review.
- Rebase-only head changes: a verdict covers a patch, not a commit. When the head moved after a verdict only by a rebase, compare `git diff <old-base>...<verdict-head> | git patch-id --verbatim` with `git diff <new-base>...<new-head> | git patch-id --verbatim` (verbatim, so a whitespace change still counts as a change). Equal ids keep the verdict, and the report states both heads, both ids, and the comparison. Different ids mean the patch changed: it gets the delta review (step 7 on the difference between those two base-to-head diffs, which also covers changes that live only in merge commits, then step 9), as in a REVISE round.
- `omo-native-gate-reviewer` runs only when the loop's final checkpoint requires a quality-gate record. It is bounded to checking that the evidence exists, matches the criteria, and fits the schema; it never reopens the product verdict and it follows the evidence rule (SKILL.md, Delegation prompts).

## Step 12: Post-merge verification

After the merge, one full verification pass on the merged result: `omo-native-qa-executor` runs every QA scenario, plus the repository test suite, typecheck, and build where the repository has them. A failure follows the Step 6 rule; a fix goes through steps 5-11 again from the merged base, never as a direct patch to main.

## Step 13: Cleanup and final report

- Clean up the task: remove the worktree and the branch, stop owned processes, and record a cleanup receipt for each.
- Complete the goal once the merged result passes step 12.
- Final report: results, evidence locations, limits, and every out-of-scope finding with its follow-up record path (SKILL.md, Purpose boundary). If there were none, say so.

Stop conditions and the report shape: see SKILL.md, Finish.
