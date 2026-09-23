---
description: 소원을 빕니다
---
$ARGUMENTS

Use ultrawork explore to analyze the overall context and history of the work and assess the current problems and key decision points based on evidence. Imagine how users use the product now and how they will use it. Define the ideal state, where those users hit no friction, nothing feels wrong, and no regression or degraded experience occurs, as one concrete top-level goal. List every gap between the ideal state and the current state. Before implementing, define user-facing QA scenarios that prove the ideal state is reached, based on each gap and every point where users could get stuck. This goal, the gap list, the QA scenarios, and the execution principles below MUST remain the governing criteria until the entire work is complete. NEVER narrow the scope or weaken the criteria or scenarios to finish the work. Add gaps discovered during the work to the list with matching QA scenarios, and group them into tasks the same way.

Apply the system-provided tool execution and eval policies consistently throughout the entire run.

Group gaps into one task only when they cannot be safely separated; otherwise make them separate tasks under a single ulw loop for this top-level goal. Tasks are execution units, not separate goals; each task is one worktree and one PR with its own DAG. Tasks are independent when neither can affect the other's correctness. When independence is unclear, keep them in one task. Parallelize at both levels: run the DAGs of independent tasks concurrently, not one after another, and inside each DAG run independent nodes in parallel. Start a dependent task only after its prerequisite task is merged.

For each task, MUST create a dedicated Git worktree and use mass ulw to construct a DAG around the work and its actual dependencies. End that same DAG with combined verification including the task's QA scenarios -> PR creation -> ultrabrain review, in that dependency order. In every DAG, including REVISE DAGs, split the work into independent nodes wherever correctness allows, and run independent nodes in parallel with disjoint write scopes and dependent nodes in order. The final ultrabrain review in each DAG MUST end with APPROVED or REVISE and list required changes on REVISE.

On REVISE, MUST build the next mass ulw DAG in the same worktree from the required changes. Run independent fixes in parallel, verify the combined result including the task's QA scenarios, and have ultrabrain re-review as the final node. Repeat until APPROVED.

NEVER merge a PR before ultrabrain gives APPROVED. Merge approved tasks one at a time without waiting for unrelated tasks. When integration with other changes affects a task's behavior, verify only the affected behavior. Reuse verification results that remain valid. If the approved implementation changes substantively, have ultrabrain re-review it before merging. Once all tasks are merged, confirm that every QA scenario passes on the merged result, reusing results that remain valid and rerunning only the scenarios the merges affected. If any scenario fails, make its cause a new task and handle it through the same flow. Once the original top-level goal is fully satisfied, remove the task worktrees and merged task branches used for this work, then end the ulw loop.

Always respond in the user's language.
