---
description: 소원을 빕니다
---
$ARGUMENTS

Use ultrawork explore to analyze the overall context and history of the work, assess the current problems and key decision points based on evidence, and define the ideal state as one concrete top-level goal. This goal and the task, review, and merge execution principles below MUST remain the governing criteria until the entire work is complete.

Apply the system-provided tool execution and eval policies consistently throughout the entire run.

Group all work required to achieve this top-level goal into tasks by relatedness: related work stays in one task, and tasks are independent only when neither can affect the other's correctness — when in doubt, keep them together or make one depend on the other. Run an ulw loop on this top-level goal; within it, each task owns its own worktree, PR, review loop, and merge, and any work discovered later is added as new tasks under the same goal.

Run independent tasks concurrently, each as its own DAG chain; a task that depends on another starts after that task is merged. For each task, MUST create a new dedicated Git worktree, define the concrete work and its scope, then use mass ulw to implement, validate, test, and open a PR — parallel nodes only where the same independence holds, dependent nodes in order — with an ultrabrain review as the final node. The review MUST end with the verdict APPROVED or REVISE, and on REVISE a numbered list of required changes.

On REVISE, build the next DAG in the same worktree from that verdict: dispatch as many deep agent workers in parallel as possible, one per independent change, followed by verification and an ultrabrain re-review as the final node. Repeat until APPROVED.

NEVER let anything land on main before ultrabrain gives APPROVED. Merge tasks one at a time; right before each merge, sync the task branch with the latest main and re-run its verification, and if that changes the reviewed change or fails, obtain a fresh APPROVED before merging. Once every task is merged and main is green, ultrabrain MUST review the whole of main against the original top-level goal; on REVISE, add the findings as new tasks in this same loop.

The ulw loop ends only when every task is merged with APPROVED, main is green, and that final review is APPROVED.

Always respond in the user's language.
