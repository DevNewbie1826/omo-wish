import { afterEach, expect, test } from "bun:test";
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const worktree = join(here, "..");
const cliPath = join(worktree, "skills/wish/scripts/wish.mjs");
const sandboxes = [];

afterEach(() => {
  for (const dir of sandboxes.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function cli(args) {
  return spawnSync(process.execPath, [cliPath, ...args], {
    cwd: worktree, encoding: "utf8", timeout: 60_000, env: process.env,
  });
}

function scene() {
  const dir = mkdtempSync(join(tmpdir(), "wish-tail-"));
  sandboxes.push(dir);
  const root = join(dir, "evidence");
  const plan = join(dir, "plan.md");
  const ledger = join(root, "ledger.jsonl");
  const init = cli(["init", "--run-id", "w-tail-20261027-1600", "--type", "code",
    "--tier", "M", "--plan", plan, "--root", root, "--unit", "u1",
    "--worktree", worktree, "--branch", "fixture", "--fact", "tail recovery"]);
  expect({ code: init.status, error: init.stderr }).toEqual({ code: 0, error: "" });
  return { dir, root, ledger };
}

function append(state, event) {
  const file = join(state.dir, "event.json");
  writeFileSync(file, JSON.stringify(event));
  return cli(["ledger", "append", "--event", event.event, "--json", file, "--root", state.root]);
}

function status(state) {
  return cli(["status", "--json", "--root", state.root]);
}

const collect = { event: "collect", sources: 1, elements: 2, report: "collect.md" };
const define = { event: "define", round: 0, ideal: 1, gaps: 0, report: "define.md" };

test("SIGKILL torn tail is read without mutation and repaired on append", async () => {
  const state = scene();
  const before = readFileSync(state.ledger, "utf8");
  const line = JSON.stringify({ event: "collect", detail: "interrupted write" }) + "\n";
  const script = `
    const fs = require("node:fs");
    const fd = fs.openSync(process.argv[1], "a");
    const line = process.argv[2];
    fs.writeSync(fd, line.slice(0, Math.floor(line.length / 2)));
    process.stdout.write("READY\\n");
    process.stdin.resume();
  `;
  const child = spawn(process.execPath, ["-e", script, state.ledger, line], {
    stdio: ["pipe", "pipe", "pipe"], env: process.env,
  });
  const exited = new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => resolve({ code, signal }));
  });
  try {
    await new Promise((resolve, reject) => {
      let output = "";
      const timeout = setTimeout(() => reject(new Error("child did not signal its partial write")), 10_000);
      child.stdout.on("data", (chunk) => {
        output += chunk.toString();
        if (output.includes("READY\n")) {
          clearTimeout(timeout);
          resolve();
        }
      });
      child.once("error", (error) => { clearTimeout(timeout); reject(error); });
      child.once("exit", () => { clearTimeout(timeout); reject(new Error("child exited before sentinel")); });
    });
    child.kill("SIGKILL");
    expect(await exited).toEqual({ code: null, signal: "SIGKILL" });
    const torn = readFileSync(state.ledger, "utf8");
    expect(torn).toBe(before + line.slice(0, Math.floor(line.length / 2)));
    const report = status(state);
    expect({ code: report.status, error: report.stderr }).toEqual({ code: 0, error: "" });
    expect(readFileSync(state.ledger, "utf8")).toBe(torn);
    const result = append(state, collect);
    expect({ code: result.status, error: result.stderr }).toEqual({ code: 0, error: "" });
    expect(status(state).status).toBe(0);
    const final = readFileSync(state.ledger, "utf8");
    expect(final.endsWith("\n")).toBe(true);
    expect(final.split("\n").slice(0, -1).map(JSON.parse)).toEqual([
      ...before.trimEnd().split("\n").map(JSON.parse), JSON.parse(result.stdout),
    ]);
  } finally {
    child.kill("SIGKILL");
    await exited;
  }
});

test("valid unterminated event is retained and the next append gets its own line", () => {
  const state = scene();
  const first = append(state, collect);
  expect(first.status).toBe(0);
  const text = readFileSync(state.ledger, "utf8");
  writeFileSync(state.ledger, text.slice(0, -1));
  expect(status(state).status).toBe(0);
  const next = append(state, define);
  expect({ code: next.status, error: next.stderr }).toEqual({ code: 0, error: "" });
  expect(readFileSync(state.ledger, "utf8")).toBe(`${text}${next.stdout}`);
  expect(status(state).status).toBe(0);
});

test("terminated malformed middle line remains a state mismatch", () => {
  const state = scene();
  const before = readFileSync(state.ledger, "utf8");
  const valid = append(state, collect);
  expect(valid.status).toBe(0);
  expect(status(state).status).toBe(0);
  writeFileSync(state.ledger, `${before}not json\n${valid.stdout}`);
  const report = status(state);
  expect(report.status).toBe(3);
  expect(report.stderr).toContain("not a JSON event");
  const next = append(state, define);
  expect(next.status).toBe(3);
  expect(next.stderr).toContain("not a JSON event");
});

test("short append returns state mismatch and rolls back its bytes", () => {
  const state = scene();
  const before = readFileSync(state.ledger, "utf8");
  const preload = join(state.dir, "short-write.cjs");
  const event = join(state.dir, "event.json");
  writeFileSync(event, JSON.stringify(collect));
  writeFileSync(preload, `
    const fs = require("node:fs");
    const original = fs.writeSync;
    fs.writeSync = function (fd, data, ...rest) {
      if (typeof data === "string" && data.includes('"event":"collect"')) {
        return original.call(fs, fd, data.slice(0, Math.floor(data.length / 2)), ...rest);
      }
      return original.call(fs, fd, data, ...rest);
    };
    require("node:module").syncBuiltinESMExports();
  `);
  const result = spawnSync("node", ["--require", preload, cliPath, "ledger", "append",
    "--event", "collect", "--json", event, "--root", state.root], {
    cwd: worktree, encoding: "utf8", timeout: 60_000, env: process.env,
  });
  expect(result.status).toBe(3);
  expect(readFileSync(state.ledger, "utf8")).toBe(before);
  expect(status(state).status).toBe(0);
});
