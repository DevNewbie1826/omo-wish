---
name: wish
description: Work one authorized request to a merged PR by defining the ideal state from evidence, running every part as a DAG, and proving each requirement with strict confirmation devices.
metadata:
  short-description: Request to merged PR, as DAGs with strict confirmation devices
---

# wish

**Read and use the `mass-ulw` and `ulw-loop` skills before anything else.**

One `/wish` is one authorized request, worked until its PR merges or, for work that changes no repository, until its result report is APPROVED (see Review and merge).
Next, read the skills of every work-type row that applies to the request (see Skills per work type). Only then register the ulw-loop goals: one goal per phase, each with its real success criteria. Write each phase goal with `addGoal({ title, objective, successCriteria })`, and, before work starts, replace the placeholder criteria that `createGoals` seeds. Never run under one goal with placeholder criteria. Then build every DAG under those goals.

## The request

1. Build a DAG over the whole context and history of the work, analyze it at maximum parallelism, and define from evidence the ideal state for the current problems and the main decision points. Fit the analysis to the work: a narrow change with no open decisions needs one explore node, and only work with open decisions gets a full analysis DAG. Independent leaves that don't depend on the definition (translating a reference, for example) may start in this first DAG beside the analysis.
2. From that definition, create a new git worktree. Create one only when the work changes a repository.
3. Set concrete goals and work toward them.
4. Run all the defined work as DAGs for maximum efficiency. Building a DAG follows the DAG reference (see DAGs).
5. Implement it, and strictly include a device that confirms the implementation.
6. Fix whatever needs fixing, and strictly include a device that confirms each fix.
7. While doing so, verify that every requirement is met, rigorously and in full detail, with nothing skipped. A strict confirmation device follows the verification reference (see Confirmation devices).
8. For UI/UX work, verify every `visual-qa` condition in full detail, nothing skipped.

## DAGs

Build every DAG per `references/dag-construction.md`: top-down to atomic tasks, bottom-up convergence through the direct parent, no skipped level, no flat convergence, maximum parallelism.
`references/dag-construction-ko.md` is the owner's original. Where the two differ, the Korean original governs.
Run each DAG with `mass-ulw` under its phase's ulw-loop goal.
Every part with parallelism is a DAG, and its last node is its review.
Fixes after a review are a DAG too. A 1-2 line fix needs no DAG: make it, confirm it and commit it.
An integration node that only collects and checks its children's results is a check inside the parent, not a separate node (section 4.3 of the DAG reference). Make it a separate node only when integrating needs its own execution, such as merging edits or running the tests over the combined result.

## Node prompts, run files and commits

A scope line in a node prompt names the node: "this node writes only X". Never write it as a statement about the whole repository, such as "the repo is read-only"; the memory system can keep that as a standing agreement and stop later work.
ulw-loop state and its evidence root live under `.omo/ulw-loop/<session-id>/` in the session's working directory, which is usually the main checkout rather than the worktree; that's expected. Put node handoffs and build files in the worktree's git-ignored `.omo/`.
A commit node stages only the paths it names (`git add -- <path>...`, never `git add -A` or `git add .`) and sets the repository's identity for that one command: `git -c user.name=<name> -c user.email=<email> commit`, with no co-author trailer. Take the name and email from the request or brief, never change the global Git identity, and ask before the first commit when no identity is given.

## Confirmation devices

Confirm directly, and leave the commands, exit codes, results and unverified items so another agent can reproduce the check; reuse existing tests and tools; use a method that fits what changed (code: run or test it; UI: check the screen and behaviour; docs: compare the content and the diff); add no ceremonial or duplicate checks; never claim what you didn't verify. The full standard is `references/verification-device.md`.
In every verification node of a DAG, not only in the PR review, an evidence typo (a wrong count, an off line range) is a note, never a FAIL and never a loop.
Code size has no line-count targets. Judge bloat by the `remove-ai-slops` skill. If one file gets hard to hold, split it into several files inside the folder it already belongs to (its own package or module).

## Skills per work type

Once the work type is known, first read every skill in every row that applies. A request can match several rows: a UI bugfix is coding, design / UI and browser-facing surface work. Read all of them before registering the goals or any other work on the request. After a compaction or a resume, read the skills of those rows again.
Where a skill in a row says otherwise, this skill governs. For example, `ulw-loop`'s worktree per goal and per-goal landing give way to this skill's one worktree and one PR.

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

Reviewer dispatch follows Review and merge below, not `review-work`'s own gate reviewer.

## Review and merge

The end of the work opens a PR. Its body carries the evidence: commands, exit codes, results and unverified items. Keep no receipts and no ledger.
Work that changes no repository ends with a result report file instead of a PR. The report carries the same evidence and gets the same review until APPROVED; below, "the PR" also means that report, except that a report has no merge.
The plan is the definition from step 1 of The request plus the goals from step 3, written in the PR body.
Every PR goes to ultrabrain, which reviews endlessly until APPROVED. There's no round cap, and APPROVED is the only end.
Round 1 reviews the whole PR to the end and lists every problem at once.
Fixes for the cited problems go back to the start of this method: they run as a DAG whose last node is the next round, or, for a 1-2 line fix, are made, confirmed and committed directly before the next round.
From round 2 on, only the fixed parts are reviewed. There's no final full review.
A blocker is one of two things, and only with proof (a command that reproduces it, or the exact code line and path):
- A. A plan violation: an unmet requirement, or a broken must-hold condition that the plan lists.
- B. A proven real defect of any kind: security hole, data loss, secret leak, crash, wrong result.

Anything without proof is a note. There is no default-conditions list.
A reviewer who doubts the evidence re-runs the command itself.
Evidence typos are notes, never a loop. Evidence alone never causes a review loop.
After APPROVED, stop and wait for the line from the lead (the user, or the agent that launched this /wish): `MERGE GO <PR> for head <40-hex> only.` Merge only that PR at that head. Never merge, release or deploy without it.
Remove the worktree after the merge. A result report ends at APPROVED.
