---
description: 소원을 빕니다
argument-hint: [작업 설명]
---
$ARGUMENTS

Use ultrawork explore to analyze the overall context and history of the work, identify the current problems and key decision points based on evidence, and define the ideal target state. Based on that definition, divide the entire work into multiple Phases and execute each Phase sequentially through an ulw loop.

For each Phase, create a new dedicated Git worktree, define concrete task objectives, use mass ulw to carry out the work, and then open a PR. During execution, MUST use the js eval tool with the bun 1.4 skill as the primary execution method. Consolidate as much logic as possible—including complex conditionals, if statements, for-loops, functional chaining, filtering, list comprehensions, aggregation, and util methods—into a single large js eval tool call. Avoid unnecessarily fragmenting the work into small calls; whenever possible, handle large code blocks and advanced logic in one js eval execution. Run as many independent tasks as possible through big parallel tool calls and maximize parallel execution wherever applicable. For long-running work, do not simply sleep or block; run it asynchronously, monitor/subscribe to its progress, and continue working on other tasks in parallel.

Afterward, have ultrabrain review the changes, and if revisions are requested, have deep agent apply them. Repeat this process until ultrabrain gives final approval. Once approved, merge the PR, move to the next Phase, and continue the ulw loop until all Phases are complete.

Always respond in the user's language.
