// Class S — cancellation and handler lifetime.
//
// Measured: 10 rows, 7 blocking. This probe asks the sharper question: after the
// program reports readiness and receives a signal, does the process group die
// within its budget, or does a handler keep it (and any child) alive?

import { spawn } from "node:child_process";
import { mapPool, row, sessionMembers, isMain, probeCli } from "./lib.mjs";

export const name = "lifecycle";
export const types = ["code"];
export const summary = "a start-cancel case exits within its budget and leaves no group";

export const usage = `config:
  "probes": { "lifecycle": { "cases": [
    { "name": "serve", "argv": ["bin", "serve"], "ready": "listening",
      "signal": "SIGTERM", "budgetMs": 3000, "readyTimeoutMs": 10000 }
  ] } }

A case takes "argv", not a shell string, so the signal reaches the program
itself. The probe waits for "ready" on stdout or stderr, sends "signal"
(SIGTERM), and requires the whole process group to be gone within "budgetMs".
FAIL means no readiness line, a group still alive after the child exited, or an
exit past the budget.`;

// The group is the primary signal; the session read-back also catches a child that
// moved itself into another group while staying in the same session.
function survivors(pid) {
  const alive = [];
  try {
    process.kill(-pid, 0);
    alive.push(`group ${pid}`);
  } catch {
    /* the group is gone */
  }
  for (const member of sessionMembers(pid)) alive.push(`pid ${member}`);
  return alive;
}

function runCase(testCase, ctx) {
  return new Promise((resolvePromise) => {
    if (!Array.isArray(testCase.argv) || testCase.argv.length === 0) {
      resolvePromise([row({
        id: `lifecycle/${testCase.name}`,
        verdict: "FAIL",
        observable: "the case declares an argv array and the group is gone after the signal",
        cls: ctx.classFor("S"),
        note: "a lifecycle case needs an argv array, so the probe signals the program itself and not a shell",
      })]);
      return;
    }
    const ready = new RegExp(testCase.ready ?? ".", "m");
    const budgetMs = testCase.budgetMs ?? 5000;
    const signal = testCase.signal ?? "SIGTERM";
    const [file, ...argv] = testCase.argv;
    const child = spawn(file, argv, { cwd: ctx.root, detached: true, env: process.env, stdio: ["ignore", "pipe", "pipe"] });
    const chunks = [];
    let seenReady = false;
    let settled = false;
    let signalStart = 0;
    let budgetTimer;
    const finish = (verdict, note) => {
      if (settled) return;
      settled = true;
      clearTimeout(readyTimer);
      clearTimeout(budgetTimer);
      if (verdict === "FAIL") {
        try {
          process.kill(-child.pid, "SIGKILL");
        } catch {
          /* already gone */
        }
      }
      resolvePromise([row({
        id: `lifecycle/${testCase.name}`,
        command: testCase.argv.join(" "),
        observable: `the group is gone within ${budgetMs} ms of ${signal}`,
        verdict,
        cls: ctx.classFor("S"),
        note,
      })]);
    };
    const onData = (chunk) => {
      chunks.push(chunk.toString("utf8"));
      if (seenReady || !ready.test(chunks.join(""))) return;
      seenReady = true;
      clearTimeout(readyTimer);
      signalStart = Date.now();
      try {
        process.kill(-child.pid, signal);
      } catch {
        /* exited first */
      }
      budgetTimer = setTimeout(() => finish("FAIL", `still alive ${budgetMs} ms after ${signal}`), budgetMs);
    };
    const readyTimer = setTimeout(
      () => finish("FAIL", `no readiness signal within ${testCase.readyTimeoutMs ?? 10000} ms`),
      testCase.readyTimeoutMs ?? 10000,
    );
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    child.on("error", (error) => finish("FAIL", `spawn error: ${error}`));
    child.on("close", (code, exitSignal) => {
      if (!seenReady) return finish("FAIL", "exited before the readiness signal");
      const latency = Date.now() - signalStart;
      const alive = survivors(child.pid);
      if (alive.length > 0) return finish("FAIL", `the direct child exited in ${latency} ms but ${alive.join(", ")} still lives`);
      finish(latency <= budgetMs ? "PASS" : "FAIL", `exited in ${latency} ms (${exitSignal ?? `code ${code}`}), budget ${budgetMs} ms`);
    });
  });
}

export async function run(config, ctx) {
  const cases = config.cases ?? [];
  if (cases.length === 0) {
    return [row({ id: "lifecycle", verdict: "SKIP", observable: "a lifecycle case is declared", cls: ctx.classFor("S"), note: "no lifecycle cases declared" })];
  }
  const results = await mapPool(cases, Math.min(8, ctx.parallel), (testCase) => runCase(testCase, ctx));
  return results.flat();
}

if (isMain(import.meta.url)) await probeCli({ name, types, summary, usage, run });