---
wish:
  run_id: w-fixture-20261027-1600
  tier: M
  type: code
  unit: u1
  program_id: null
  worktree: __WORKTREE__
  branch: fixture
  pr: null
  frozen_head: null
  round: 0
---

# fixture plan

## Purpose

Deliver the fixture increment and prove it on the real surface.

## Contract

### IS rows

| id | statement |
| --- | --- |
| IS1 | the fixture behaviour exists |

### LIMIT rows (known limits, accepted)

| id | limit |
| --- | --- |
| LIM1 | the fixture never leaves its temp directory |

## QA scenarios

| id | invocation | observable |
| --- | --- | --- |
| QA1 | `wish status` | exit 0 |