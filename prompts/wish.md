---
description: 소원을 빕니다
---
$ARGUMENTS

Use ultrawork explore to analyze the overall context and history of the work, assess the current problems and key decision points based on evidence, and define the ideal state as one concrete top-level goal. This goal and the task, review, and merge execution principles below MUST remain the governing criteria until the entire work is complete.

Apply the system-provided tool execution and eval policies consistently throughout the entire run, together with the orchestration principles below.

Group all work required to achieve this top-level goal into tasks by relatedness: related work stays in one task, and tasks are independent only when neither can affect the other's correctness — when in doubt, keep them together or make one depend on the other. Run an ulw loop with this top-level goal as its only goal — tasks are never separate goals; within it, each task owns its own worktree, PR, review loop, and merge, and work discovered later is grouped the same way.

Run independent tasks concurrently, each as its own DAG chain; a task that depends on another starts after that task is merged. For each task, MUST create a new dedicated Git worktree, define the concrete work and its scope, and MUST run the work as one mass ulw DAG containing implementation nodes (parallel only where the same independence holds, otherwise in dependency order), a verification node, a PR node whose PR body cites the DAG run, and an ultrabrain review as the final node. This holds even for a single small change: the orchestrating session NEVER edits repository files itself — every change, including conflict resolution, is made by a DAG node. The review MUST end with the verdict APPROVED or REVISE, and on REVISE a numbered list of required changes.

On REVISE, MUST build the next DAG in the same worktree from the required changes: dispatch deep agent workers one per change, as many in parallel as the same independence rule allows, followed by a verification node and an ultrabrain re-review as the final node. Repeat until APPROVED.

NEVER let anything land on main before ultrabrain gives APPROVED. Merge tasks one at a time; right before each merge, sync the task branch with the latest main and re-run its verification, and if the sync produces conflicts, alters the reviewed change, or fails verification, return the task to the fix DAG loop with those conflicts or failures as the required changes, and merge only after its ultrabrain re-review gives APPROVED. Once every task is merged and main is green, ultrabrain MUST review the whole of main against the original top-level goal; on REVISE, add the findings as new tasks in this same loop.

The ulw loop ends only when every task is merged with APPROVED, main is green, and that final review is APPROVED.

Always respond in the user's language.
