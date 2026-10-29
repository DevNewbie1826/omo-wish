---
wish:
  run_id: w-settings-page-20261028-0900
  tier: M
  type: design
  unit: u1
  program_id: null
  worktree: /srv/worktrees/settings-page
  branch: settings-page
  pr: null
  frozen_head: null
  round: 0
---

# Settings page: one primary action

## Todos

- [ ] 1. n-build: rebuild the settings form header

## Final verification wave

- [ ] F1. n-verify: run visual-qa Pass A and Pass B on the fresh captures

## Contract

- IS-1: the settings page has one prominent primary action on every width ; criterion: QA-1
- INVARIANT INV1: the save button keeps its label : QA-1
- LIMIT: print stylesheets are not captured : the request names on-screen surfaces only
- IS-1 DEVICE: vqa B1,B7 @ 390/1440 light/dark pair settings-default-390-dark
- SCREEN: /settings ; primary: save the form ; priorities: 1 the form, 2 the danger zone, 3 the audit log ; left-out: a decorative badge ; required: the email field, the export button ; layout: form left, audit log right

## QA scenarios

- QA-1: capture the settings page at 390 and 1440 in both themes ; pass when: visual-qa reports no defect item ; evidence: <evidence-root>/qa1-settings.log ; run: bun run visual-qa --route /settings

## Risk list

- guard: INV1 : the label disappears at 390 -> n-build
- no-test: the visual verdict is a reviewer judgment : QA-1

## Pinned rules

- Every command pins the task worktree /srv/worktrees/settings-page.
- Commits are serialized.
