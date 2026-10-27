# wish: verification, review, and merge

Covers steps 6-13 of the flow (see SKILL.md, The 13 steps).

## Step 6: Pre-PR verification, two parallel branches

A failure that touches no IS or COMPANION row and fails the same way on the base commit (both runs captured) goes to the follow-up file and the final report; every other failure, and any check that could not run, is fixed and rerun before the PR.

Branch (a), one node: run the repository test suite, then the mutation check. Make one mutation per guard row of the plan's risk list: break the production code the row guards with one small edit in a throwaway copy of the worktree, run that row's guard test, and record killed or survived for the row. A mutation is killed only when its guard test passes unmutated and fails under the mutation; a run that fails for any other reason is not a kill. A survivor means a regression would pass unnoticed: strengthen that row's guard test until the mutation is killed, or record a no-test reason in the plan's risk list. Branch (a) passes when every failure is fixed or sent to the follow-up file under the rule above, and every mutation is killed or resolved this way. Behaviors under a valid no-test row get no mutation.

Branch (b), the agent `omo-native-qa-executor`: run each plan scenario's happy case and failure case on the real surface. Record per scenario the command, the observable, PASS or FAIL, the output capture, and the cleanup receipt for anything the scenario started. A failing scenario follows the rule above.

Run the relevant first-use and resume paths through the shipped composition, with the same input and event routes a user takes, and include process exit and owned-resource cleanup. A missing surface is a failure, not a reason to test only the surfaces already implemented. Mark external authentication or unavailable platforms unverified when only a local fixture was exercised.

Both branches must pass before the PR (gate order: SKILL.md, Rules).

## Step 7: Code review round

Run `omo-native-code-reviewer` once per round, before the PR. The reviewer must load and apply the `remove-ai-slops` skill and the `programming` skill, and state in its report whether that check ran. It reports findings by severity CRITICAL, HIGH, MEDIUM, LOW. Severity ranks a finding; it does not decide whether it blocks. Apply the finite-contract blocker rule of Step 10. Fix every reproduced in-contract code blocker once, then continue without a second code-review pass; a routed PR's step-9 final review may use the same agent, and it is a separate step-9 review, not a second step-7 pass. All other findings remain notes. In a REVISE round the reviewer sees only the delta diff since the last reviewed commit. Its prompt follows SKILL.md, Delegation prompts.

## Step 8: Open the PR

One PR to the repository's main branch. Before writing the body, compute the final-review route (Step 9) and put `REVIEW ROUTE: <code-reviewer|ultrabrain>` (where `code-reviewer` means `omo-native-code-reviewer`), the table version, and the per-file class table in the body; recompute and update it whenever the head moves. The body states the behavior delivered, the tests and QA run with their capture paths, and the real limits. Claims stay within what the captures hold; never retype a number or SHA that a capture already holds.

Take the head SHA, commands, exit codes, counts, and the base each result is attributed to from their captures; label claims about earlier heads as history, separate from final-head claims, and keep the source reports until step 13 cleanup.

## Step 9: Final review

The final review is one review per round. Its reviewer is chosen by the paths the PR changes, recorded in the PR body (Step 8), and recomputed whenever the head moves.

Classify every path in `git diff --name-status -M <base>...<head>`, matched case-sensitively on the full path from the repo root. A rename contributes both paths and a deletion the removed path; production on either side wins. The first matching row wins.

| Class | Path rule |
| --- | --- |
| production (product override) | a path under a product-content root the plan declares: a text or asset file the shipped product reads at runtime (skill, prompt, template, locale). The plan names the root and its consumer. `.` or `/` declares the whole repository. |
| test | a directory segment `test`, `tests`, `__tests__`, `__mocks__`, `__snapshots__`, `__fixtures__`, `spec`, `specs`, `testdata`, or `e2e`; or a basename `*.test.*`, `*.snap`, or `test_*.py`; or a basename `*.spec.*`, `*_spec.*`, or `*_test.*` whose final extension is a code extension (`.js`, `.jsx`, `.ts`, `.tsx`, `.mjs`, `.cjs`, `.mts`, `.cts`, `.py`, `.rb`, `.go`, `.java`, `.kt`, `.kts`, `.cs`, `.scala`, `.php`, `.swift`, `.vue`, `.svelte`); or a basename `*Test.java`, `*Tests.java`, `*Test.kt`, `*Tests.kt`, `*Test.kts`, `*Tests.kts`, `*Test.scala`, `*Tests.scala`, `*Test.cs`, or `*Tests.cs` |
| CI | a path under `.github/workflows/`, `.github/actions/`, `.circleci/`, `.buildkite/`, `.gitlab/`, `.azure-pipelines/`, `ci/`, or `.ci/`; or `.github/dependabot.yml` or `.yaml`; or a basename `Jenkinsfile`, `Jenkinsfile.*`, `.gitlab-ci.yml` or `.yaml`, `.travis.yml` or `.yaml`, `azure-pipelines.yml` or `.yaml`, `appveyor.yml` or `.yaml`, `.drone.yml` or `.yaml`, `bitbucket-pipelines.yml` or `.yaml`, `renovate.json` or `.json5`, or `.renovaterc` or `.renovaterc.json` |
| docs (allowlist) | a path under the root `docs/`, `doc/`, or `documentation/`; or a root-level basename that is `README`, `CHANGELOG`, `CHANGES`, `CONTRIBUTING`, `CODE_OF_CONDUCT`, `SECURITY`, `AUTHORS`, `NOTICE`, `LICENSE`, or `COPYING`, optionally followed by `.` and a suffix, when the final extension is `.md`, `.mdx`, `.markdown`, `.rst`, `.adoc`, or `.txt`. Every other docs-extension file, and every nested `docs/`, `doc/`, or `documentation/` directory, is production. |
| production (default) | everything else: unknown kinds, nested docs directories, docs-extension files outside the allowlist, generated files, manifests, lockfiles, build configuration, and an empty diff |

Route:

- every changed path is test, docs, or CI (at least one path): `omo-native-code-reviewer` (route token `code-reviewer`).
- any production path, a mixed set, an unknown path, or an empty diff: `category: ultrabrain`. Mixed means at least one production path alongside anything else; test plus docs alone is routed.

The code-reviewer final review is one pass with the Step 7 prompt requirements: it loads and applies `remove-ai-slops` and `programming`, reports every CODE defect of the whole PR in one verdict, and follows the Step 10 rule. It is the Step 9 review, not a second Step 7 pass and not a delta of it. Its APPROVED or REVISE gets the same Step 11 handling as an ultrabrain verdict.

The route upgrades and never downgrades: once a head adds a production path, ultrabrain reviews that head and every later head, even if a later head removes it. A classification error, a missing base, or a truncated file list routes to ultrabrain.

`skills/wish/scripts/review-route.mjs` implements this table verbatim and prints the table version: `bun <skill>/scripts/review-route.mjs --base <base> --head <head> [--product-root <dir>]... [--json]`. When the script cannot run, apply the table by hand and record the same route line and per-file classes in the PR body.

## Step 10: Evidence problems

Evidence problems are never a REVISE reason, and neither is a finding outside the plan's finite contract (invariants, known limits, IS and COMPANION rows): such a finding is a note for the report or a follow-up record. Copy the reviewer sentences from SKILL.md, Delegation prompts, into every reviewer prompt without restating them; the memos are handled as SKILL.md step 10 says.

## Step 11: APPROVED or REVISE

- APPROVED: merge the PR yourself.
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
