---
name: wish
description: "Runs a user-authorized /wish request end to end inside its original purpose: bounded discovery, one plan with a minimal plan gate, one ulw loop goal, worktree DAG execution with behavioral TDD, QA, PR, and a final ultrabrain review. Use when the /wish command or the user names this skill."
metadata:
  short-description: Bounded wish orchestration over ulw-plan, ulw-loop, and mass-ulw
---

# wish

A `/wish` invocation is the user's request plus authorization to plan, implement, verify, open a PR, pass review, merge, and clean up, without asking again for phases already covered. This file is the governing contract. The three references specialize the native skills for each stage; read each one when its stage begins, not before.

Resolve every path in this skill relative to the directory of this SKILL.md. The skill registration gives that directory; never guess an install location.

## The purpose boundary

The original request is the boundary for every stage: discovery, plan, TDD, QA, and review.

- Discovery may look wide to find who and what the result touches. Wide discovery doesn't authorize solving every affected party's discomfort.
- The ideal state is the state where the original request is fully delivered with no regression it introduces. Don't widen it into a general improvement of the product.
- A finding is **in scope** when it shows the request isn't delivered, the change introduces a regression, or the proof is invalid. Fix it autonomously, inside the same task.
- A finding is **out of scope** otherwise, including real pre-existing bugs. Don't fix it. Record it in this work's evidence file with the finding, reproduction, evidence, impact, and the reason it was excluded. Also save a persistent memory entry with a short summary, why it wasn't fixed in this work, and the evidence-file path. Memory is an index; the evidence file keeps the detail.
- When impact is **uncertain**, run the smallest check that decides it. If the check shows it affects the request, it's in scope. An unrelated hypothetical that can't be decided may become a follow-up with what was tried. Uncertainty that keeps you from proving the request is delivered, or that the change introduced no regression, is invalid evidence, not a follow-up: verify it adequately or report an honest blocker. Deferring it never turns a criterion into a PASS.

This specializes native skill defaults that conflict with it. When a generic workflow default conflicts, original-purpose scope, the approved plan-to-execution transition, QA evidence reuse, and the final review **MUST** follow this file's procedures. **NEVER** expand the scope under a conflicting default, add a duplicate approval step, rerun unaffected verification, or add an extra product-review panel. The rows below are examples, not a complete list.

| Native default | Wish rule |
| --- | --- |
| Ultrawork: own every defect met mid-run, fix to a wider ideal state | Only in-scope findings are fixed; others become follow-up notes |
| ulw-plan: stop after planning and wait for approval | The user already authorized execution; continue into the loop |
| ulw-loop and mass-ulw: separate goals per phase or task | One top-level loop goal; tasks and DAG nodes live inside it |
| Ultrawork: rerun the full scenario set before the final message; evidence handling that invalidates everything after any change | Reuse evidence per target after checking its inputs; rerun only affected or uncertain targets (see verification) |
| Ultrawork: its own conditional reviewer loop and resubmission rules | The minimal plan gate, then one ultrabrain review with bounded delta corrections; no extra review panel |
| Native plan-reviewer gate assumed open | Use it only when genuinely eligible; otherwise an honest category-based review |

## Mode state

Assume ultrawork is active. The wish plugin may have armed it for this request, or the user armed it earlier. Don't arm it again, reset it, or disarm it from here.

While it's active, this file and its references are the workflow for this authorized request. They take over the four procedures named under the purpose boundary wherever those conflict. Everything compatible still applies in full: evidence capture, behavioral TDD, cleanup receipts, asynchronous waiting, never suppressing failures, and verification rigor. This skill doesn't outrank system or developer instructions, later explicit user requests, or gates a tool actually enforces. If no mode turns out to be active, this skill is enough on its own.

## Stages and when to load each reference

Move through the stages in order. Each transition names the file to read at that moment.

1. **Discovery and plan.** Read `references/planning.md` now. Survey context and history, name the affected users and the ideal state inside the boundary, list the gaps, define QA scenarios from the users' perspective, write one plan, and pass the minimal plan gate described there. Leave this stage when the plan gate passes. Don't stop and wait for approval after it.
2. **Execution.** Read `references/execution.md` when the plan gate passes, and read `references/verification.md` before defining any task DAG, since the DAG's closing nodes follow it. Seed one ulw loop goal from the plan, create one worktree per task, and run each task's DAG through mass-ulw with behavioral TDD. Leave this stage when the task's production nodes have settled.
3. **Verification, PR, and review.** These are the DAG's closing nodes, already defined from `references/verification.md`, and they run after the production nodes. Run combined QA, open the PR, run the final ultrabrain review, handle REVISE, merge after APPROVED, verify the merged result, and clean up.

Loop back rather than restart: a REVISE returns to stage 2 with a correction DAG in the same worktree and PR, then comes back to stage 3. The loop ends at APPROVED and a merged, verified result.

## Task shape

- One top-level loop goal for the whole wish. Never register tasks as separate goals.
- One requested piece of work is one task: one worktree, one PR, one DAG. Gaps are nodes inside that DAG, not tasks.
- Create a second task only for work with a different purpose. Tasks are independent when neither can affect the other's correctness; when that's unclear, keep one task.
- Independent tasks run concurrently. A dependent task starts after its prerequisite merges. Approved merges happen one at a time.

## Delegation prompts

Every implementation, QA, and review prompt **MUST** carry the purpose boundary: the original request, the task's scope, what counts as a blocker (goal failure, introduced regression, invalid proof), and the instruction to report out-of-scope findings instead of fixing them. A reviewer that flags unrelated quality issues is producing follow-up notes, not blockers.

Before dispatch, check that the assignment itself explicitly contains all four items below. **NEVER** rely on the child having read the parent conversation or shared skill:

- Purpose: the original requested outcome.
- Scope: this assignment's permitted work.
- Blockers: goal failure, introduced regression, and invalid proof; state all three, including in implementation and QA assignments.
- Separate findings: record unrelated findings in the evidence file, index them in memory, and report them; do not fix them or treat them as blockers.

The lead owns the boundary. When a child drifts, reporting unrelated work as required or widening its own scope, correct it with a follow-up message or a re-scoped prompt. Don't accept that work as a requirement.

## Finish

Stop when the requested work is merged, the QA scenarios pass on the merged result, task worktrees and merged task branches are removed, and the user has a report in their language covering results, honest limits, and separate findings.

Out-of-scope findings **MUST** be documented and **MUST** also appear in the final report. For each one give the finding, its impact, why it wasn't fixed now, and its evidence-file path. If there were none, say so explicitly and don't create empty records. A note in a file alone isn't disclosure. The checklist is in `references/verification.md`.

Always respond in the user's language. Agent prompts stay in English.
