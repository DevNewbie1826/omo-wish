# Confirmation devices

Every implementation and fix includes a device that confirms the requirement is met, and leaves the method and the result so another agent can repeat the check under the same conditions.

## What to leave

Use whichever fit the change:

- commands run and their exit codes
- how tests were run, and what passed and failed
- input conditions, and expected against actual input and output
- the before/after diff mapped to each requirement
- before/after screenshots for visual changes
- steps that reproduce the real behaviour, and what was observed
- items not verified, and why

## Rules

1. **Direct:** check the requirement itself, not a stand-in for it.
2. **Reproducible:** leave the conditions, steps and results another agent needs to repeat the check.
3. **Minimal:** reuse existing tests, commands and tools; build a new check only when they are not enough.
4. **Fitting:** run or test code, check a UI's screen and behaviour, compare a document's content and diff.
5. **Effective:** no ceremonial checks that cannot catch a real error, no duplicate checks, no checks for their own sake.
6. **Accurate:** when a check fails, fix and check again; never claim what you did not verify.

A device is not a new test file or a new verification system each time. A repeatable method and its real result are enough. Verify strictly and briefly: once the needed accuracy is reached, add no further steps.
