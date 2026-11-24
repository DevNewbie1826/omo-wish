---
name: wish
description: Work one authorized request to a merged PR, or to an APPROVED result report when no repository changes, by defining the ideal state from evidence, running every part as a DAG, and proving each requirement with strict confirmation devices.
metadata:
  short-description: Request to merged PR or approved report, as DAGs with strict confirmation devices
---

# wish

One `/wish` is one authorized request, worked until its PR merges or, when no repository changes, until its result report is APPROVED.
The owner is the person who made the request. Every question and approval below goes to the owner.

## Start

1. Read and use the `mass-ulw` and `ulw-loop` skills.
2. Read and use every skill in each row of Skills per work type that applies to the request, following that row's rules.
3. Register one ulw-loop goal per phase with `addGoal({ title, objective, successCriteria })`. Give each goal real success criteria, and replace the placeholder criteria that `createGoals` seeds before work starts; never run under placeholder criteria. A goal that `createGoals` creates takes its own part of the request as its objective. Every objective names the row skills that apply and says "after a compaction or a resume, re-read the wish skill and those skills".

## Workflow

1. Analyze: build a DAG over the whole context and history of the work at maximum parallelism, and define from evidence the ideal state for the current problems and the main decision points. Size it to the work: only work with open decisions gets a full analysis DAG; a narrow change with no open decisions needs one explore node. Leaves that do not depend on the definition may start in this DAG.
2. When the work changes a repository, create one git worktree for it.
3. Set each goal's success criteria from the definition.
4. Run all the defined work as DAGs (see DAGs).
5. Implement and fix. Every implementation and every fix includes a confirmation device (see Confirmation devices).
6. Verify every requirement in full detail, nothing skipped. For UI/UX work, verify every `visual-qa` condition.
7. Open the PR and take it through Review and merge.

## DAGs

Build every DAG per `references/dag-construction.md`. Run each with `mass-ulw` under its phase's goal: atomic tasks become nodes and execution dependencies become `dependsOn`.
Every part with parallelism is a DAG, and its last node is its review. Fixes after a review are a DAG too; a 1-2 line fix is made and confirmed directly.

## Nodes, run files and commits

- A node's scope line names that node only: "this node writes only X". Never phrase it as a rule about the whole repository, such as "the repo is read-only".
- ulw-loop state and its evidence root live under `.omo/ulw-loop/<session-id>/` in the session's working directory, which may be the main checkout rather than the worktree. Node handoffs and build files go in the worktree's `.omo/`, or the session working directory's `.omo/` when there is no worktree, and are never committed.
- A commit node follows `git-master`, stages only the paths it names (`git add -- <path>...`, never `git add -A` or `git add .`), and commits with `git -c user.name=<name> -c user.email=<email> commit`, with no co-author trailer. Take the identity from the request; never change the global Git identity; ask the owner before the first commit when none is given.

## Confirmation devices

Follow `references/verification-device.md`.
In every verification node, and in review, an evidence typo (a wrong count, an off line range) is a note, never a FAIL and never a loop.
Code size has no line-count targets: judge bloat by `remove-ai-slops`. Split a file that grows hard to hold into several files inside the folder it already belongs to.

## Skills per work type

A request can match several rows (a UI bugfix matches coding, design / UI and browser-facing surface work). Where a row skill differs from this skill, this skill governs: one worktree and one PR for the work, not `ulw-loop`'s per-goal worktrees and landings; Review and merge, not `review-work`'s own gate reviewer, which is used only for its QA, review-worktree and reviewer-freshness guidance. On a resume, re-enter mass-ulw's journaled run keys; never restart them.

| work type | skills | rules |
| --- | --- | --- |
| coding (patch, feature, bugfix, refactor) | `mass-ulw`, `ulw-loop`, `programming`, `debugging`, `ast-grep`, `refactor`, `git-master`, `remove-ai-slops`, `review-work` | |
| research | `ulw-research`, `mass-ulw`, `ulw-loop`, `ulw-plan` | `ulw-plan` writes the research plan |
| design / UI | `frontend`, `visual-qa`, `browser`, `programming`, `remove-ai-slops`, `mass-ulw`, `ulw-loop`, `git-master`, `review-work` | |
| audit | `remove-ai-slops`, `frontend`, `visual-qa`, `programming`, `mass-ulw`, `ulw-loop` | the rule corpus is those skills' own rule sets; cite each finding by rule id |
| planning | `ulw-plan`, `hyperplan`, `programming`, `remove-ai-slops`, plus the work type's own skill (`visual-qa` for design, `ulw-research` for research) | `ulw-plan` writes a decision-complete plan; `hyperplan` cross-critiques it when needed; the plan carries the test and slop constraints of `programming` and `remove-ai-slops`, and the type skill's definition of done |
| review | `review-work`, `programming`, `remove-ai-slops`, `visual-qa`, `browser` | |
| cleanup | `remove-ai-slops`, `refactor`, `git-master` | remove the work's worktrees and branches |
| collection / corpus extraction | `mass-ulw`, `ast-grep`, `programming`, `remove-ai-slops`, `visual-qa`, `frontend`, `ulw-research` | collect in one mass-ulw run; harvest the distilled rule sets before any raw corpus |
| multi-unit program | `mass-ulw`, `ulw-loop`, `ulw-plan`, `hyperplan` | one ulw-loop goal per unit and one mass-ulw run per wave; `ulw-plan` for a unit that needs a plan, `hyperplan` when its plan is contested |
| resume after death or compaction | `ulw-loop`, `mass-ulw` | |
| browser-facing surface work | `browser`, `visual-qa` | |

## Review and merge

- The PR body carries the plan (the definition from Workflow step 1 and the goals) and the evidence: commands, exit codes, results and unverified items. Keep no receipts or ledger of your own; a row skill's own records stay with that skill.
- Work that changes no repository ends with a result report file instead: where the request says, else under the session's git-ignored `.omo/`. Give its path to the owner. It holds the result or names the files that do, carries the same evidence and gets the same review. Below, "the PR" includes it, except that a report has no merge.
- Every PR goes to `ultrabrain`, which reviews until APPROVED. There is no round cap; APPROVED is the only end.
- Round 1 reviews the whole PR and lists every problem at once. Fixes go back through the Workflow (see DAGs), ending in the next round. From round 2 on, only the fixed parts are reviewed; there is no final full review.
- A blocker needs proof (a command that reproduces it, or the exact path and line) and is one of:
  - A. a plan violation: an unmet requirement or a broken must-hold condition the plan lists;
  - B. a proven real defect: security hole, data loss, secret leak, crash, wrong result.
- Anything else is a note, and evidence alone never causes a loop. A reviewer who doubts the evidence re-runs the command.
- After APPROVED, wait for the owner's line `MERGE GO <PR> for head <40-hex> only.` Merge only that PR at that head; never merge, release or deploy without it. Then remove the worktree and its branch. A result report is done at APPROVED.
