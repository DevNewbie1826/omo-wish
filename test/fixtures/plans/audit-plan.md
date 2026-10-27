---
wish:
  run_id: w-contrast-audit-20261028-0900
  tier: M
  type: audit
  unit: u1
  program_id: null
  worktree: /srv/worktrees/contrast-audit
  branch: contrast-audit
  pr: null
  frozen_head: null
  round: 0
---

# Contrast audit

## Todos

- [ ] 1. n-judge: judge every rule against every surface

## Final verification wave

- [ ] F1. n-verify: re-run the lint lane and reproduce the spot sample

## Contract

- IS-1: every rule of the corpus is judged against every surface ; criterion: QA-1
- LIMIT: hover-only states are unjudged : no capture harness reaches them in this pass
- IS-1 DEVICE: spot 12 rows reproduce
- RULE: contrast-ratio : every text pair meets 4.5 to 1

## QA scenarios

- QA-1: reproduce a random spot sample of the register ; pass when: exit 0 and all sampled rows reproduce ; evidence: <evidence-root>/qa1-spot.log ; run: bun run spot --rows 12

## Risk list

- guard: IS-1 : a surface is skipped and the register still passes -> n-judge

## Pinned rules

- Every command pins the task worktree /srv/worktrees/contrast-audit.
- Commits are serialized.
