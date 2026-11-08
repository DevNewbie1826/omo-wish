---
name: wish
description: Work one authorized request to a merged PR by defining the ideal state from evidence, running every part as a DAG, and proving each requirement with strict confirmation devices.
metadata:
  short-description: Request to merged PR, as DAGs with strict confirmation devices
---

# wish

**Read and use the `mass-ulw` and `ulw-loop` skills before anything else.**

One `/wish` is one authorized request, worked until its PR merges.
Register the ulw-loop goals first: one goal per phase, each with its real success criteria. Write each phase goal with `addGoal({ title, objective, successCriteria })`, and replace the criteria `createGoals` seeds as placeholders before work starts. Never run under one goal with placeholder criteria. Then build every DAG under those goals.

## The request

1. Build a DAG over the whole context and history of the work, analyze it at maximum parallelism, and define from evidence the ideal state for the current problems and the main decision points. Size the analysis by the three questions in Size check: small work is one explore node, and only big work gets a full analysis DAG. Independent leaves that don't depend on the definition (translating a reference, for example) may start in this first DAG beside the analysis.
2. From that definition, create a new git worktree. Create one only when the work changes a repository.
3. Set concrete goals and work toward them.
4. Run all the defined work as DAGs for maximum efficiency. Building a DAG follows the DAG reference (see DAGs).
5. Implement it, and strictly include a device that confirms the implementation.
6. Fix whatever needs fixing, and strictly include a device that confirms each fix.
7. While doing so, verify that every requirement is met, rigorously and in full detail, with nothing skipped. A strict confirmation device follows the verification reference (see Confirmation devices).
8. For UI/UX work, verify every `visual-qa` condition in full detail, nothing skipped.

## DAGs

Build every DAG per `references/dag-construction.md`: top-down to atomic tasks, bottom-up convergence through the direct parent, no skipped layer, no flat convergence, maximum parallelism.
`references/dag-construction-ko.md` is the owner's original. Where the two differ, the Korean original governs.
Run each DAG with `mass-ulw` under the ulw-loop goal.
Every part with parallelism is a DAG, and its last node is its review.
Fixes after a review are a DAG too, sized by the same three questions. A 1-2 line fix needs no DAG: make it, confirm it and commit it.
An integration node that only collects and checks its children's results is a check inside the parent, not a separate node (section 4.3 of the DAG reference). Make it a separate node only when integrating needs its own execution, such as merging edits or running the tests over the combined result.

## Node prompts, run files and commits

A scope line in a node prompt names the node: "this node writes only X". Never write it as a statement about the whole repository, such as "the repo is read-only"; the memory system can keep that as a standing agreement and stop later work.
ulw-loop state and its evidence root live under `.omo/ulw-loop/<session-id>/` in the session's working directory, usually the main checkout, so that's expected. Put node handoffs and build files in the worktree's git-ignored `.omo/`.
A commit node stages only the paths it names (`git add -- <path>...`, never `git add -A` or `git add .`) and sets the repository's identity for that one command: `git -c user.name=<name> -c user.email=<email> commit`, with no co-author trailer. Take the name and email from the request or brief, never change the global Git identity, and ask before the first commit when no identity is given.

## Confirmation devices

Confirm directly, so another agent can reproduce it from the commands, exit codes, results and unverified items you leave; reuse existing tests and tools; add no ceremonial or duplicate checks; never claim what you didn't verify. The full standard is `references/verification-device.md`.
This holds for every verification node in a DAG, not only the PR review: an evidence typo (a wrong count, an off line range) is a note, never a FAIL and never a loop.
Code size has no line-count targets. Judge bloat by the `remove-ai-slops` skill. If one file gets hard to hold, split it into files inside the tool's own folder.

## Skills per work type

| work type | read and use | for what |
| --- | --- | --- |
| coding (patch, feature, bugfix, refactor) | `mass-ulw`, `ulw-loop`, `programming`, `debugging`, `ast-grep`, `refactor`, `git-master`, `remove-ai-slops`, `review-work` | run collect, build and fix as mass-ulw DAGs under the ulw-loop goal; production code and tests under `programming`; `debugging` for crashes, wrong output or hangs, locked by a failing test; `ast-grep` for syntax-shaped search and codemods; `refactor` when the unit restructures; `git-master` on every commit node; `remove-ai-slops` to cut slop behind regression tests; `review-work` for its QA, review-worktree and reviewer-freshness guidance only |
| research | `ulw-research`, `mass-ulw`, `ulw-loop`, `ulw-plan` | phases, source floor, fact ledger, claim graph and gates are `ulw-research`'s; `mass-ulw` runs them as a DAG; `ulw-loop` holds the goal and evidence root; `ulw-plan` writes the plan |
| design / UI | `frontend`, `visual-qa`, `browser`, `programming`, `remove-ai-slops`, `mass-ulw`, `ulw-loop`, `git-master`, `review-work` | `frontend` builds; `visual-qa` verifies every one of its conditions in full detail and owns the checklist; `browser` drives the real page for QA; `programming` and `remove-ai-slops` guard the code; `review-work` for its QA, review-worktree and reviewer-freshness guidance only; the rest carry the run, commits and gate |
| audit | `remove-ai-slops`, `frontend`, `visual-qa`, `programming`, `mass-ulw`, `ulw-loop` | the rule corpus is those skills' own rule sets, cited by id; collection and judging run as a mass-ulw DAG under the ulw-loop goal |
| planning | `ulw-plan`, `hyperplan`, `programming`, `remove-ai-slops`, plus the work type's own skill (`visual-qa` for design, `ulw-research` for research) | `ulw-plan` for a decision-complete plan; `hyperplan` when the plan needs adversarial cross-critique; `programming` and `remove-ai-slops` read first so the plan carries real test and slop constraints; the type skill fixes what done means |
| review | `review-work`, `programming`, `remove-ai-slops`, `visual-qa`, `browser` | `review-work` for its QA, review-worktree and reviewer-freshness guidance only; `programming` and `remove-ai-slops` are the code-review axes; `visual-qa` is the verdict for UI; `browser` captures on-surface evidence |
| cleanup | `remove-ai-slops`, `refactor`, `git-master` | remove dead code and slop behind regression tests, restructure what survives, tear down worktrees and branches under git rules |
| collection / corpus extraction | `mass-ulw`, `ast-grep`, `programming`, `remove-ai-slops`, `visual-qa`, `frontend`, `ulw-research` | collect in one mass-ulw run; extract by syntax shape with `ast-grep`; harvest the distilled rule sets before any raw corpus |
| multi-unit program | `mass-ulw`, `ulw-loop`, `ulw-plan`, `hyperplan` | one ulw-loop goal per unit, one mass-ulw build run per wave; `ulw-plan` for units that need a plan, `hyperplan` when a unit's plan is contested |
| resume after death or compaction | `ulw-loop`, `mass-ulw` | `ulw-loop` status rebinds the evidence root; re-enter mass-ulw's journaled run keys, never restart them |
| browser-facing surface work | `browser`, `visual-qa` | `browser` drives the signed-in or owned browser for actions, screenshots and traces; `visual-qa` judges the captured state. Not for a plain search or a static fetch |

Reviewer dispatch follows Size check and Review and merge below, not `review-work`'s own gate reviewer.

## Size check

Answer three questions about the PR:

1. If it's wrong, is the impact small and recoverable with one revert?
2. Is it confirmed at once by CI or by eye?
3. Is it set work with no design judgment? A new file following a pattern counts as set work.

All yes means small work: CI plus a self-review. No other-model review.
Any no, or anything touching security, permissions, data loss, concurrency, schema, several repositories, hard recovery or a design fork, means big work: ultrabrain review.
When unsure, go one level up.

## Review and merge

The end of the work opens a PR. Its body carries the evidence: commands, exit codes, results and unverified items. Keep no receipts and no ledger.
Small work puts its self-review in the PR body.
Big work goes to ultrabrain, which reviews endlessly until APPROVED. There's no round cap, and APPROVED is the only end.
Round 1 reviews the whole PR to the end and lists every problem at once.
Fixes for the cited problems go back to the start of this method, and they run as a DAG whose last node is the next round.
From round 2 on, only the fixed parts are reviewed. There's no final full review.
A blocker is one of two things, and only with proof (a reproduce command, or the exact code line and path):
- A. A plan violation: a requirement not met, or a must-hold condition the plan lists broken.
- B. A proven real defect of any kind: security hole, data loss, secret leak, crash, wrong result.
Anything without proof is a note. There is no default-conditions list.
A reviewer who doubts the evidence re-runs the command itself.
Evidence typos are notes, never a loop. Evidence alone never causes a review loop.
After APPROVED (or the small-work self-review), stop and wait for the lead's line `MERGE GO <PR> for head <40-hex> only.` Merge only that PR at that head. Never merge, release or deploy without it.
Remove the worktree after the merge.
