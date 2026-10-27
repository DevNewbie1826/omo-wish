#!/usr/bin/env node
// X1 pre-review defect-class sweep.
//
// Runs one short probe per measured defect class against the finished diff and
// writes a machine-readable receipt. It adds work before the final review; it
// never replaces a reviewer.
//
// Usage: bun skills/wish/scripts/sweep.mjs --config .wish-sweep.json [--root DIR] [--json FILE]
//
// Every command runs once. There is no retry loop and no polling: readiness and
// exits are event-driven, and parallelism is capped at 8.

import { spawn, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

export const CRASH_PATTERNS = [
  "panic:",
  "runtime error:",
  "Traceback (most recent call last)",
  "SIGSEGV",
  "slice bounds out of range",
  "RangeError",
  "TypeError",
];
const SKIP_DIRS = new Set([".git", "node_modules", ".omo", "dist", "build", ".next", "target"]);

function syncText(cmd, cwd) {
  const result = spawnSync("/bin/sh", ["-c", cmd], { cwd, encoding: "utf8", timeout: 60000 });
  return `${result.stdout ?? ""}${result.stderr ?? ""}`;
}

function globToRegExp(glob) {
  let out = "^";
  for (let i = 0; i < glob.length; i += 1) {
    const ch = glob[i];
    if (ch === "*") {
      if (glob[i + 1] === "*") {
        out += ".*";
        i += 1;
        if (glob[i + 1] === "/") i += 1;
      } else out += "[^/]*";
    } else if (ch === "?") out += "[^/]";
    else out += ch.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`${out}$`);
}

function walk(dir, acc = []) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return acc;
  }
  for (const entry of entries) {
    if (entry.name.startsWith(".") && entry.name !== ".github") continue;
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, acc);
    else if (entry.isFile()) acc.push(full);
  }
  return acc;
}

function matchFiles(root, globs) {
  const regexes = globs.map(globToRegExp);
  return walk(root).filter((file) => {
    const rel = file.slice(root.length + 1).split(sep).join("/");
    return regexes.some((regex) => regex.test(rel));
  });
}

// Runs one command to completion. Resolves; never throws for a non-zero exit.
export function runCommand({ cmd, cwd, stdin, timeoutMs = 300000, env = {}, detached = false }) {
  return new Promise((resolvePromise) => {
    const started = Date.now();
    const child = spawn("/bin/sh", ["-c", cmd], {
      cwd,
      detached,
      env: { ...process.env, ...env },
      stdio: ["pipe", "pipe", "pipe"],
    });
    const out = [];
    const err = [];
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      try {
        if (detached) process.kill(-child.pid, "SIGKILL");
        else child.kill("SIGKILL");
      } catch {
        /* already gone */
      }
    }, timeoutMs);
    child.stdout.on("data", (chunk) => out.push(chunk));
    child.stderr.on("data", (chunk) => err.push(chunk));
    child.on("error", (error) => {
      clearTimeout(timer);
      resolvePromise({ code: -1, signal: null, stdout: "", stderr: String(error), timedOut, ms: Date.now() - started });
    });
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      resolvePromise({
        code: code ?? -1,
        signal,
        stdout: Buffer.concat(out).toString("utf8"),
        stderr: Buffer.concat(err).toString("utf8"),
        timedOut,
        ms: Date.now() - started,
      });
    });
    child.stdin.on("error", () => {});
    if (stdin === undefined || stdin === null) child.stdin.end();
    else child.stdin.end(stdin);
  });
}

function crashIn(text) {
  const hits = CRASH_PATTERNS.filter((pattern) => text.includes(pattern));
  return hits.length > 0 ? hits : null;
}

async function mapPool(items, limit, worker) {
  const results = new Array(items.length);
  let next = 0;
  const runners = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    for (;;) {
      const index = next;
      next += 1;
      if (index >= items.length) return;
      results[index] = await worker(items[index], index);
    }
  });
  await Promise.all(runners);
  return results;
}

function check(id, status, detail) {
  return { id, status, detail };
}

function summariseChecks(checks) {
  if (checks.some((entry) => entry.status === "FAIL")) return "FAIL";
  if (checks.some((entry) => entry.status === "PASS")) return "PASS";
  if (checks.some((entry) => entry.status === "INVALID")) return "INVALID";
  return "SKIP";
}

// Added lines of the reviewed diff, per file, with their new-file line numbers.
function addedLines({ root, base, paths }) {
  const pathArgs = paths && paths.length > 0 ? ` -- ${paths.map((p) => JSON.stringify(p)).join(" ")}` : "";
  const diff = syncText(`git -C ${JSON.stringify(root)} diff -U0 --no-color ${JSON.stringify(base)}...HEAD${pathArgs}`);
  const candidates = [];
  let file = null;
  let newLine = 1;
  for (const line of diff.split("\n")) {
    const header = /^\+\+\+ b\/(.+)$/.exec(line);
    if (header) {
      file = header[1];
      continue;
    }
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
    if (hunk) {
      newLine = Number(hunk[1]);
      continue;
    }
    if (!file) continue;
    if (line.startsWith("+") && !line.startsWith("+++")) {
      candidates.push({ file, line: newLine, text: line.slice(1) });
      newLine += 1;
    } else if (!line.startsWith("-")) {
      newLine += 1;
    }
  }
  return candidates;
}

function isNoise(candidate, testGlobs) {
  if (testGlobs.some((glob) => glob.test(candidate.file))) return true;
  const text = candidate.text;
  if (text === undefined) return false;
  if (!text.trim()) return true;
  if (/^\s*(import|from|#include|package|using)\b/.test(text)) return true;
  if (/^\s*(\/\/|#|\*|\/\*)/.test(text)) return true;
  if (/^\s*[)}\]],?\s*$/.test(text)) return true;
  if (/[({[,]\s*$/.test(text)) return true;
  return false;
}

function selectCandidates(raw, { testGlobs, max }) {
  const globs = (testGlobs ?? ["**/*_test.go", "**/*.test.js", "**/*.test.ts", "**/test/**", "**/tests/**"]).map(globToRegExp);
  const kept = [];
  for (const candidate of raw) {
    if (isNoise(candidate, globs)) continue;
    kept.push(candidate);
    if (kept.length >= (max ?? 12)) break;
  }
  return kept;
}

// --- probes -----------------------------------------------------------------

async function probeSecrets(config, ctx) {
  const checks = [];
  if (!config.canary) return [check("secrets", "SKIP", "no canary configured")];
  const startedAt = Date.now();
  for (const command of config.commands ?? []) {
    const run = await runCommand({
      cmd: command.cmd,
      cwd: ctx.root,
      stdin: command.stdin,
      timeoutMs: command.timeoutMs ?? ctx.timeoutMs,
      env: { ...(config.env ?? {}), ...(command.env ?? {}) },
    });
    const leaked = `${run.stdout}\n${run.stderr}`.includes(config.canary);
    checks.push(
      check(
        `secrets/${command.name}`,
        leaked ? "FAIL" : "PASS",
        leaked ? `canary reached the command output (exit ${run.code})` : `no canary in output (exit ${run.code}, ${run.ms} ms)`,
      ),
    );
  }
  for (const file of matchFiles(ctx.root, config.logs ?? [])) {
    if (statSync(file).mtimeMs < startedAt - 1000) continue;
    const body = readFileSync(file, "utf8");
    const rel = file.slice(ctx.root.length + 1);
    checks.push(check(`secrets/log:${rel}`, body.includes(config.canary) ? "FAIL" : "PASS", body.includes(config.canary) ? "canary written to a log file" : "log is clean"));
  }
  if (checks.length === 0) checks.push(check("secrets", "SKIP", "no commands or logs declared"));
  for (const candidate of config.staticLines ?? []) {
    checks.push(check(`secrets/static:${candidate.file}:${candidate.line}`, "WARN", "a secret-named value reaches a log or error call on this added line; read it"));
  }
  return checks;
}

function boundaryVariants(baseStdin) {
  const prefix = Buffer.from(baseStdin ?? "");
  return [
    { id: "empty", stdin: "" },
    { id: "invalid-utf8", stdin: Buffer.concat([prefix, Buffer.from([0xff, 0x62])]) },
    { id: "boundary-4096", stdin: Buffer.concat([Buffer.alloc(4095, 0x61), Buffer.from([0xff, 0x62])]) },
  ];
}

async function probeBoundary(config, ctx) {
  const checks = [];
  for (const testCase of config.cases ?? []) {
    const variants = [{ id: "declared", stdin: testCase.stdin }];
    if (testCase.stdin !== undefined) variants.push(...boundaryVariants(testCase.stdin));
    for (const variant of variants) {
      const run = await runCommand({ cmd: testCase.cmd, cwd: ctx.root, stdin: variant.stdin, timeoutMs: testCase.timeoutMs ?? ctx.timeoutMs });
      const allowed = testCase.expectExit ?? [0];
      const crash = crashIn(`${run.stdout}\n${run.stderr}`);
      const ok = !run.timedOut && !crash && allowed.includes(run.code);
      const detail = run.timedOut
        ? `timed out after ${run.ms} ms`
        : crash
          ? `crash marker ${crash.join(", ")}`
          : `exit ${run.code}${allowed.includes(run.code) ? "" : ` not in [${allowed.join(",")}]`}`;
      checks.push(check(`boundary/${testCase.name}:${variant.id}`, ok ? "PASS" : "FAIL", detail));
    }
  }
  if (checks.length === 0) checks.push(check("boundary", "SKIP", "no cases declared"));
  return checks;
}

async function probeRace(config, ctx) {
  if (!config.cmd) return [check("race", "SKIP", "no race command declared")];
  const run = await runCommand({ cmd: config.cmd, cwd: ctx.root, timeoutMs: config.timeoutMs ?? ctx.timeoutMs });
  const marker = config.pattern ?? "DATA RACE";
  const output = `${run.stdout}\n${run.stderr}`;
  const found = output.includes(marker);
  const crash = crashIn(output);
  const ok = !run.timedOut && !found && !crash && run.code === 0;
  return [
    check(
      "race",
      ok ? "PASS" : "FAIL",
      run.timedOut
        ? `timed out after ${run.ms} ms`
        : found
          ? `race marker "${marker}" reported`
          : crash
            ? `crash marker ${crash.join(", ")}`
            : `exit ${run.code} in ${run.ms} ms with no race diagnostic`,
    ),
  ];
}

async function probeMutation(config, ctx) {
  const checks = [];
  if (!config.testCmd) return [check("mutation", "SKIP", "no test command declared")];
  const baseline = await runCommand({ cmd: config.testCmd, cwd: ctx.root, timeoutMs: config.timeoutMs ?? ctx.timeoutMs });
  checks.push(check("mutation/baseline", baseline.code === 0 ? "PASS" : "FAIL", baseline.code === 0 ? `suite green in ${baseline.ms} ms` : `suite is not green before mutating (exit ${baseline.code})`));
  if (baseline.code !== 0) return checks;

  const raw = config.candidates?.length
    ? config.candidates
    : addedLines({ root: ctx.root, base: config.base ?? "origin/main", paths: config.paths });
  const candidates = selectCandidates(raw, { testGlobs: config.testGlobs, max: config.max ?? 12 });
  if (candidates.length === 0) return [...checks, check("mutation", "SKIP", "no candidate production lines in the diff")];

  const failMarker = new RegExp(config.failMarker ?? "--- FAIL:|^FAIL\\b|✗|\\(fail\\)|AssertionError|not ok \\d+", "m");
  const compileError = new RegExp(config.compileErrorPattern ?? "build failed|setup failed|syntax error|Cannot find module|error TS\\d+|undefined reference", "m");
  const scratchRoots = [];

  const results = await mapPool(candidates, Math.min(8, ctx.parallel), async (candidate) => {
    const scratch = mkdtempSync(join(tmpdir(), "x1-sweep-mutant-"));
    scratchRoots.push(scratch);
    const tree = join(scratch, "tree");
    cpSync(ctx.root, tree, {
      recursive: true,
      filter: (src) => {
        if (src === ctx.root) return true;
        const first = src.slice(ctx.root.length + 1).split(sep)[0];
        return !SKIP_DIRS.has(first);
      },
    });
    const target = join(tree, candidate.file);
    if (!existsSync(target)) return check(`mutation/${candidate.file}:${candidate.line}`, "INVALID", "file not found in the copy");
    const lines = readFileSync(target, "utf8").split("\n");
    const index = candidate.line - 1;
    if (lines[index] === undefined) return check(`mutation/${candidate.file}:${candidate.line}`, "INVALID", "line no longer exists");
    lines[index] = "";
    writeFileSync(target, lines.join("\n"));
    const run = await runCommand({ cmd: config.testCmd, cwd: tree, timeoutMs: config.timeoutMs ?? ctx.timeoutMs });
    const output = `${run.stdout}\n${run.stderr}`;
    if (compileError.test(output)) return check(`mutation/${candidate.file}:${candidate.line}`, "INVALID", "mutation did not compile; not counted as killed");
    if (run.code === 0) return check(`mutation/${candidate.file}:${candidate.line}`, "FAIL", "SURVIVED: the suite stayed green with this line removed");
    if (failMarker.test(output)) return check(`mutation/${candidate.file}:${candidate.line}`, "PASS", `killed (exit ${run.code})`);
    return check(`mutation/${candidate.file}:${candidate.line}`, "INVALID", `failed without a test-failure marker (exit ${run.code})`);
  });
  for (const scratch of scratchRoots) rmSync(scratch, { recursive: true, force: true });
  return [...checks, ...results];
}

function probeDocs(config, ctx) {
  const checks = [];
  const docs = matchFiles(ctx.root, config.docs ?? []);
  if (docs.length === 0) return [check("docs", "SKIP", "no changed docs declared")];
  const help = config.helpCmd ? syncText(config.helpCmd, ctx.root) : "";
  const known = new Set(config.known ?? []);
  const pattern = new RegExp(config.flagPattern ?? "--[a-z][a-z0-9-]{2,}", "g");
  const documented = new Set();
  for (const file of docs) {
    for (const match of readFileSync(file, "utf8").matchAll(pattern)) documented.add(match[0]);
  }
  for (const token of documented) {
    if (known.has(token)) {
      checks.push(check(`docs/${token}`, "PASS", "declared known in the sweep config"));
      continue;
    }
    const present = help.includes(token);
    checks.push(check(`docs/${token}`, present ? "PASS" : "FAIL", present ? "documented flag exists in help output" : "documented flag does not exist in help output or the known list"));
  }
  if (documented.size === 0) checks.push(check("docs", "SKIP", "no flags documented in the changed docs"));
  return checks;
}

async function probeConfig(config, ctx) {
  const cases = config.cases ?? [];
  if (cases.length === 0) return [check("config", "SKIP", "no config cases declared")];
  const checks = [];
  const scratch = mkdtempSync(join(tmpdir(), "x1-sweep-config-"));
  for (const testCase of cases) {
    let cmd = testCase.cmd;
    if (testCase.file !== undefined) {
      const file = join(scratch, `${testCase.name}.json`);
      writeFileSync(file, typeof testCase.file === "string" ? testCase.file : JSON.stringify(testCase.file, null, 2));
      cmd = cmd.replaceAll("{tmp}", file);
    }
    const run = await runCommand({ cmd, cwd: ctx.root, timeoutMs: ctx.timeoutMs });
    const accepted = run.code === 0;
    const ok = testCase.expect === "accept" ? accepted : !accepted;
    checks.push(check(`config/${testCase.name}`, ok ? "PASS" : "FAIL", `expected ${testCase.expect ?? "accept"}, got ${accepted ? "accept" : `reject (exit ${run.code})`}`));
  }
  rmSync(scratch, { recursive: true, force: true });
  return checks;
}

function groupAlive(pid) {
  try {
    process.kill(-pid, 0);
    return true;
  } catch {
    return false;
  }
}

function runLifecycleCase(testCase, ctx) {
  return new Promise((resolvePromise) => {
    if (!Array.isArray(testCase.argv) || testCase.argv.length === 0) {
      resolvePromise([check(`lifecycle/${testCase.name}`, "FAIL", "a lifecycle case needs an argv array, so the probe signals the program itself and not a shell")]);
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
    const finish = (status, detail) => {
      if (settled) return;
      settled = true;
      clearTimeout(readyTimer);
      clearTimeout(budgetTimer);
      if (status === "FAIL") {
        try {
          process.kill(-child.pid, "SIGKILL");
        } catch {
          /* already gone */
        }
      }
      resolvePromise([check(`lifecycle/${testCase.name}`, status, detail)]);
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
    const readyTimer = setTimeout(() => finish("FAIL", `no readiness signal within ${testCase.readyTimeoutMs ?? 10000} ms`), testCase.readyTimeoutMs ?? 10000);
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    child.on("error", (error) => finish("FAIL", `spawn error: ${error}`));
    child.on("close", (code, exitSignal) => {
      if (!seenReady) return finish("FAIL", "exited before the readiness signal");
      const latency = Date.now() - signalStart;
      if (groupAlive(child.pid)) return finish("FAIL", `the direct child exited in ${latency} ms but the process group is still alive`);
      finish(latency <= budgetMs ? "PASS" : "FAIL", `exited in ${latency} ms (${exitSignal ?? `code ${code}`}), budget ${budgetMs} ms`);
    });
  });
}

async function probeLifecycle(config, ctx) {
  const cases = config.cases ?? [];
  if (cases.length === 0) return [check("lifecycle", "SKIP", "no lifecycle cases declared")];
  const results = await mapPool(cases, Math.min(8, ctx.parallel), (testCase) => runLifecycleCase(testCase, ctx));
  return results.flat();
}

const PROBES = {
  secrets: probeSecrets,
  boundary: probeBoundary,
  race: probeRace,
  mutation: probeMutation,
  docs: probeDocs,
  config: probeConfig,
  lifecycle: probeLifecycle,
};

export async function runSweep({ root, config }) {
  const startedAt = new Date().toISOString();
  const ctx = {
    root,
    timeoutMs: Math.max(1, Math.min(config.timeoutMs ?? 300000, 300000)),
    parallel: Math.max(1, Math.min(config.parallel ?? 4, 8)),
  };
  const probes = [];
  for (const [name, probe] of Object.entries(PROBES)) {
    const probeConfig = config.probes?.[name];
    if (!probeConfig) {
      probes.push({ name, status: "SKIP", checks: [check(name, "SKIP", "probe not configured")] });
      continue;
    }
    let checks;
    try {
      checks = await probe(probeConfig, ctx);
    } catch (error) {
      checks = [check(name, "FAIL", `probe crashed: ${error?.message ?? error}`)];
    }
    probes.push({ name, status: summariseChecks(checks), checks });
  }
  const summary = { PASS: 0, FAIL: 0, SKIP: 0, INVALID: 0 };
  for (const probe of probes) summary[probe.status] = (summary[probe.status] ?? 0) + 1;
  return {
    version: "x1-sweep/1",
    root,
    head: config.head ?? null,
    startedAt,
    finishedAt: new Date().toISOString(),
    parallel: ctx.parallel,
    timeoutMs: ctx.timeoutMs,
    probes,
    summary,
    exit: summary.FAIL > 0 ? 1 : 0,
  };
}

export function renderReceipt(receipt) {
  const lines = [`X1 sweep — ${receipt.root}${receipt.head ? ` @ ${receipt.head}` : ""}`, ""];
  for (const probe of receipt.probes) {
    lines.push(`${probe.status.padEnd(4)} ${probe.name}`);
    for (const entry of probe.checks) {
      if (entry.status === "PASS" && !process.env.X1_SWEEP_VERBOSE) continue;
      lines.push(`  ${entry.status.padEnd(7)} ${entry.id}: ${entry.detail}`);
    }
  }
  const { PASS, FAIL, SKIP, INVALID } = receipt.summary;
  lines.push("", `summary PASS ${PASS} FAIL ${FAIL} SKIP ${SKIP} INVALID ${INVALID} — exit ${receipt.exit}`);
  return lines.join("\n");
}

function parseArgs(argv) {
  const options = { config: ".wish-sweep.json", root: ".", json: null };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--config") options.config = argv[++i];
    else if (arg === "--root") options.root = argv[++i];
    else if (arg === "--json") options.json = argv[++i];
    else if (arg === "--help" || arg === "-h") options.help = true;
    else throw new Error(`unknown argument: ${arg}`);
  }
  return options;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log("usage: sweep.mjs --config .wish-sweep.json [--root DIR] [--json FILE]");
    process.exit(0);
  }
  const root = resolve(options.root);
  const configPath = resolve(root, options.config);
  if (!existsSync(configPath)) {
    console.error(`sweep: config not found: ${configPath}`);
    process.exit(2);
  }
  const config = JSON.parse(readFileSync(configPath, "utf8"));
  const receipt = await runSweep({ root, config });
  console.log(renderReceipt(receipt));
  if (options.json) {
    mkdirSync(resolve(options.json, ".."), { recursive: true });
    writeFileSync(options.json, `${JSON.stringify(receipt, null, 2)}\n`);
  }
  process.exit(receipt.exit);
}