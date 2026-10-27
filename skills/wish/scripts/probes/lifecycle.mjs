// Class S — cancellation and handler lifetime.
//
// Measured: 10 rows, 7 blocking. This probe asks the sharper question: after the
// program reports readiness and receives a signal, does the process group die
// within its budget, or does a handler keep it (and any child) alive?

import { spawn } from "node:child_process";
import { clampMs, killSession, mapPool, row, sessionMembers, isMain, probeCli } from "./lib.mjs";

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
(SIGTERM), and requires the whole session to be gone within "budgetMs"; a failure
tears the whole session down, so a child that moved into its own group cannot be
left behind. "budgetMs" and "readyTimeoutMs" are clamped to the 300 s ceiling.
FAIL means no readiness line, a living survivor after the child exited, or an exit
past the budget.`;

// The session read-back is the living-child test: our direct child is already
// reaped when `close` fires, so any remaining non-zombie member is a survivor —
// including one that moved into its own process group. A zombie-only group under a
// subreaper is not a survivor, which is why the group probe is not consulted here.
function survivors(pid) {
  return sessionMembers(pid).map((member) => `pid ${member}`);
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
    const budgetMs = clampMs(testCase.budgetMs, 5000);
    const readyMs = clampMs(testCase.readyTimeoutMs, 10000);
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
      if (verdict === "FAIL") killSession(child.pid);
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
      () => finish("FAIL", `no readiness signal within ${readyMs} ms`),
      readyMs,
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