---
description: 소원을 빕니다
---
$ARGUMENTS

Use ultrawork explore to analyze the overall context and history of the work, assess the current problems and key decision points based on evidence, and define the ideal state as one concrete top-level goal. This goal and the execution principles below MUST remain the governing criteria until the entire work is complete.

Apply the system-provided tool execution and eval policies consistently throughout the entire run.

Group related work into tasks under a single ulw loop for this top-level goal. Tasks are execution units, not separate goals. Run independent task DAGs concurrently and order dependent work by its actual prerequisites. Keep work together when it cannot be safely separated.

For each task, MUST create a dedicated Git worktree and use mass ulw to construct a DAG around the work and its actual dependencies. End that same DAG with combined verification -> PR creation -> ultrabrain review, in that dependency order. In every DAG, run independent work in parallel with disjoint write scopes and dependent work in order. The final ultrabrain review in each DAG MUST end with APPROVED or REVISE and list required changes on REVISE.

On REVISE, MUST build the next mass ulw DAG in the same worktree from the required changes. Run independent fixes in parallel, verify the combined result, and have ultrabrain re-review as the final node. Repeat until APPROVED.

NEVER merge a PR before ultrabrain gives APPROVED. Merge approved tasks one at a time without waiting for unrelated tasks. When integration with other changes affects a task's behavior, verify only the affected behavior. Reuse verification results that remain valid. If the approved implementation changes substantively, have ultrabrain re-review it before merging. Once all tasks are merged and the original top-level goal is fully satisfied, remove the task worktrees and merged task branches used for this work, then end the ulw loop.

Always respond in the user's language.
