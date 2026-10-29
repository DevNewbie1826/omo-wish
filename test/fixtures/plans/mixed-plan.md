---
wish:
  run_id: w-settings-flag-20261028-0900
  tier: M
  type: mixed
  unit: u1
  program_id: null
  worktree: /srv/worktrees/settings-flag
  branch: settings-flag
  pr: null
  frozen_head: null
  round: 0
---

# Settings page behind a flag

## Todos

- [ ] 1. n-build: add the flag and rebuild the settings header

## Final verification wave

- [ ] F1. n-verify: run the suite, the sweep and the visual captures

## Contract

- IS-1: the flag turns the new header on without a reload ; criterion: QA-1
- IS-2: the header keeps one primary action at every width ; criterion: QA-2
- INVARIANT INV1: the flag defaults to off for existing installs : QA-1
- LIMIT: the flag has no targeting rules : the request asks for an on/off switch only
- IS-1 DEVICE: guard INV1 -> n-build
- IS-2 DEVICE: vqa B1 @ 390 light pair settings-flag-390-light
- SCREEN: /settings ; primary: save the form ; priorities: 1 the flag row, 2 the form, 3 the audit log ; left-out: a promotional badge ; required: the flag switch, the email field

## QA scenarios

- QA-1: toggle the flag and read the header state ; pass when: exit 0 and the header renders the new markup ; evidence: <evidence-root>/qa1-flag.log ; run: bun run flag-check --install fresh
- QA-2: capture the flagged header at 390 in light ; pass when: one primary action is prominent ; evidence: <evidence-root>/qa2-header.log ; run: bun run visual-qa --route /settings --flag on

## Risk list

- guard: INV1 : a fresh install starts with the flag on -> n-build

## Pinned rules

- Every command pins the task worktree /srv/worktrees/settings-flag.
- Commits are serialized.
