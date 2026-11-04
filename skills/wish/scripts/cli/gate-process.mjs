import { spawn } from "node:child_process";
import { existsSync } from "node:fs";

function runRows(rows, { timeoutSeconds, cwd }) {
  const workdir = cwd && existsSync(cwd) ? cwd : undefined;
  const jobs = rows.map((row) => new Promise((resolveRow) => {
    if (row.repro_cmd === "no command") {
      resolveRow({ id: row.id, command: row.repro_cmd, verdict: "INVALID", status: "no-command", note: "no reproduction yet" });
      return;
    }
    let child;
    try {
      child = spawn("/bin/sh", ["-c", row.repro_cmd], { cwd: workdir, detached: true, stdio: ["ignore", "pipe", "pipe"] });
    } catch (error) {
      resolveRow({ id: row.id, command: row.repro_cmd, verdict: "INVALID", status: "open", note: "spawn failed: " + (error?.code ?? "error") });
      return;
    }
    let settled = false;
    let timer = null;
    const finish = (entry) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      // INV4: nothing a row started may outlive it, including a grandchild that a
      // successful command left in the background.
      killGroup(child);
      if (child.pid) LIVE_GROUPS.delete(child.pid);
      resolveRow({ id: row.id, command: row.repro_cmd, ...entry });
    };
    const drain = () => {};
    child.stdout.on("data", drain);
    child.stderr.on("data", drain);
    if (child.pid) LIVE_GROUPS.add(child.pid);
    timer = setTimeout(() => {
      killGroup(child);
      finish({ verdict: "INVALID", status: "open", note: "timeout after " + timeoutSeconds + "s" });
    }, timeoutSeconds * 1000);
    child.on("error", (error) => finish({ verdict: "INVALID", status: "open", note: "spawn failed: " + (error?.code ?? "error") }));
    // "close" waits for every inherited pipe to close, which a background grandchild
    // can hold open past the row's real end; the shell's own exit status is the row's
    // verdict, and the group is killed right after it.
    child.on("exit", (code, signal) => finish({
      verdict: code === 0 ? "PASS" : "FAIL",
      status: code === 0 ? "fixed" : "not-fixed",
      note: code === 0 ? "exit 0" : signal ? "signal " + signal : "exit " + String(code),
    }));
  }));
  return Promise.all(jobs);
}

function killGroup(child) {
  if (!child?.pid) return;
  try {
    process.kill(-child.pid, "SIGKILL");
  } catch {
    try {
      child.kill("SIGKILL");
    } catch {
      // already gone
    }
  }
}


const LIVE_GROUPS = new Set();

function killAllGroups() {
  for (const pid of LIVE_GROUPS) {
    try {
      process.kill(-pid, "SIGKILL");
    } catch {
      // already gone
    }
  }
  LIVE_GROUPS.clear();
}

export { killAllGroups, runRows };
