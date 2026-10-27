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

Once the reviewed head is pushed, the round-1 final review is dispatched in parallel with this body writing (Step 9). The body must be complete and the PR open before the verdict is acted on.

## Step 9: Final review

One review with `category: ultrabrain` per round, dispatched once the reviewed head is pushed: it reports every CODE defect of the PR in one verdict, never stopping at the first defect, and ends APPROVED or REVISE. The PR must exist before the verdict is acted on; in round 1 the dispatch runs in parallel with the step 8 body, so it adds no serial wait. Its prompt follows SKILL.md, Delegation prompts.

### Dispatch gate

Before every dispatch the run writes a gate table under `<evidenceRoot>`, keyed by (finding, head): one row per in-contract blocking code finding of every earlier REVISE verdict of this PR, citing the reproduction kept at step 1 (the guard test or QA scenario command), the head the command was run at, and `fixed`, `not fixed`, or `no command`. A finding with no runnable reproduction is `no command` and cannot block. Memos, notes, follow-ups, and out-of-contract findings get no row.

- Any `not fixed` row forbids the dispatch: the run returns to the correction path of Step 11, and that row counts as a strike for its component under the two-strike rule.
- Every row is read at the head the review will be dispatched at. When the head moves after the gate, the gate runs again.
- In round 1, or when this PR has no earlier in-contract blocking finding at all, the table is recorded as empty (`no prior verdict`, `no findings yet`) and the dispatch proceeds. An APPROVED verdict never erases earlier rows: a later dispatch after a changed patch regenerates every accumulated row at the new head.
- The table enters the ultrabrain prompt, so the reviewer checks the recorded fixes instead of rediscovering them. Earlier rows stay as history.
- A rebase-only head move whose patch-id matches keeps the verdict and needs no dispatch, so no gate runs; a differing patch is a delta review, and its gate carries the earlier verdict's rows.

## Step 10: Evidence problems

Evidence problems are never a REVISE reason, and neither is a finding outside the plan's finite contract (invariants, known limits, IS and COMPANION rows): such a finding is a note for the report or a follow-up record. Copy the reviewer sentences from SKILL.md, Delegation prompts, into every reviewer prompt without restating them; the memos are handled as SKILL.md step 10 says.

## Step 11: APPROVED or REVISE

- APPROVED: merge the PR yourself.
- REVISE, code problems only: go back to Step 1 (plan.md) for the cited problems: re-run discovery with the variant sweep; update the plan (Step 2: a COMPANION row for each in-scope variant, a risk row for each fix); run the fixes as a mass-ulw correction run under run.md, Step 5, in the SAME worktree and SAME PR with more commits; then run steps 6, 7 (delta diff), 8 (update the PR body), and 9 again, in that order: step 9 starts only after step 7's reproduced in-contract code blockers are fixed, verified, committed, and pushed, so the final review judges the final head. Steps 3 and 4 are not repeated: the plan review is one round and the goal already exists.
- Two strikes: when the same component (the file or module a blocking finding cites) gets REVISE in two consecutive rounds, stop patching it. A `not fixed` row of the Step 9 dispatch gate is a strike for its component. Before the next fix, write in the plan the one-sentence premise every failed fix assumed, run one architect review (`category: architect`, prompt per SKILL.md, Delegation prompts) of the cause and that premise, and fix from its answer. That review judges only the cause and the premise; it is not a second plan review.
- Rebase-only head changes: a verdict covers a patch, not a commit. When the head moved after a verdict only by a rebase, compare `git diff <old-base>...<verdict-head> | git patch-id --verbatim` with `git diff <new-base>...<new-head> | git patch-id --verbatim` (verbatim, so a whitespace change still counts as a change). Equal ids keep the verdict, and the report states both heads, both ids, and the comparison. Different ids mean the patch changed: it gets the delta review (step 7 on the difference between those two base-to-head diffs, which also covers changes that live only in merge commits, then step 9), as in a REVISE round.
- `omo-native-gate-reviewer` runs only when the loop's final checkpoint requires a quality-gate record. It is bounded to checking that the evidence exists, matches the criteria, and fits the schema; it never reopens the product verdict and it follows the evidence rule (SKILL.md, Delegation prompts).

## Step 12: Post-merge verification

After the merge, one full verification pass on the merged result: `omo-native-qa-executor` runs every QA scenario, plus the repository test suite, typecheck, and build where the repository has them. A failure follows the Step 6 rule; a fix goes through steps 5-11 again from the merged base, never as a direct patch to main.

## Step 13: Cleanup and final report

- Clean up the task: remove the worktree and the branch, stop owned processes, and record a cleanup receipt for each.
- Complete the goal once the merged result passes step 12.
- Final report: results, evidence locations, limits, and every out-of-scope finding with its follow-up record path (SKILL.md, Purpose boundary). If there were none, say so.
- Review metrics: the report carries one line per review round of this PR: round number, reviewed head, dispatch time, verdict time, minutes, the PR's ultrabrain call count, the gate rows (fixed / not fixed / no command), the finding count, and the step 12 result. `post-merge re-fix` and `blind re-review` are filled by the experiment series after the run; write them `pending` here.

Stop conditions and the report shape: see SKILL.md, Finish.
