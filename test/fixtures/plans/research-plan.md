---
wish:
  run_id: w-adoption-report-20261028-0900
  tier: M
  type: research
  unit: u1
  program_id: null
  worktree: /srv/worktrees/adoption-report
  branch: adoption-report
  pr: null
  frozen_head: null
  round: 0
---

# Adoption report

## Todos

- [ ] 1. n-collect: collect primary sources for every claim

## Final verification wave

- [ ] F1. n-verify: run the claim gate and the fact verify pass

## Contract

- IS-1: the report answers the adoption claim with a primary source from a second domain ; criterion: QA-1
- INVARIANT INV1: every quoted sentence is verbatim : QA-1
- LIMIT: offline archives are not sampled : the source floor names the online corpus only
- IS-1 DEVICE: claim C1 gate(primary, domains>=2, counter-search)
- AXIS: adoption : how many teams adopted the tool in the last year
- CLAIM: C1 : more than half of the surveyed teams adopted the tool

## QA scenarios

- QA-1: run the claim gate on the resolved claim graph ; pass when: exit 0 and every claim is supported ; evidence: <evidence-root>/qa1-claims.log ; run: bun run claim-gate --claims claims/resolved.json

## Risk list

- guard: INV1 : a quote is paraphrased and the gate passes -> n-collect

## Pinned rules

- Every command pins the task worktree /srv/worktrees/adoption-report.
- Commits are serialized.
