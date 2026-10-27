---
wish:
  run_id: w-tokenizer-20261028-0900
  tier: S
  type: code
  unit: u1
  program_id: null
  worktree: /srv/worktrees/tokenizer
  branch: tokenizer
  pr: null
  frozen_head: null
  round: 0
---

# Tokenizer: accept empty input

## Todos

- [ ] 1. n-parse: return an empty token list for an empty input
- [ ] 2. n-test: cover the empty input and the single-token input

## Final verification wave

- [ ] F1. n-verify: run the suite and QA-1 on the real command

## Contract

- IS-1: an empty input yields an empty token list without an error ; criterion: QA-1
- IS-2: the usage text names the empty-input behavior ; criterion: QA-2
- COMPANION: the usage text of the sibling command <- IS-2 : the same one-line text change ships in this PR
- INVARIANT INV1: a non-empty input yields the same tokens as before : QA-2
- LIMIT: tab-separated input is not tokenized : the request covers whitespace-separated input only
- IS-1 DEVICE: guard INV1 -> n-test
- IS-2 DEVICE: qa tokenizer --help => exit 0 and the first line names the empty input

## QA scenarios

- QA-1: run the tokenizer on an empty input ; pass when: exit 0 and stdout is empty ; evidence: <evidence-root>/qa1-empty.log ; run: printf '' | tokenizer -
- QA-2: run the tokenizer on the regression fixture ; pass when: exit 0 and stdout equals the expected lines ; evidence: <evidence-root>/qa2-regression.log ; run: tokenizer test/fixtures/tokens.txt

## Risk list

- guard: INV1 : a non-empty input loses a token -> n-test
- guard: IS-1 : an empty input exits non-zero -> n-parse
- no-test: the usage text is prose : QA-2
- HIGH-RISK: IS-1 (state) -> n-parse

## Pinned rules

- Every command pins the task worktree /srv/worktrees/tokenizer.
- Commits are serialized.
