import { afterAll, expect, test } from "bun:test";
import { runCommand, sessionMembers } from "../skills/wish/scripts/sweep.mjs";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "..");
const sweepPath = join(repo, "skills/wish/scripts/sweep.mjs");
const fixtureRoot = join(here, "fixtures/sweep");
const staged = [];

afterAll(() => {
  for (const dir of staged) rmSync(dir, { recursive: true, force: true });
});

function stage(name) {
  mkdirSync(tmpdir(), { recursive: true });
  const dir = mkdtempSync(join(tmpdir(), `sweep-fixture-${name}-`));
  staged.push(dir);
  cpSync(join(fixtureRoot, name), dir, { recursive: true });
  return dir;
}

function seededRewrapLine(dir) {
  return readFileSync(join(dir, "cli.js"), "utf8").split("\n").findIndex((line) => line.includes("new Error(error.message)")) + 1;
}

function guardLine(dir) {
  return readFileSync(join(dir, "cli.js"), "utf8").split("\n").findIndex((line) => line.includes("upstream rejected")) + 1;
}

function configFor(dir, overrides = {}) {
  const canary = "X1CANARY-8f2c1d";
  return {
    timeoutMs: 60000,
    parallel: 4,
    probes: {
      secrets: {
        canary,
        env: { TEST_API_TOKEN: canary },
        commands: [{ name: "send-fail", cmd: "bun cli.js send --fail" }],
      },
      boundary: {
        cases: [
          { name: "stdin", cmd: "bun cli.js stdin", stdin: "hello world", expectExit: [0, 1] },
          { name: "echo-markup", cmd: "bun cli.js echo", stdin: "<a href=\"x\">hello</a>", expectExit: [0], expectStdout: "<a href=\"x\">hello</a>" },
        ],
      },
      race: { cmd: "bun check.js" },
      mutation: {
        testCmd: "bun check.js",
        candidates: [{ file: "cli.js", line: guardLine(dir) }],
        failMarker: "CHECK FAILED",
      },
      docs: { helpCmd: "bun cli.js --help", docs: ["usage.md"] },
      errors: { strict: true, lines: [{ file: "cli.js", line: guardLine(dir) }] },
      config: {
        cases: [
          { name: "known-key", cmd: "bun cli.js config --file {tmp}", file: { text: "hello" }, expect: "accept" },
          { name: "unknown-key", cmd: "bun cli.js config --file {tmp}", file: { text: "hello", extra: { nested: true } }, expect: "reject" },
        ],
      },
      lifecycle: { cases: [{ name: "serve", argv: ["bun", "cli.js", "serve"], ready: "listening", budgetMs: 1500, readyTimeoutMs: 8000 }] },
    },
    ...overrides,
  };
}

function sweep(dir, overrides = {}) {
  writeFileSync(join(dir, ".wish-sweep.json"), JSON.stringify(configFor(dir, overrides), null, 2));
  const receiptPath = join(dir, "receipt.json");
  const proc = Bun.spawnSync(["bun", sweepPath, "--root", dir, "--config", ".wish-sweep.json", "--json", receiptPath], { cwd: repo });
  return {
    exit: proc.exitCode,
    stdout: proc.stdout.toString(),
    stderr: proc.stderr.toString(),
    receipt: JSON.parse(readFileSync(receiptPath, "utf8")),
  };
}

function checks(receipt, probeName) {
  return receipt.probes.find((probe) => probe.name === probeName).checks;
}

function statusOf(receipt, probeName, checkId) {
  return checks(receipt, probeName).find((entry) => entry.id === checkId)?.status;
}

test("clean fixture: every probe passes and the receipt exits 0", async () => {
  const dir = stage("clean");
  const run = sweep(dir);
  expect(run.stderr).toBe("");
  expect(run.exit).toBe(0);
  expect(run.receipt.version).toBe("x1-sweep/1");
  expect(run.receipt.summary).toEqual({ PASS: 8, FAIL: 0, SKIP: 0, INVALID: 0, WARN: 0 });
  expect(statusOf(run.receipt, "boundary", "boundary/echo-markup:declared")).toBe("PASS");
  for (const probe of run.receipt.probes) expect(probe.status).toBe("PASS");
  expect(statusOf(run.receipt, "boundary", "boundary/stdin:invalid-utf8")).toBe("PASS");
  expect(statusOf(run.receipt, "boundary", "boundary/stdin:boundary-4096")).toBe("PASS");
  expect(statusOf(run.receipt, "mutation", `mutation/cli.js:${guardLine(dir)}`)).toBe("PASS");
  expect(statusOf(run.receipt, "lifecycle", "lifecycle/serve")).toBe("PASS");
}, 120000);

test("seeded fixture: each seeded defect class fails its own probe", async () => {
  const dir = stage("seeded");
  const run = sweep(dir, {
    probes: { ...configFor(dir).probes, errors: { strict: true, lines: [{ file: "cli.js", line: seededRewrapLine(dir) }] } },
  });
  expect(run.exit).toBe(1);
  const expected = {
    secrets: ["secrets/send-fail"],
    boundary: ["boundary/stdin:boundary-4096", "boundary/echo-markup:declared"],
    race: ["race"],
    mutation: [`mutation/cli.js:${guardLine(dir)}`],
    docs: ["docs/--dry-run"],
    config: ["config/unknown-key"],
    lifecycle: ["lifecycle/serve"],
    errors: [`errors/rewrapped-message:cli.js:${seededRewrapLine(dir)}`],
  };
  for (const [probe, ids] of Object.entries(expected)) {
    expect(run.receipt.probes.find((entry) => entry.name === probe).status).toBe("FAIL");
    for (const id of ids) expect(statusOf(run.receipt, probe, id)).toBe("FAIL");
  }
  expect(checks(run.receipt, "secrets").find((entry) => entry.id === "secrets/send-fail").detail).toContain("canary reached");
  expect(checks(run.receipt, "boundary").find((entry) => entry.id === "boundary/stdin:boundary-4096").detail).toContain("slice bounds out of range");
  expect(checks(run.receipt, "mutation")[1].detail).toContain("SURVIVED");
  expect(checks(run.receipt, "lifecycle")[0].detail).toContain("still alive");
  expect(statusOf(run.receipt, "boundary", "boundary/stdin:declared")).toBe("PASS");
  expect(statusOf(run.receipt, "config", "config/known-key")).toBe("PASS");
}, 120000);

test("limits are clamped and an unusable mutation is invalid, not killed", async () => {
  const dir = stage("clean");
  const run = sweep(dir, {
    parallel: 99,
    timeoutMs: 999999,
    probes: {
      ...configFor(dir).probes,
      mutation: {
        testCmd: "bun check.js",
        candidates: [{ file: "cli.js", line: guardLine(dir) }, { file: "cli.js", line: 9999 }],
        failMarker: "CHECK FAILED",
      },
    },
  });
  expect(run.receipt.parallel).toBe(8);
  expect(run.receipt.timeoutMs).toBe(300000);
  expect(statusOf(run.receipt, "mutation", "mutation/cli.js:9999")).toBe("INVALID");
  expect(run.exit).toBe(0);
}, 120000);

test("bare receipt names the unconfigured probes and a missing config exits 2", () => {
  const dir = stage("clean");
  const receiptPath = join(dir, "bare.json");
  writeFileSync(join(dir, ".wish-sweep.json"), JSON.stringify({ timeoutMs: 1000 }));
  const proc = Bun.spawnSync(["bun", sweepPath, "--root", dir, "--config", ".wish-sweep.json", "--json", receiptPath], { cwd: repo });
  const receipt = JSON.parse(readFileSync(receiptPath, "utf8"));
  expect(proc.exitCode).toBe(0);
  expect(receipt.summary.SKIP).toBe(8);
  expect(receipt.probes.every((probe) => probe.checks[0].detail.includes("not configured"))).toBe(true);

  const missing = Bun.spawnSync(["bun", sweepPath, "--root", dir, "--config", ".absent.json"], { cwd: repo });
  expect(missing.exitCode).toBe(2);
  expect(missing.stderr.toString()).toContain("config not found");
});

test("a mutation cap reports the lines it did not probe and docs without a help command skip", async () => {
  const dir = stage("clean");
  const base = configFor(dir).probes;
  const run = sweep(dir, {
    probes: {
      mutation: {
        testCmd: "bun check.js",
        candidates: [
          { file: "cli.js", line: guardLine(dir) },
          { file: "cli.js", line: guardLine(dir) + 1 },
          { file: "cli.js", line: guardLine(dir) + 2 },
        ],
        failMarker: "CHECK FAILED",
        max: 1,
      },
      docs: { docs: ["usage.md"] },
    },
  });
  expect(run.receipt.probes.find((probe) => probe.name === "docs").status).toBe("SKIP");
  expect(statusOf(run.receipt, "docs", "docs")).toBe("SKIP");
  const limit = checks(run.receipt, "mutation").find((entry) => entry.id === "mutation/limit");
  expect(limit.detail).toContain("1 of 3 added production lines probed");
  expect(base).toBeDefined();
}, 120000);

test("runCommand clamps every declared timeout to the 300 s cap", async () => {
  const big = await runCommand({ cmd: "true", cwd: repo, timeoutMs: 999999 });
  const small = await runCommand({ cmd: "true", cwd: repo, timeoutMs: 400 });
  expect(big.budget).toBe(300000);
  expect(small.budget).toBe(400);
  expect(big.code).toBe(0);
}, 60000);

test("a timeout and an exit both take the process group, so a held pipe cannot outlive the cap", async () => {
  const hanging = await runCommand({ cmd: "sleep 20", cwd: repo, timeoutMs: 300 });
  expect(hanging.timedOut).toBe(true);
  expect(hanging.ms).toBeLessThan(5000);

  const orphan = await runCommand({ cmd: "sleep 20 & sleep 0.1", cwd: repo, timeoutMs: 5000 });
  expect(orphan.timedOut).toBe(false);
  expect(orphan.ms).toBeLessThan(5000);
  expect(sessionMembers(orphan.session)).toEqual([]);
}, 60000);

test("a WARN-only probe reports WARN and does not fail the run", async () => {
  const dir = stage("seeded");
  const run = sweep(dir, { probes: { errors: { strict: false, lines: [{ file: "cli.js", line: seededRewrapLine(dir) }] } } });
  const probe = run.receipt.probes.find((entry) => entry.name === "errors");
  expect(probe.status).toBe("WARN");
  expect(run.receipt.summary.WARN).toBe(1);
  expect(run.exit).toBe(0);
}, 120000);

test("the default mutation path reads the added lines out of the git diff", () => {
  const dir = mkdtempSync(join(tmpdir(), "sweep-git-"));
  staged.push(dir);
  cpSync(join(fixtureRoot, "clean"), dir, { recursive: true });
  const cliPath = join(dir, "cli.js");
  const withGuard = readFileSync(cliPath, "utf8");
  const guardBlock = '  if (rest.includes("--fail")) {\n    die("send failed: upstream rejected the request");\n  }\n';
  writeFileSync(cliPath, withGuard.replace(guardBlock, ""));
  const git = (...args) => Bun.spawnSync(["git", "-c", "user.name=sweep", "-c", "user.email=sweep@test", ...args], { cwd: dir });
  expect(git("init", "-q").exitCode).toBe(0);
  expect(git("add", "-A").exitCode).toBe(0);
  expect(git("commit", "-q", "-m", "base").exitCode).toBe(0);
  writeFileSync(cliPath, withGuard);
  expect(git("add", "-A").exitCode).toBe(0);
  expect(git("commit", "-q", "-m", "guard").exitCode).toBe(0);

  const run = sweep(dir, {
    probes: {
      mutation: { testCmd: "bun check.js", base: "HEAD~1", failMarker: "CHECK FAILED" },
    },
  });
  const mutation = run.receipt.probes.find((entry) => entry.name === "mutation");
  expect(mutation.status).toBe("PASS");
  expect(mutation.checks.some((entry) => /^mutation\/cli\.js:\d+$/.test(entry.id))).toBe(true);
  expect(mutation.checks.some((entry) => entry.id === "mutation")).toBe(false);
}, 120000);
