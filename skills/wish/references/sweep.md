# wish: the pre-review defect-class sweep (step 7b)

Step 7b runs after step 7 and before step 8 opens the PR. It is one more pass, never a replacement: step 9 still dispatches ultrabrain on the swept head.

The measured classes come from eleven independent review rounds (agent-sense pull requests 8, 9, 10, 12, 21, 23 and genie 81, 2026-10-27). Those rounds produced 52 findings, 29 of them blocking, and 29 of the 29 blocking findings fall in the eight rows below (seven classes plus one split-boundary variant). Every probe has a fixture that proves it fails on its own class and stays quiet on a clean tree (`test/sweep.test.js`, `test/fixtures/sweep/`).

## What to do

1. Write one `SWEEP:` row in the plan for each probe the change needs, naming its public entry point. A probe the change does not touch is not declared, and the receipt shows it as `SKIP`.
2. Write `.wish-sweep.json` at the worktree root (shape below).
3. Run the sweep and fix every `FAIL`:

```sh
bun <skill-dir>/scripts/sweep.mjs --config .wish-sweep.json --json <evidenceRoot>/sweep.json
```

4. A pass hands the same class list to one `category: quick` pass over the final diff, for the claims a script cannot judge: behavior promised in prose, wire-schema fidelity, who owns a state transition. That pass writes `<evidenceRoot>/sweep-checklist.md`, one row per class (`CLASS | clean | finding | fixed`), and every `finding` is fixed and rechecked.
5. Paste the receipt path and the checklist path into the plan's step-9 row. The sweep's `FAIL` set and the reviewer's findings are then comparable.

## The probes

| Class (measured rows / blocking) | Probe | A `FAIL` means |
| --- | --- | --- |
| Credentials in errors and logs (8 / 7) | `secrets`: run each declared error path with a canary credential in the environment, then scan stdout, stderr and every declared log file | the canary reached output: redact before it is formatted, truncated or persisted |
| Panic on invalid input (1 / 1) | `boundary`: every declared case runs as declared plus empty stdin, invalid UTF-8 and a 4096-byte boundary with an invalid trailing byte | crash marker in the output, or an exit code outside the declared set |
| Cancellation and handler lifecycle (10 / 7) | `race` plus `lifecycle`: the race detector over the changed packages, and one start-cancel case that waits for a readiness line, sends the signal and measures the exit | a race diagnostic, a process group surviving its child, or an exit past the budget |
| Error chain dropped while wrapping (2 rows inside the class above) | `errors`: scan the added production lines for a re-wrap that hides the original error (`fmt.Errorf` with `%v`/`%s`, `new Error(err.message)`, an empty catch) | a wrapping site that `errors.Is`/`errors.As` cannot see through; `strict: true` makes it a `FAIL`, otherwise it reports `WARN` |
| Boundary and odd input (18 / 11) | `boundary` with declared cases for option-shaped operands, `--`, negative ids, oversize values and paths; a case with `expectStdout` compares what comes back with what went in | accepted invalid input, a crash, or output that does not return the input unchanged |
| Split-boundary variant: markup loses its attributes (1 / 1) | `boundary` with an `expectStdout` round-trip case around a tag that carries an attribute | the round trip changed the input |
| Tests that survive guard removal (8 / 1) | `mutation`: delete each added production line in a throwaway copy and require the declared suite to fail | `SURVIVED`: the suite stayed green without that line |
| Documentation contradicting code (5 / 0) | `docs`: every flag the changed docs promise must appear in the help output or in the declared known list; the semantic claims go to the quick checklist pass | a documented flag does not exist |
| Config keys accepted wrongly (1 / 1) | `config`: each declared accept case must exit 0 and each reject case must exit non-zero | a closed schema accepted an unknown key, or rejected a documented one |

`WARN` is a hit that needs a human read: the pattern matched but the context may justify it. A probe whose only results are `WARN` is reported `WARN`, not `SKIP`, and `WARN` alone does not fail the run.

`INVALID` is not a kill: a mutation that fails to compile, or a check that could not run, is recorded and repaired. A probe that cannot be configured is `SKIP`, and its class goes to the checklist pass with the reason written down. The runner executes each command once, clamps every declared timeout to at most 300 seconds inside the command runner, caps parallelism at 8, gives each command its own process group and kills that whole group on timeout or exit so a held pipe cannot outlive the cap, and never retries or sleeps.

## Config shape

```json
{
  "timeoutMs": 300000,
  "parallel": 4,
  "probes": {
    "secrets": {
      "canary": "<fresh random token>",
      "env": { "TEST_API_TOKEN": "<same token>" },
      "commands": [{ "name": "send-refusal", "cmd": "bin send --fail" }],
      "logs": ["*.log", "logs/*.log"]
    },
    "boundary": {
      "cases": [
        { "name": "send-stdin", "cmd": "bin send --stdin", "stdin": "hello", "expectExit": [0, 1] },
        { "name": "echo-markup", "cmd": "bin echo", "stdin": "<a href=\"x\">hi</a>", "expectExit": [0], "expectStdout": "<a href=\"x\">hi</a>" }
      ]
    },
    "race": { "cmd": "go test -race ./internal/..." },
    "errors": { "strict": true },
    "mutation": { "testCmd": "go test ./internal/...", "failMarker": "--- FAIL:", "max": 12 },
    "docs": { "helpCmd": "bin --help", "docs": ["docs/**/*.md"], "known": [] },
    "config": {
      "cases": [
        { "name": "known-key", "cmd": "bin config --file {tmp}", "file": { "text": "hi" }, "expect": "accept" },
        { "name": "unknown-key", "cmd": "bin config --file {tmp}", "file": { "text": "hi", "typo": 1 }, "expect": "reject" }
      ]
    },
    "lifecycle": {
      "cases": [{ "name": "serve", "argv": ["bin", "serve"], "ready": "listening", "signal": "SIGTERM", "budgetMs": 3000 }]
    }
  }
}
```

`mutation` reads the added lines of `git diff <base>...HEAD` when no `candidates` are declared; a declared `candidates` list (`[{ "file", "line" }]`) is for fixtures and for a diff already merged. `errors` reads the same added lines unless `lines` are declared. A `lifecycle` case takes `argv`, not a shell string, so the signal reaches the program itself. `expectStdout` applies to the declared input only; the generated empty, invalid-UTF-8 and boundary variants keep the exit and crash assertions.