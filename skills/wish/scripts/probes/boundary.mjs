// Class PANIC and C — a contract input must not crash the program, and output
// that is supposed to return an input must return it unchanged.
//
// Measured: 18 boundary rows, 11 blocking, plus the 1 blocking panic and the
// one split-boundary variant where markup lost its attributes. Every declared
// case runs as declared and then with empty stdin, invalid UTF-8, and a 4096
// byte boundary whose trailing byte is invalid.

import { crashIn, row, runCommand, isMain, probeCli } from "./lib.mjs";

export const name = "boundary";
export const types = ["code"];
export const summary = "declared case, empty, invalid UTF-8 and 4096-byte boundary input";

export const usage = `config:
  "probes": { "boundary": { "cases": [
    { "name": "send-stdin", "cmd": "bin send --stdin", "stdin": "hello", "expectExit": [0, 1] },
    { "name": "echo-markup", "cmd": "bin echo", "stdin": "<a href=\\"x\\">hi</a>",
      "expectExit": [0], "expectStdout": "<a href=\\"x\\">hi</a>" }
  ] } }

Each case runs as declared and then three generated variants: empty stdin,
invalid UTF-8, and a 4096-byte boundary with an invalid trailing byte. FAIL
means a crash marker in the output, an exit code outside "expectExit", or an
"expectStdout" round trip that did not return the input unchanged. "expectStdout"
is compared on the declared input only; the generated variants keep the exit and
crash assertions.`;

function variants(baseStdin) {
  const prefix = Buffer.from(baseStdin ?? "");
  return [
    { id: "empty", stdin: "" },
    { id: "invalid-utf8", stdin: Buffer.concat([prefix, Buffer.from([0xff, 0x62])]) },
    { id: "boundary-4096", stdin: Buffer.concat([Buffer.alloc(4095, 0x61), Buffer.from([0xff, 0x62])]) },
  ];
}

export async function run(config, ctx) {
  const checks = [];
  for (const testCase of config.cases ?? []) {
    const declared = [{ id: "declared", stdin: testCase.stdin }];
    const list = testCase.stdin !== undefined ? [...declared, ...variants(testCase.stdin)] : declared;
    for (const variant of list) {
      const result = await runCommand({
        cmd: testCase.cmd,
        cwd: ctx.root,
        stdin: variant.stdin,
        timeoutMs: testCase.timeoutMs ?? ctx.timeoutMs,
      });
      const allowed = testCase.expectExit ?? [0];
      const crash = crashIn(`${result.stdout}\n${result.stderr}`);
      const roundTrip = testCase.expectStdout === undefined || variant.id !== "declared"
        || result.stdout.trim() === testCase.expectStdout;
      const ok = !result.timedOut && !crash && allowed.includes(result.code) && roundTrip;
      const note = result.timedOut
        ? `timed out after ${result.ms} ms`
        : crash
          ? `crash marker ${crash.join(", ")}`
          : !roundTrip
            ? `the round trip changed the input (got ${JSON.stringify(result.stdout.trim().slice(0, 120))})`
            : `exit ${result.code}${allowed.includes(result.code) ? "" : ` not in [${allowed.join(",")}]`}`;
      checks.push(row({
        id: `boundary/${testCase.name}:${variant.id}`,
        command: testCase.cmd,
        observable: `the exit code is in [${allowed.join(",")}] with no crash marker${testCase.expectStdout === undefined ? "" : " and the declared input comes back unchanged"}`,
        verdict: ok ? "PASS" : "FAIL",
        cls: ctx.classFor(crash ? "PANIC" : "C"),
        note,
      }));
    }
  }
  if (checks.length === 0) {
    return [row({ id: "boundary", verdict: "SKIP", observable: "a case is declared", cls: ctx.classFor("C"), note: "no cases declared" })];
  }
  return checks;
}

if (isMain(import.meta.url)) await probeCli({ name, types, summary, usage, run });