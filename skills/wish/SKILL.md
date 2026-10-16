---
name: wish
description: "Runs one user-authorized /wish request end to end: discovery, one plan with a single architect review, a goal-bound mass-ulw run with an injection check in each node, two-branch pre-PR verification, one code-reviewer round, a PR, one ultrabrain final review, merge, post-merge verification, and cleanup. Use when the /wish command or the user names this skill."
metadata:
  short-description: Light 13-step authorized-request flow on mass-ulw
---

# wish

A `/wish` invocation is one authorized request plus authorization to plan, implement, verify, open a PR, pass review, merge, and clean up, without asking again for phases already covered. This file is the governing contract; the three references detail the steps.

Resolve every reference path in this skill relative to the directory of this SKILL.md.

`/wish` arms ultrawork, so assume it is active and never re-arm, reset, or disarm it, and create no goal or notepad at its bootstrap: the plan file holds the notes until step 4 creates the one goal through ulw-loop (`references/plan.md`, Step 4). The authorized request already covers every phase here, so never ask the user to authorize the plan, the run, the PR, the review, the merge, or the cleanup again, and never pause for a native reviewer loop or a failed-attempt question; steps 7, 9, and 11 are the review schedule, and you run any REVISE round yourself. A genuine owner decision (irreversible, destructive, or a spend) is still asked through the question tool, or through whoever assigned you if the tool is unavailable.

## The 13 steps

1. Discovery: survey the code, the git history of the paths to touch, memory, and earlier session evidence. When a REVISE sends work back (step 11), re-run discovery for the cited problem and sweep for variants of the same defect class, with no separate sweep or report-merging nodes. Details: `references/plan.md`.
2. One plan file: IS rows and COMPANION rows (the request is the boundary), gaps, user-side QA scenarios (real surface, exact command, binary pass condition), the IS-row to QA-scenario pairing, a risk list, and two pinned rules: worktree pinned for every command, commits serialized. Details: `references/plan.md`.
3. One architect plan review (`category: architect`): OKAY or blockers; record a fix for each blocker. Details: `references/plan.md`.
4. Register the goal (mass-ulw runs are goal-bound): the IS-to-QA pairing written as ONE paragraph, because line breaks split the brief. Details: `references/plan.md`.
5. Run the plan with mass-ulw: a worktree per task, parallel nodes with disjoint write scopes, one node owning a change and its proof, an injection check inside the node (recreate the regression, capture the failing test, restore, capture the passing test), and serialized commits after each verified unit. Details: `references/run.md`.
6. Pre-PR verification in two parallel branches: (a) a node runs the repository tests and the mutation check (break 3-5 highest-risk changed behaviors in a throwaway copy, record killed or survived); (b) `omo-native-qa-executor` runs the QA scenarios on the real surface, recording per scenario the command, observable, PASS/FAIL, output, and cleanup receipt. Details: `references/review.md`.
7. `omo-native-code-reviewer` once per round before the PR: findings by severity CRITICAL/HIGH/MEDIUM/LOW. Its prompt must require the reviewer to load and apply the `remove-ai-slops` and `programming` skills and to state in its report whether that check ran. Fix CRITICAL and HIGH once, then continue; no second pass. In a REVISE round it reviews only the delta diff. Details: `references/review.md`.
8. Open the PR: behavior delivered, tests and QA run, real limits. Details: `references/review.md`.
9. One ultrabrain final review (`category: ultrabrain`): reports every CODE defect of the PR in one verdict. Details: `references/review.md`.
10. Evidence problems are never a REVISE reason; every reviewer prompt carries the rule verbatim from Delegation prompts below. Each memo comes back to you: check it and fix the evidence yourself, with no re-review. Details: `references/review.md`.
11. APPROVED: merge the PR yourself. REVISE (code problems only): go back to step 1 and run steps 2, 5-9 again for the cited problems, in the same worktree and same PR with more commits. `omo-native-gate-reviewer` runs only when the loop final checkpoint requires a quality-gate record, bounded to checking that the evidence exists, matches the criteria, and fits the schema; it never reopens the product verdict and follows rule 10. Details: `references/review.md`.
12. After merge, one full verification on the merged result: `omo-native-qa-executor` runs all QA scenarios, plus the repository test suite, typecheck, and build where they exist. Details: `references/review.md`.
13. Cleanup, complete the goal, final report: results, evidence locations, limits, and out-of-scope findings with their follow-up record paths. Details: `references/review.md`.

## Purpose boundary

The original request and its companion items are the boundary for every step: discovery, plan, tests, QA, and review.

- In scope means the request IS rows plus COMPANION rows: planned from the start, or found later and then added under the guards below. An undelivered COMPANION row is "request not delivered", like an unmet IS row.
- A companion item is the same grain as the change and something the requester would naturally expect done together. It must pass: (a) one hop from a request IS row, never chained to another companion; (b) no new owner decision; (c) same task and PR; (d) recorded in the plan as `COMPANION: <item> <- <request IS row> : <why expected>`.
- Same-pattern pre-existing bugs at sibling locations found while fixing are companion under these guards, not follow-ups.
- A late-found item that passes the guards is added to the plan as a COMPANION row and fixed in the same task.
- Everything else is out of scope: never fix it in this task. Record it in the follow-up file `<evidenceRoot>/follow-ups.md` (`references/plan.md`, Step 4; created only when a real finding exists) and name it in the final report.

## Rules

- Tests: code first; no RED-first mandate. A test must break when the behavior changes, not only when the implementation changes, and a fixture for a behavior that consumes more than one value supplies at least two distinct values, so a change that drops any of them breaks it. Add a test only when the repository keeps tests for that behavior and a regression would otherwise pass unnoticed; prose gets read-through QA, never wording tests. Every guard row gets the injection check (step 5).
- Evidence capture: capture the command and its output; never retype a SHA or number by hand when a capture holds it; record only what you checked.
- Test discipline: no sleeps; wait on the event or state change itself.
- Gate order: never open the PR before step 6 passes and step 7 has run; never merge before the ultrabrain review returns APPROVED.

## Delegation prompts

Every child prompt carries: the Purpose (the original requested outcome); the Scope (this assignment's permitted work); the Blockers, stated as goal failure = an IS or COMPANION row not delivered, an introduced regression, or a proof that shows the code does not do what is claimed (a code defect); typos, number errors, and wording or format problems in evidence are correction memos; Separate findings (anything not companion under Purpose boundary: report it, never fix it in this task, never treat it as a blocker); the companion definition, by a pointer to Purpose boundary above; and the fields TASK, DELIVERABLE, SCOPE, VERIFY, and STOP WHEN.

Every reviewer prompt (code-reviewer, ultrabrain, gate-reviewer, architect) carries the following rule verbatim.

Evidence problems are never a REVISE reason. Typos, number errors, and wording or format problems in evidence or reports do not cause REVISE. Write each one as a correction memo in your report; do not fix the evidence yourself and do not request a re-review for it. Only a problem in CODE can cause REVISE.

## Finish

Stop when the request is merged, the post-merge verification (step 12) passes, the worktree and branch are removed, the goal is completed, and the final report is delivered. Always respond in the user's language; agent prompts stay in English.
