---
wish:
  run_id: w-tokenizer-gaps-20261028-0900
  tier: M
  type: code
  unit: u1
  program_id: null
  worktree: /srv/worktrees/tokenizer-gaps
  branch: tokenizer-gaps
  pr: null
  frozen_head: null
  round: 0
---

# Tokenizer: close two register rows

## Todos

- [ ] 1. n-parse: return an empty token list for an empty input

## Final verification wave

- [ ] F1. n-verify: run the suite and both QA scenarios

## Contract

- IS-1: an empty input yields an empty token list without an error ; criterion: QA-1 ; gap: G1
- IS-2: the usage text names the empty-input behavior ; criterion: QA-2 ; gap: G2
- INVARIANT INV1: a non-empty input yields the same tokens as before : QA-1
- IS-1 DEVICE: guard INV1 -> n-parse
- IS-2 DEVICE: qa tokenizer --help => exit 0 and the first line names the empty input
- G2 DEVICE: qa tokenizer --help => the usage text names the empty-input behavior

## QA scenarios

- QA-1: run the tokenizer on an empty input ; pass when: exit 0 and stdout is empty ; evidence: <evidence-root>/qa1-empty.log ; run: printf '' | tokenizer -
- QA-2: read the usage text ; pass when: exit 0 and the text names the empty input ; evidence: <evidence-root>/qa2-usage.log ; run: tokenizer --help

## Risk list

- guard: INV1 : a non-empty input loses a token -> n-parse

## Pinned rules

- Every command pins the task worktree /srv/worktrees/tokenizer-gaps.
- Commits are serialized.
