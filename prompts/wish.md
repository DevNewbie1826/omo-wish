---
description: 소원을 빕니다
---
$ARGUMENTS

Use ultrawork explore to analyze the overall context and history of the work, assess the current problems and key decision points based on evidence, and define the evidence-based ideal target state. Based on that definition, divide the entire work into multiple Phases and execute each Phase sequentially through an ulw loop.

For each Phase, MUST create a new dedicated Git worktree, define concrete task objectives, then use mass ulw to implement, validate, test, and open a PR.

During execution, MUST actively use the js eval tool running on the Bun 1.4 runtime as the primary execution environment. Within each independently executable unit of work, consolidate as much executable logic as possible into a single large, comprehensive js eval cell—including complex and lengthy conditionals, nested ifs, for-loops, functional chaining, filtering, list-comprehension-style transformations, aggregation, util methods, and orchestration of advanced tool calls—and execute it in one shot. Even when the code is long or complex, NEVER fragment work that can be handled within js eval into shell commands or many small calls; maximize the amount of computation, branching, data processing, and tool orchestration performed within each js eval execution.

Independent units of work MUST be dispatched through as many large one-time tool calls as possible and executed in parallel, maximizing available parallelism and tool utilization. For long-running work, NEVER sleep or block while waiting; always run it asynchronously, monitor/subscribe to its progress, and continue executing other independent work and tool calls in parallel.

Afterward, have ultrabrain review the changes. If revisions are requested, decompose the feedback into independent tasks and dispatch as many deep agent workers in parallel as possible. Integrate the results, have ultrabrain review the combined changes again, and repeat this parallel review/fix loop until final approval.

NEVER merge the PR before ultrabrain gives final approval. Once approved, merge it and move to the next Phase. Continue the ulw loop until all Phases are complete.

Always respond in the user's language.
