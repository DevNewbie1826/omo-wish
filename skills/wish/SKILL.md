---
name: wish
description: "Runs a user-authorized /wish request end to end inside its original purpose: bounded discovery, one plan with a minimal plan gate, one ulw loop goal, worktree DAG execution with behavioral TDD, QA, PR, and a final ultrabrain review. Use when the /wish command or the user names this skill."
metadata:
  short-description: Bounded wish orchestration over ulw-plan, ulw-loop, and mass-ulw
---

# wish

A `/wish` invocation is the user's request plus authorization to plan, implement, verify, open a PR, pass review, merge, and clean up, without asking again for phases already covered. This file is the governing contract. The three references specialize the native skills `ulw-plan`, `ulw-loop`, and `mass-ulw` for each stage. Read each reference and each native skill when its stage begins, not before; the stage list below names exactly which files each stage requires.

Resolve every reference-document path in this skill relative to the directory of this SKILL.md. SDK and work-artifact paths, such as the follow-up file, follow their own rules below. The skill registration gives that directory; never guess an install location. Read native skills from the locations the available skill list gives.

## The purpose boundary

The original request is the boundary for every stage: discovery, plan, TDD, QA, and review.

- Discovery may look wide to find who and what the result touches. Wide discovery doesn't authorize solving every affected party's discomfort.
- The ideal state is the state where the original request is fully delivered with no regression it introduces. Don't widen it into a general improvement of the product.
- A finding is **in scope** when it shows the request isn't delivered, the change introduces a regression (including a failing test or a stale doc of code this change touched), or the proof is invalid. Fix it autonomously, inside the same task.
- A finding is **out of scope** otherwise, including real pre-existing bugs. Don't fix it. Record it in this work's follow-up file (defined below) with the finding, reproduction, evidence, impact, and the reason it was excluded. Also save a persistent memory entry with a short summary, why it wasn't fixed in this work, and the follow-up file path. Memory is an index; the follow-up file keeps the detail.
- The **follow-up file** is `<evidence directory>/follow-ups.md`. With ulw-loop, the evidence directory is `agentToolkit.status().result.evidenceRoot`; resolve a relative root against `result.binding.cwd`, never the installed skill directory or `currentAttemptDir`. ulw-loop ships with omo, so every wish has a loop; this is not a path for running without one. Until the loop initializes and `evidenceRoot` exists, hold findings in the plan file, then record the path. The plan records one absolute path and every later finding, memory entry, and final report reuses it. The loop ledger only indexes progress, verdicts, and evidence references; it isn't the follow-up file. Create the file only when a real finding exists. Timing is in `references/planning.md`.
- When impact is **uncertain**, run the smallest check that decides it. If the check shows it affects the request, it's in scope. An unrelated hypothetical that can't be decided may become a follow-up with what was tried. Uncertainty that keeps you from proving the request is delivered, or that the change introduced no regression, is invalid evidence, not a follow-up: verify it adequately or report an honest blocker. Deferring it never turns a criterion into a PASS.

This specializes native skill defaults that conflict with it. When a generic workflow default conflicts, original-purpose scope, the approved plan-to-execution transition, QA evidence reuse, and the final review **MUST** follow this file's procedures. **NEVER** expand the scope under a conflicting default, add a duplicate approval step, rerun unaffected verification mid-run, or add an extra product-review panel. The rows below are examples, not a complete list.

| Native default | Wish rule |
| --- | --- |
| Ultrawork: fix every defect in the change's blast radius; a defect outside it becomes a tracked issue | Same split, with the in-scope definition above; the follow-up file plus its memory entry is the tracked issue, and the final report names it |
| ulw-plan: plan mode is sticky; pledge no implementation, stop after the plan and wait for approval, leave execution to a separate session | The /wish invocation is that approval. Skip the pledge and the wait, and continue into the loop in this same session |
| Ultrawork bootstrap: register your own goal with create_goal and open a notepad | Register no goal and open no separate notepad at bootstrap; the wish stages replace the bootstrap's plan, goal, and notepad. In stage 1 the plan file is the plan and holds your notes. In stage 2, after the plan gate, ulw-loop creates the goal and its ledger becomes the notepad. create_goal only registers the createGoals handoff |
| mass-ulw: one run per phase, never a whole job | Each task DAG is one phase: its production nodes plus the closing verification, PR, and review nodes. A REVISE correction is a new run |
| ulw-loop and mass-ulw: separate goals per phase or task | One top-level loop goal; tasks and DAG nodes live inside it |
| Ultrawork: reuse evidence per target, then run the full set once more before the final message | Same: reuse evidence per target after checking its inputs and rerun only affected or uncertain targets, then run the full verification set once on the merged result before the final report (see verification) |
| Ultrawork: its own conditional reviewer loop and resubmission rules | The minimal plan gate, then one ultrabrain review with bounded delta corrections; no extra review panel |
| Native plan-reviewer gate assumed open | Use it only when genuinely eligible; otherwise an honest category-based review |

## Mode state

Assume ultrawork is active. The wish plugin may have armed it for this request, or the user armed it earlier. Don't arm it again, reset it, or disarm it from here.

While it's active, this file and its references are the workflow for this authorized request. They take over the four procedures named under the purpose boundary wherever those conflict. Everything compatible still applies in full: evidence capture, behavioral TDD, cleanup receipts, asynchronous waiting, never suppressing failures, and verification rigor. This skill doesn't outrank system or developer instructions, later explicit user requests, or gates a tool actually enforces. If ultrawork mode turns out not to be active, this skill is still enough on its own. That sentence is about ultrawork mode only; ulw-loop is not optional, and every wish runs it in stage 2.

## Non-negotiable rules

These rules hold for every model and every request size. Breaking one is a defect, not a judgment call. The `/wish` request is the user's explicit instruction to run this flow, so a generic preference for doing small work directly doesn't override them.

1. **Read every required file at its stage entry.** The stage list names them. You **MUST** open each one in this run; having read this file, a summary, or an earlier run's copy doesn't count. If a required native skill is missing from the available skill list, stop and report it as a blocker. **NEVER** reconstruct its procedure from memory.
2. **Report the reads.** The first handoff of each stage names the files you read for it.
3. **The goal comes only from ulw-loop.** Create it with `agentToolkit.createGoals` through the ulw-loop SDK, then register the returned handoff with `create_goal`. **NEVER** call `create_goal` before that, or with an objective written outside the loop.
4. **Changes to the task's files run only in DAG nodes.** Every edit, test write, and fix, including REVISE fixes, happens inside a `workflow` node defined through mass-ulw and working in the task's worktree. The lead plans, drives runs, reviews, merges, and cleans up; it **NEVER** edits the task's files itself, in the main session or the main checkout, however small the change.
5. **NEVER define a DAG before reading mass-ulw's `references/planning.md` in full.**
6. **Gate order holds.** **NEVER** open the PR before combined verification passes, and **NEVER** merge before the ultrabrain review returns APPROVED.

## Stages and their required reads

Move through the stages in order. Each transition names the file to read at that moment.

1. **Discovery and plan.** Required reads at entry: `references/planning.md` and the `ulw-plan` skill. Survey context and history, name the affected users and the ideal state inside the boundary, list the gaps, define QA scenarios from the users' perspective, write one plan, and pass the minimal plan gate described there. Leave this stage when the plan gate passes. Don't stop and wait for approval after it.
2. **Execution.** Required reads when the plan gate passes, in this order: `references/execution.md`; the `ulw-loop` skill, before seeding the goal; the `mass-ulw` skill and its `references/planning.md` in full, then `references/verification.md`, before defining any task DAG, since the DAG's closing nodes follow it. Seed one ulw loop goal through the ulw-loop SDK from the plan, create one worktree per task, and run each task's DAG through mass-ulw with behavioral TDD. Leave this stage when the task's production nodes have settled.
3. **Verification, PR, and review.** These are the DAG's closing nodes, already defined from `references/verification.md`, and they run after the production nodes. Run combined QA, open the PR, run the final ultrabrain review, handle REVISE, merge after APPROVED, verify the merged result, and clean up.

Loop back rather than restart: a REVISE returns to stage 2 with a correction DAG in the same worktree and PR, then comes back to stage 3. The loop ends at APPROVED and a merged, verified result.

## Task shape

- One top-level loop goal for the whole wish. Never register tasks as separate goals.
- One requested piece of work is one task: one worktree, one PR, one DAG. Gaps are nodes inside that DAG, not tasks.
- Create a second task only for work with a different purpose. Tasks are independent when neither can affect the other's correctness; when that's unclear, keep one task.
- Across the wish, the unit of parallelism is the task, not a split of one task's DAG into several runs: each task has exactly one DAG, and the DAGs of independent tasks run at the same time. A task is never split into several DAGs to go faster. Large work splits into tasks only along the purpose lines above; a large single-purpose request stays one task and gets its concurrency from parallel nodes inside its DAG. The single loop goal still holds every task.
- Independent tasks run concurrently. A dependent task starts after its prerequisite merges. Approved merges happen one at a time.

## Delegation prompts

Every implementation, QA, and review prompt **MUST** carry the purpose boundary: the original request, the task's scope, what counts as a blocker (goal failure, introduced regression, invalid proof), and the instruction to report out-of-scope findings instead of fixing them. A reviewer that flags unrelated quality issues is producing follow-up notes, not blockers.

Before dispatch, check that the assignment itself explicitly contains all four items below. **NEVER** rely on the child having read the parent conversation or shared skill:

- Purpose: the original requested outcome.
- Scope: this assignment's permitted work.
- Blockers: goal failure, introduced regression, and invalid proof; state all three, including in implementation and QA assignments.
- Separate findings: report unrelated findings in your output and append them to the follow-up file when you can write it; do not fix them or treat them as blockers. The lead indexes them in memory.

The lead owns the boundary. When a child drifts, reporting unrelated work as required or widening its own scope, correct it with a follow-up message or a re-scoped prompt. Don't accept that work as a requirement.

## Progress reporting

Keep the todo list current for the whole run. At every node and stage transition, update the todo state (start, done, append, drop) and report it to the user in a short handoff naming what just finished, what is running, and what comes next. Never let the todo list lag behind the loop ledger or the DAG run.

## Finish

Stop when the requested work is merged, the full verification set passes on the merged result, task worktrees and merged task branches are removed, and the user has a report in their language covering results, honest limits, and separate findings. 

Out-of-scope findings **MUST** be documented and **MUST** also appear in the final report. For each one give the finding, its impact, why it wasn't fixed now, and its follow-up file path. If there were none, say so explicitly and don't create empty records. A note in a file alone isn't disclosure. The checklist is in `references/verification.md`.

Always respond in the user's language. Agent prompts stay in English.
