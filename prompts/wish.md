---
description: 소원을 빕니다
---
$ARGUMENTS

Use ultrawork explore to analyze the overall context and history of the work, assess the current problems and key decision points based on evidence, and define the ideal state as one concrete top-level goal. This goal and the execution principles below MUST remain the governing criteria until the entire work is complete.

Apply the system-provided tool execution and eval policies consistently throughout the entire run.

Group all work required to achieve this goal by relatedness: related work stays in one task, and dependent work either stays together or runs as ordered tasks with an explicit dependency (the dependent task starts after its prerequisite is merged). Run concurrently only tasks that cannot affect each other's correctness; when that is unclear, keep the work together. Run a single ulw loop on this top-level goal; tasks are execution units, never separate goals, and newly discovered work follows the same grouping rule.

For each task, MUST create a dedicated Git worktree and use mass ulw to run implementation, verification, PR creation, and ultrabrain review as one DAG. Within each DAG, run independent work in parallel and dependent work in order. The review MUST end with the verdict APPROVED or REVISE, and on REVISE a numbered list of required changes.

If ultrabrain returns REVISE, MUST build the next mass ulw DAG in the same worktree from the required changes. Dispatch parallel workers for independent changes where possible, verify the combined result, and have ultrabrain re-review as the final node of the DAG. Repeat this DAG review/fix loop until APPROVED. NEVER merge before ultrabrain gives APPROVED.

Run independent task DAGs concurrently. Merge tasks one at a time; right before each merge, sync the task branch with the latest main and re-run verification. If the sync produces conflicts, alters the reviewed change, or verification fails, return the task to the fix DAG loop and require a fresh APPROVED before merging.

Once every task is merged and main is green, have ultrabrain review the whole of main against the original top-level goal. On REVISE, add the findings as new tasks under the same goal and continue the ulw loop. End the ulw loop only when every task is merged, main is green, and the final review is APPROVED.

Always respond in the user's language.
