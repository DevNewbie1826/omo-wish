import { afterAll, expect, test } from "bun:test";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PROBES } from "../skills/wish/scripts/probes/index.mjs";
import { clampMs, ctxFor, killSession, q, runCommand, sessionMembers, sweepBudget } from "../skills/wish/scripts/probes/lib.mjs";
import {
  classValid, findingsClassesFor, receiptFilename, validateReceipt, validateReceiptAgainstFilename,
} from "../skills/wish/scripts/lib/schema.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "..");
const sweepPath = join(repo, "skills/wish/scripts/sweep.mjs");
const probeDir = join(repo, "skills/wish/scripts/probes");
const fixtureRoot = join(here, "fixtures/sweep");
const HEAD = "0123456789abcdef0123456789abcdef01234567";
const TREE = "89abcdef0123456789abcdef0123456789abcdef";
const CANARY = "SWEEPCANARY-8f2c1d";
const staged = [];

afterAll(() => {
  for (const dir of staged) rmSync(dir, { recursive: true, force: true });
});

function stage(name) {
  const dir = mkdtempSync(join(tmpdir(), `sweep-fixture-${name}-`));
  staged.push(dir);
  cpSync(join(fixtureRoot, name), dir, { recursive: true });
  return dir;
}

function lines(dir, file) {
  return readFileSync(join(dir, file), "utf8").split("\n");
}

function lineOf(dir, file, needle) {
  return lines(dir, file).findIndex((line) => line.includes(needle)) + 1;
}

function receiptFile(dir) {
  return join(dir, `verify_lane-sweep-${HEAD.slice(0, 7)}.json`);
}

function configFor(dir, overrides = {}) {
  return {
    timeoutMs: 60000,
    parallel: 4,
    probes: {
      secrets: {
        canary: CANARY,
        env: { TEST_API_TOKEN: CANARY },
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
        candidates: [{ file: "cli.js", line: lineOf(dir, "cli.js", "upstream rejected") }],
        failMarker: "CHECK FAILED",
      },
      docs: { helpCmd: "bun cli.js --help", docs: ["usage.md"] },
      errors: { strict: true, lines: [{ file: "cli.js", line: lineOf(dir, "cli.js", "upstream rejected") }] },
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

function writeConfig(dir, config = configFor(dir)) {
  writeFileSync(join(dir, ".wish-sweep.json"), JSON.stringify(config, null, 2));
}

function invoke(dir, args) {
  const proc = Bun.spawnSync(["bun", sweepPath, ...args], { cwd: repo });
  return { exit: proc.exitCode, stdout: proc.stdout.toString(), stderr: proc.stderr.toString() };
}

function probeOf(receipt, name) {
  return receipt.rows.filter((entry) => entry.id === name || entry.id.startsWith(`${name}/`));
}

function verdictOf(receipt, id) {
  return receipt.rows.find((entry) => entry.id === id)?.verdict;
}

function sweepTo(dir, extra = [], outFile = receiptFile(dir)) {
  writeConfig(dir);
  const run = invoke(dir, ["--root", dir, "--config", ".wish-sweep.json", "--receipt", outFile, "--unit", "u-m3", "--head", HEAD, "--tree", TREE, ...extra]);
  const receipt = existsSync(outFile) ? JSON.parse(readFileSync(outFile, "utf8")) : null;
  return { ...run, receipt };
}

function probeStatuses(receipt) {  const status = {};
  for (const probe of PROBES) {
    const rows = probeOf(receipt, probe.name);
    if (rows.length === 0) status[probe.name] = "MISSING";
    else if (rows.some((entry) => entry.verdict === "FAIL")) status[probe.name] = "FAIL";
    else if (rows.some((entry) => entry.verdict === "WARN")) status[probe.name] = "WARN";
    else if (rows.some((entry) => entry.verdict === "INVALID")) status[probe.name] = "INVALID";
    else if (rows.some((entry) => entry.verdict === "PASS")) status[probe.name] = "PASS";
    else status[probe.name] = "SKIP";
  }
  return status;
}

test("a clean tree passes every probe, writes an M0 receipt and exits 0", () => {
  const dir = stage("clean");
  const run = sweepTo(dir);
  expect(run.stderr).toBe("");
  expect(run.exit).toBe(0);
  expect(probeStatuses(run.receipt)).toEqual(Object.fromEntries(PROBES.map((probe) => [probe.name, probe.types.includes("code") ? "PASS" : "SKIP"])));
  expect(run.receipt.kind).toBe("lane");
  expect(run.receipt.stage).toBe("verify_lane");
  expect(run.receipt.lane).toBe("sweep");
  expect(run.receipt.status).toBe("PASS");
  expect(validateReceipt(run.receipt)).toEqual({ ok: true, errors: [] });
  const name = basename(receiptFile(dir));
  expect(validateReceiptAgainstFilename(run.receipt, name)).toEqual({ ok: true, errors: [] });
  expect(run.receipt.artifacts).toEqual([receiptFile(dir)]);
  expect(run.receipt.cleanup.length).toBeGreaterThan(0);
  expect(verdictOf(run.receipt, "boundary/stdin:declared")).toBe("PASS");
  expect(verdictOf(run.receipt, "boundary/stdin:invalid-utf8")).toBe("PASS");
  expect(verdictOf(run.receipt, "boundary/stdin:boundary-4096")).toBe("PASS");
  expect(verdictOf(run.receipt, `mutation/cli.js:${lineOf(dir, "cli.js", "upstream rejected")}`)).toBe("PASS");
  expect(verdictOf(run.receipt, "lifecycle/serve")).toBe("PASS");
}, 120000);

test("a seeded tree fails each seeded defect on its own probe and exits 1", () => {
  const dir = stage("seeded");
  writeConfig(dir, { ...configFor(dir), probes: { ...configFor(dir).probes, errors: { strict: true, lines: [{ file: "cli.js", line: lineOf(dir, "cli.js", "new Error(error.message)") }] } } });
  const run = invoke(dir, ["--root", dir, "--config", ".wish-sweep.json", "--receipt", receiptFile(dir), "--unit", "u-m3", "--head", HEAD, "--tree", TREE]);
  const receipt = JSON.parse(readFileSync(receiptFile(dir), "utf8"));
  expect(run.exit).toBe(1);
  expect(probeStatuses(receipt)).toEqual(Object.fromEntries(PROBES.map((probe) => [probe.name, probe.types.includes("code") ? "FAIL" : "SKIP"])));
  const expected = [
    "secrets/send-fail",
    "boundary/stdin:boundary-4096",
    "boundary/echo-markup:declared",
    "race",
    `mutation/cli.js:${lineOf(dir, "cli.js", "upstream rejected")}`,
    "docs/--dry-run",
    "config/unknown-key",
    "lifecycle/serve",
    `errors/rewrapped-message:cli.js:${lineOf(dir, "cli.js", "new Error(error.message)")}`,
  ];
  for (const id of expected) expect(verdictOf(receipt, id)).toBe("FAIL");
  expect(receipt.rows.find((entry) => entry.id === "secrets/send-fail").note).toContain("canary reached");
  expect(receipt.rows.find((entry) => entry.id === "boundary/stdin:boundary-4096").note).toContain("slice bounds out of range");
  expect(receipt.rows.find((entry) => entry.id === "boundary/echo-markup:declared").note).toContain("the round trip changed the input");
  expect(receipt.rows.find((entry) => entry.id === "boundary/echo-markup:declared").note).not.toContain("<a href");
  expect(receipt.rows.find((entry) => entry.id.startsWith("mutation/cli.js")).note).toContain("SURVIVED");
  expect(receipt.rows.find((entry) => entry.id === "lifecycle/serve").note).toContain("still alive");
  expect(verdictOf(receipt, "boundary/stdin:declared")).toBe("PASS");
  expect(verdictOf(receipt, "config/known-key")).toBe("PASS");
  expect(receipt.status).toBe("FAIL");
}, 120000);

test("the caps clamp and an unusable mutation is INVALID, never a kill", () => {
  const clamped = ctxFor({ root: repo, parallel: 99, timeoutMs: 999999 });
  expect(clamped.parallel).toBe(8);
  expect(clamped.timeoutMs).toBe(300000);
  expect(ctxFor({ root: repo }).parallel).toBe(4);
  expect(ctxFor({ root: repo, timeoutMs: 0 }).timeoutMs).toBe(300000);

  const dir = stage("clean");
  writeConfig(dir, {
    ...configFor(dir),
    probes: {
      ...configFor(dir).probes,
      mutation: { testCmd: "bun check.js", candidates: [{ file: "cli.js", line: lineOf(dir, "cli.js", "upstream rejected") }, { file: "cli.js", line: 9999 }], failMarker: "CHECK FAILED" },
    },
  });
  const run = invoke(dir, ["--root", dir, "--config", ".wish-sweep.json", "--receipt", receiptFile(dir), "--unit", "u-m3", "--head", HEAD, "--tree", TREE]);
  const receipt = JSON.parse(readFileSync(receiptFile(dir), "utf8"));
  expect(verdictOf(receipt, "mutation/cli.js:9999")).toBe("INVALID");
  expect(run.exit).toBe(0);
}, 120000);

test("an unconfigured probe skips, and every usage mistake exits 2 without writing a receipt", () => {
  const dir = stage("clean");
  writeFileSync(join(dir, ".wish-sweep.json"), JSON.stringify({ timeoutMs: 1000 }, null, 2));
  const unwritten = join(dir, "unwritten", `verify_lane-sweep-${HEAD.slice(0, 7)}.json`);
  const bare = invoke(dir, ["--root", dir, "--config", ".wish-sweep.json", "--receipt", receiptFile(dir), "--unit", "u-m3", "--head", HEAD]);
  expect(bare.exit).toBe(0);
  const receipt = JSON.parse(readFileSync(receiptFile(dir), "utf8"));
  expect(receipt.status).toBe("SKIP");
  expect(receipt.rows).toHaveLength(PROBES.length);
  expect(receipt.rows.every((entry) => entry.verdict === "SKIP")).toBe(true);
  expect(receipt.rows.filter((entry) => entry.note.includes("absent"))).toHaveLength(PROBES.length - 1);
  expect(receipt.rows.find((entry) => entry.id === "draft-guard").note).toContain("probe types: design");

  const missing = invoke(dir, ["--root", dir, "--config", ".absent.json"]);
  expect(missing.exit).toBe(2);
  expect(missing.stderr).toContain("config not readable");

  for (const args of [
    ["--root", dir, "--receipt", unwritten, "--head", HEAD],
    ["--root", dir, "--nonsense"],
    ["--root", dir, "--config"],
    ["--root", dir, "--type", "nonsense"],
    ["--root", dir, "--type", "mixed", "--primary", "code"],
    ["--root", dir, "--probe", "nope"],
    ["--root", dir, "--lane", "Not Kebab"],
  ]) {
    const bad = invoke(dir, args);
    expect(bad.exit).toBe(2);
    expect(bad.exit).not.toBe(1);
  }
  expect(existsSync(unwritten)).toBe(false);
});

test("a mutation cap reports what it did not probe, and docs without a help command skips", () => {
  const dir = stage("clean");
  const guard = lineOf(dir, "cli.js", "upstream rejected");
  writeConfig(dir, {
    probes: {
      mutation: { testCmd: "bun check.js", candidates: [{ file: "cli.js", line: guard }, { file: "cli.js", line: guard + 1 }, { file: "cli.js", line: guard + 2 }], failMarker: "CHECK FAILED", max: 1 },
      docs: { docs: ["usage.md"] },
    },
  });
  const run = invoke(dir, ["--root", dir, "--config", ".wish-sweep.json", "--receipt", receiptFile(dir), "--unit", "u-m3", "--head", HEAD, "--tree", TREE]);
  const receipt = JSON.parse(readFileSync(receiptFile(dir), "utf8"));
  expect(probeStatuses(receipt).docs).toBe("SKIP");
  expect(probeStatuses(receipt).mutation).toBe("WARN");
  const limit = receipt.rows.find((entry) => entry.id === "mutation/limit");
  expect(limit.note).toContain("1 of 3 added production lines probed");
  expect(run.exit).toBe(0);
});

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

test("a WARN-only probe reports WARN and does not fail the run", () => {
  const dir = stage("seeded");
  writeConfig(dir, { probes: { errors: { strict: false, lines: [{ file: "cli.js", line: lineOf(dir, "cli.js", "new Error(error.message)") }] } } });
  const run = invoke(dir, ["--root", dir, "--config", ".wish-sweep.json", "--receipt", receiptFile(dir), "--unit", "u-m3", "--head", HEAD, "--tree", TREE]);
  const receipt = JSON.parse(readFileSync(receiptFile(dir), "utf8"));
  expect(probeStatuses(receipt).errors).toBe("WARN");
  expect(verdictOf(receipt, `errors/rewrapped-message:cli.js:${lineOf(dir, "cli.js", "new Error(error.message)")}`)).toBe("WARN");
  expect(receipt.status).toBe("WARN");
  expect(run.exit).toBe(0);
}, 120000);

test("the default mutation path reads the added lines out of the git diff", () => {
  const dir = stage("clean");
  const cliPath = join(dir, "cli.js");
  const withGuard = readFileSync(cliPath, "utf8");
  const guardBlock = "  if (rest.includes(\"--fail\")) {\n    die(\"send failed: upstream rejected the request\");\n  }\n";
  writeFileSync(cliPath, withGuard.replace(guardBlock, ""));
  const git = (...args) => Bun.spawnSync(["git", "-c", "user.name=sweep", "-c", "user.email=sweep@test", ...args], { cwd: dir });
  expect(git("init", "-q").exitCode).toBe(0);
  expect(git("add", "-A").exitCode).toBe(0);
  expect(git("commit", "-q", "-m", "base").exitCode).toBe(0);
  writeFileSync(cliPath, withGuard);
  expect(git("add", "-A").exitCode).toBe(0);
  expect(git("commit", "-q", "-m", "guard").exitCode).toBe(0);

  writeConfig(dir, { probes: { mutation: { testCmd: "bun check.js", base: "HEAD~1", failMarker: "CHECK FAILED" } } });
  const out = join(dir, "out");
  const run = invoke(dir, ["--root", dir, "--config", ".wish-sweep.json", "--receipt", out, "--unit", "u-m3"]);
  const written = join(out, `verify_lane-sweep-${Bun.spawnSync(["git", "-C", dir, "rev-parse", "HEAD"]).stdout.toString().trim().slice(0, 7)}.json`);
  const receipt = JSON.parse(readFileSync(written, "utf8"));
  expect(probeStatuses(receipt).mutation).toBe("PASS");
  expect(receipt.rows.some((entry) => /^mutation\/cli\.js:\d+$/.test(entry.id))).toBe(true);
  expect(receipt.rows.some((entry) => entry.id === "mutation")).toBe(false);
  expect(receipt.head).toBe(Bun.spawnSync(["git", "-C", dir, "rev-parse", "HEAD"]).stdout.toString().trim());
  expect(receipt.tree).toBe(Bun.spawnSync(["git", "-C", dir, "rev-parse", "HEAD^{tree}"]).stdout.toString().trim());
  expect(run.exit).toBe(0);
}, 120000);

test("--help exits 0 for the runner and for every probe, and names every flag", () => {
  const runner = invoke(repo, ["--help"]);
  expect(runner.exit).toBe(0);
  for (const flag of ["--config", "--root", "--receipt", "--unit", "--head", "--tree", "--scope", "--type", "--primary", "--secondary", "--help"]) {
    expect(runner.stdout).toContain(flag);
  }
  for (const probe of PROBES) {
    const proc = Bun.spawnSync(["bun", join(probeDir, `${probe.name}.mjs`), "--help"], { cwd: repo });
    expect(proc.exitCode).toBe(0);
    const text = proc.stdout.toString();
    expect(text).toContain("usage:");
    expect(text).toContain(probe.name);
    expect(text).toContain("--config");
  }
});

test("the runner stays inside its 250-line budget", () => {
  const count = readFileSync(sweepPath, "utf8").split("\n").length - 1;
  expect(count).toBeLessThanOrEqual(250);
});

test("every class a row carries belongs to the M0 set for the work type", () => {
  const dir = stage("clean");
  const run = sweepTo(dir);
  const classes = run.receipt.rows.filter((entry) => entry.class !== undefined).map((entry) => entry.class);
  expect(classes.length).toBeGreaterThan(0);
  for (const value of classes) expect(classValid("code", value)).toBe(true);
  expect([...new Set(classes)].every((value) => findingsClassesFor("code").includes(value))).toBe(true);
});

test("the draft-guard wrapper turns checker exit codes into rows", () => {
  const dir = stage("design");
  const checker = "bun checker.js";
  const runWith = (targets, expectArgs = []) => {
    writeConfig(dir, { type: "design", probes: { "draft-guard": { checker, targets } } });
    const proc = invoke(dir, ["--root", dir, "--config", ".wish-sweep.json", "--receipt", receiptFile(dir), "--unit", "u-m3", "--head", HEAD, "--tree", TREE, "--type", "design", ...expectArgs]);
    return { ...proc, receipt: JSON.parse(readFileSync(receiptFile(dir), "utf8")) };
  };

  const clean = runWith(["clean.css"]);
  expect(probeStatuses(clean.receipt)["draft-guard"]).toBe("PASS");
  expect(clean.exit).toBe(0);

  const dirty = runWith(["dirty.css"]);
  const failing = dirty.receipt.rows.filter((entry) => entry.verdict === "FAIL").map((entry) => entry.class);
  expect(probeStatuses(dirty.receipt)["draft-guard"]).toBe("FAIL");
  expect(failing.sort()).toEqual(["edge-stripe", "promo-copy"]);
  expect(dirty.exit).toBe(1);
  expect(validateReceipt(dirty.receipt)).toEqual({ ok: true, errors: [] });

  const odd = runWith(["odd.css"]);
  const unknown = odd.receipt.rows.find((entry) => entry.id.startsWith("draft-guard/mystery-rule"));
  expect(unknown.verdict).toBe("FAIL");
  expect(unknown.class).toBeUndefined();
  expect(validateReceipt(odd.receipt)).toEqual({ ok: true, errors: [] });

  const missing = runWith(["absent.css"]);
  expect(missing.receipt.rows.find((entry) => entry.id === "draft-guard").verdict).toBe("INVALID");
  expect(missing.receipt.status).toBe("WARN");
  expect(missing.exit).toBe(0);

  writeConfig(dir, { type: "design", probes: {} });
  const unconfigured = invoke(dir, ["--root", dir, "--config", ".wish-sweep.json", "--receipt", receiptFile(dir), "--unit", "u-m3", "--head", HEAD, "--tree", TREE, "--type", "design"]);
  expect(unconfigured.exit).toBe(0);
  expect(JSON.parse(readFileSync(receiptFile(dir), "utf8")).rows.find((entry) => entry.id === "draft-guard").verdict).toBe("SKIP");
});

test("a design run skips the code probes and names its type in the receipt", () => {
  const dir = stage("design");
  writeConfig(dir, { type: "design", probes: { "draft-guard": { checker: "bun checker.js", targets: ["clean.css"] } } });
  const run = invoke(dir, ["--root", dir, "--config", ".wish-sweep.json", "--receipt", receiptFile(dir), "--unit", "u-m3", "--head", HEAD, "--tree", TREE, "--type", "design"]);
  const receipt = JSON.parse(readFileSync(receiptFile(dir), "utf8"));
  expect(receipt.type).toBe("design");
  expect(receipt.rows.find((entry) => entry.id === "secrets").verdict).toBe("SKIP");
  expect(receipt.rows.find((entry) => entry.id === "secrets").note).toContain("probe types: code");
  expect(receipt.rows.find((entry) => entry.id === "draft-guard").verdict).toBe("PASS");
  expect(validateReceipt(receipt)).toEqual({ ok: true, errors: [] });
  expect(run.exit).toBe(0);
});

test("a mixed run applies both dictionaries and names its primary and secondary", () => {
  const dir = stage("seeded");
  writeConfig(dir, { type: "mixed", primary: "design", secondary: "code", probes: { secrets: { canary: CANARY, env: { TEST_API_TOKEN: CANARY }, commands: [{ name: "send-fail", cmd: "bun cli.js send --fail" }] }, "draft-guard": { checker: "bun ../design/checker.js", targets: [] } } });
  const run = invoke(dir, ["--root", dir, "--config", ".wish-sweep.json", "--receipt", receiptFile(dir), "--unit", "u-m3", "--head", HEAD, "--tree", TREE, "--type", "mixed", "--primary", "design", "--secondary", "code"]);
  const receipt = JSON.parse(readFileSync(receiptFile(dir), "utf8"));
  expect(receipt.primary).toBe("design");
  expect(receipt.secondary).toBe("code");
  expect(receipt.rows.find((entry) => entry.id === "secrets/send-fail").verdict).toBe("FAIL");
  expect(receipt.rows.find((entry) => entry.id === "draft-guard").verdict).toBe("SKIP");
  expect(validateReceipt(receipt)).toEqual({ ok: true, errors: [] });
  expect(run.exit).toBe(1);
});

test("a receipt written into a directory takes the canonical filename", () => {
  const dir = stage("clean");
  const out = join(dir, "receipts");
  writeConfig(dir);
  const run = invoke(dir, ["--root", dir, "--config", ".wish-sweep.json", "--receipt", out, "--unit", "u-m3", "--head", HEAD, "--tree", TREE]);
  const expected = join(out, `verify_lane-sweep-${HEAD.slice(0, 7)}.json`);
  expect(run.exit).toBe(0);
  expect(existsSync(expected)).toBe(true);
  const receipt = JSON.parse(readFileSync(expected, "utf8"));
  expect(validateReceiptAgainstFilename(receipt, expected.slice(expected.lastIndexOf("/") + 1))).toEqual({ ok: true, errors: [] });

  const canonical = join(dir, `verify_lane-sweep-${HEAD.slice(0, 7)}.json`);
  const explicit = invoke(dir, ["--root", dir, "--config", ".wish-sweep.json", "--receipt", canonical, "--unit", "u-m3", "--head", HEAD, "--tree", TREE]);
  expect(explicit.exit).toBe(0);
  expect(existsSync(canonical)).toBe(true);
});

test("no derivable head is a state mismatch, not a usage error", () => {
  const dir = stage("clean");
  writeConfig(dir);
  const run = invoke(dir, ["--root", dir, "--config", ".wish-sweep.json", "--receipt", receiptFile(dir), "--unit", "u-m3"]);
  expect(run.exit).toBe(3);
  expect(run.stderr).toContain("cannot derive HEAD");
  expect(existsSync(receiptFile(dir))).toBe(false);
});

test("the same config yields the same verdicts in two different roots, and writes no state", () => {
  const first = stage("clean");
  const second = stage("clean");
  const before = sweepTo(first);
  const after = sweepTo(second);
  expect(probeStatuses(after.receipt)).toEqual(probeStatuses(before.receipt));
  expect(existsSync(join(first, "findings.tsv"))).toBe(false);
  expect(existsSync(join(first, ".omo"))).toBe(false);
}, 120000);

test("--probe narrows the run, and the lane follows the probe or --lane", () => {
  const dir = stage("clean");
  const out = join(dir, "paired");
  mkdirSync(out);
  writeConfig(dir);
  const narrow = invoke(dir, ["--root", dir, "--config", ".wish-sweep.json", "--receipt", out, "--unit", "u-m3", "--head", HEAD, "--tree", TREE, "--probe", "secrets,mutation"]);
  expect(narrow.exit).toBe(0);
  const swept = join(out, `verify_lane-sweep-${HEAD.slice(0, 7)}.json`);
  expect(existsSync(swept)).toBe(true);
  const receipt = JSON.parse(readFileSync(swept, "utf8"));
  expect(receipt.lane).toBe("sweep");
  expect(new Set(receipt.rows.map((entry) => entry.id.split("/")[0]))).toEqual(new Set(["secrets", "mutation"]));

  const design = stage("design");
  const draftOut = join(design, "draft");
  mkdirSync(draftOut);
  writeConfig(design, { type: "design", probes: { "draft-guard": { checker: "bun checker.js", targets: ["clean.css"] } } });
  const one = invoke(design, ["--root", design, "--config", ".wish-sweep.json", "--receipt", draftOut, "--unit", "u-m3", "--head", HEAD, "--tree", TREE, "--type", "design", "--probe", "draft-guard"]);
  expect(one.exit).toBe(0);
  const named = join(draftOut, `verify_lane-draft-guard-${HEAD.slice(0, 7)}.json`);
  expect(existsSync(named)).toBe(true);
  expect(validateReceiptAgainstFilename(JSON.parse(readFileSync(named, "utf8")), `verify_lane-draft-guard-${HEAD.slice(0, 7)}.json`)).toEqual({ ok: true, errors: [] });

  const labelled = join(draftOut, `verify_lane-tests-${HEAD.slice(0, 7)}.json`);
  const relabelled = invoke(design, ["--root", design, "--config", ".wish-sweep.json", "--receipt", draftOut, "--unit", "u-m3", "--head", HEAD, "--tree", TREE, "--type", "design", "--probe", "draft-guard", "--lane", "tests"]);
  expect(relabelled.exit).toBe(0);
  expect(existsSync(labelled)).toBe(true);
});

test("the run budget stops the unproven probes and reports it as a memo", () => {
  expect(sweepBudget(10_000_000)).toBe(600000);
  expect(sweepBudget(50)).toBe(50);
  const dir = stage("clean");
  writeConfig(dir, {
    budgetMs: 100,
    probes: {
      secrets: { canary: CANARY, commands: [{ name: "slow", cmd: "bun -e 'const t=Date.now(); while (Date.now()-t < 400) {}'" }] },
      race: { cmd: "bun check.js" },
    },
  });
  const run = invoke(dir, ["--root", dir, "--config", ".wish-sweep.json", "--receipt", receiptFile(dir), "--unit", "u-m3", "--head", HEAD, "--tree", TREE]);
  const receipt = JSON.parse(readFileSync(receiptFile(dir), "utf8"));
  expect(receipt.rows.find((entry) => entry.id === "secrets/slow").verdict).toBe("PASS");
  expect(receipt.rows.find((entry) => entry.id === "race").verdict).toBe("SKIP");
  expect(receipt.rows.find((entry) => entry.id === "race").note).toContain("budget was exhausted");
  expect(receipt.rows.find((entry) => entry.id === "sweep/budget").verdict).toBe("WARN");
  expect(receipt.status).toBe("WARN");
  expect(run.exit).toBe(0);
});

test("a command runs exactly once and a non-zero exit is reported, not retried", async () => {
  const dir = stage("clean");
  const marker = join(dir, "runs.txt");
  const cmd = `printf 'x\\n' >> ${q(marker)}; exit 7`;
  const first = await runCommand({ cmd, cwd: dir, timeoutMs: 5000 });
  const second = await runCommand({ cmd, cwd: dir, timeoutMs: 5000 });
  expect(first.code).toBe(7);
  expect(second.code).toBe(7);
  expect(readFileSync(marker, "utf8").trim().split("\n")).toHaveLength(2);
}, 60000);

test("a --head that is not this checkout's HEAD is a state mismatch", () => {
  const dir = stage("clean");
  const git = (...args) => Bun.spawnSync(["git", "-c", "user.name=sweep", "-c", "user.email=sweep@test", ...args], { cwd: dir });
  expect(git("init", "-q").exitCode).toBe(0);
  expect(git("add", "-A").exitCode).toBe(0);
  expect(git("commit", "-q", "-m", "base").exitCode).toBe(0);
  writeConfig(dir);
  const run = invoke(dir, ["--root", dir, "--config", ".wish-sweep.json", "--receipt", receiptFile(dir), "--unit", "u-m3", "--head", "1".repeat(40)]);
  expect(run.exit).toBe(3);
  expect(run.stderr).toContain("not this checkout's HEAD");
  expect(existsSync(receiptFile(dir))).toBe(false);
});

test("prose and test files are never mutation candidates", () => {
  const dir = stage("clean");
  const guard = lineOf(dir, "cli.js", "upstream rejected");
  writeConfig(dir, { probes: { mutation: { testCmd: "bun check.js", failMarker: "CHECK FAILED", max: 5, candidates: [{ file: "usage.md", line: 2 }, { file: "cli.js", line: guard }] } } });
  const run = invoke(dir, ["--root", dir, "--config", ".wish-sweep.json", "--receipt", receiptFile(dir), "--unit", "u-m3", "--head", HEAD, "--tree", TREE]);
  const receipt = JSON.parse(readFileSync(receiptFile(dir), "utf8"));
  expect(receipt.rows.some((entry) => entry.id.startsWith("mutation/usage.md"))).toBe(false);
  expect(verdictOf(receipt, `mutation/cli.js:${guard}`)).toBe("PASS");
  expect(receipt.rows.some((entry) => entry.id === "mutation/limit")).toBe(false);
  expect(run.exit).toBe(0);
});

test("the error scan skips test files and prose", () => {
  const dir = stage("seeded");
  writeFileSync(join(dir, "checks.test.js"), "function wrap(e) {\n  return new Error(e.message);\n}\n");
  const rewrap = lineOf(dir, "cli.js", "new Error(error.message)");
  writeConfig(dir, {
    probes: {
      errors: {
        strict: true,
        lines: [{ file: "cli.js", line: rewrap }, { file: "checks.test.js", line: 2 }, { file: "usage.md", line: 2 }],
      },
    },
  });
  const run = invoke(dir, ["--root", dir, "--config", ".wish-sweep.json", "--receipt", receiptFile(dir), "--unit", "u-m3", "--head", HEAD, "--tree", TREE]);
  const receipt = JSON.parse(readFileSync(receiptFile(dir), "utf8"));
  expect(receipt.rows.filter((entry) => entry.id === "errors" || entry.id.startsWith("errors/")).map((entry) => entry.id)).toEqual([`errors/rewrapped-message:cli.js:${rewrap}`]);
  expect(run.exit).toBe(1);
});

test("a candidate path that escapes the throwaway copy is invalid and writes nothing", () => {
  const dir = stage("clean");
  writeConfig(dir, { probes: { mutation: { testCmd: "bun check.js", failMarker: "CHECK FAILED", candidates: [{ file: "../escaped.js", line: 1 }] } } });
  const run = invoke(dir, ["--root", dir, "--config", ".wish-sweep.json", "--receipt", receiptFile(dir), "--unit", "u-m3", "--head", HEAD, "--tree", TREE]);
  const receipt = JSON.parse(readFileSync(receiptFile(dir), "utf8"));
  const escaped = receipt.rows.find((entry) => entry.id === "mutation/../escaped.js:1");
  expect(escaped.verdict).toBe("INVALID");
  expect(escaped.note).toContain("escapes the throwaway copy");
  expect(run.exit).toBe(0);
});

test("a git fixture with a pre-existing documented flag: the diff-introduced flag fails and the pre-existing one only warns", () => {
  const dir = stage("clean");
  const git = (...args) => Bun.spawnSync(["git", "-c", "user.name=sweep", "-c", "user.email=sweep@test", ...args], { cwd: dir });
  expect(git("init", "-q").exitCode).toBe(0);
  const usageMd = join(dir, "usage.md");
  writeFileSync(usageMd, "# cli\n\n`cli.js send --text <value>` sends one message. `--fail` makes the transport refuse it. `--dry-run` is an old documented flag.\n");
  expect(git("add", "-A").exitCode).toBe(0);
  expect(git("commit", "-q", "-m", "base").exitCode).toBe(0);
  // The diff introduces a new documented flag that the program does not have.
  writeFileSync(usageMd, readFileSync(usageMd, "utf8") + "`cli send --brand-new` documents a new flag the program lacks.\n");
  expect(git("add", "-A").exitCode).toBe(0);
  expect(git("commit", "-q", "-m", "docs").exitCode).toBe(0);
  writeConfig(dir, { probes: { docs: { helpCmd: "bun cli.js --help", docs: ["usage.md"], base: "HEAD~1" } } });
  const out = join(dir, "out");
  const run = invoke(dir, ["--root", dir, "--config", ".wish-sweep.json", "--receipt", out, "--unit", "u-m3", "--probe", "docs"]);
  const head = Bun.spawnSync(["git", "-C", dir, "rev-parse", "HEAD"]).stdout.toString().trim();
  const receipt = JSON.parse(readFileSync(join(out, `verify_lane-docs-${head.slice(0, 7)}.json`), "utf8"));
  // New flag the diff documents wrongly: still a FAIL, so the probe keeps deciding it.
  expect(verdictOf(receipt, "docs/--brand-new")).toBe("FAIL");
  // Pre-existing documented flag missing from the stub help: WARN, not FAIL.
  expect(verdictOf(receipt, "docs/--dry-run")).toBe("WARN");
  expect(receipt.rows.find((entry) => entry.id === "docs/--dry-run").note).toContain("pre-existing");
  // A flag that exists in the help output still passes.
  expect(verdictOf(receipt, "docs/--fail")).toBe("PASS");
  // A WARN-only row keeps the run from failing: exit is decided by the FAIL row.
  expect(run.exit).toBe(1);
}, 120000);

test("the docs probe skips when a declared diff changed no doc", () => {
  const dir = stage("clean");
  const git = (...args) => Bun.spawnSync(["git", "-c", "user.name=sweep", "-c", "user.email=sweep@test", ...args], { cwd: dir });
  expect(git("init", "-q").exitCode).toBe(0);
  expect(git("add", "-A").exitCode).toBe(0);
  expect(git("commit", "-q", "-m", "base").exitCode).toBe(0);
  // Only a code file changes; the docs the diff touched are none.
  writeFileSync(join(dir, "cli.js"), readFileSync(join(dir, "cli.js"), "utf8") + "// touched\n");
  expect(git("add", "-A").exitCode).toBe(0);
  expect(git("commit", "-q", "-m", "code").exitCode).toBe(0);
  writeConfig(dir, { probes: { docs: { helpCmd: "bun cli.js --help", docs: ["usage.md"], base: "HEAD~1" } } });
  const out = join(dir, "out");
  const run = invoke(dir, ["--root", dir, "--config", ".wish-sweep.json", "--receipt", out, "--unit", "u-m3", "--probe", "docs"]);
  const head = Bun.spawnSync(["git", "-C", dir, "rev-parse", "HEAD"]).stdout.toString().trim();
  const receipt = JSON.parse(readFileSync(join(out, `verify_lane-docs-${head.slice(0, 7)}.json`), "utf8"));
  expect(receipt.rows.find((entry) => entry.id === "docs").verdict).toBe("SKIP");
  expect(run.exit).toBe(0);
}, 120000);

test("a git fixture documents a flag the diff itself documents wrongly and it still fails", () => {
  const dir = stage("clean");
  const git = (...args) => Bun.spawnSync(["git", "-c", "user.name=sweep", "-c", "user.email=sweep@test", ...args], { cwd: dir });
  expect(git("init", "-q").exitCode).toBe(0);
  expect(git("add", "-A").exitCode).toBe(0);
  expect(git("commit", "-q", "-m", "base").exitCode).toBe(0);
  // The diff documents --brand-new, which the program lacks: a FAIL even with a diff in play.
  writeFileSync(join(dir, "usage.md"), "# cli\n\n`cli send --brand-new` is a new flag.\n");
  expect(git("add", "-A").exitCode).toBe(0);
  expect(git("commit", "-q", "-m", "docs").exitCode).toBe(0);
  writeConfig(dir, { probes: { docs: { helpCmd: "bun cli.js --help", docs: ["usage.md"], base: "HEAD~1" } } });
  const out = join(dir, "out");
  const run = invoke(dir, ["--root", dir, "--config", ".wish-sweep.json", "--receipt", out, "--unit", "u-m3", "--probe", "docs"]);
  const head = Bun.spawnSync(["git", "-C", dir, "rev-parse", "HEAD"]).stdout.toString().trim();
  const receipt = JSON.parse(readFileSync(join(out, `verify_lane-docs-${head.slice(0, 7)}.json`), "utf8"));
  expect(verdictOf(receipt, "docs/--brand-new")).toBe("FAIL");
  expect(run.exit).toBe(1);
}, 120000);

test("the docs help command is supervised by the same bounded runner", () => {
  const dir = stage("clean");
  writeConfig(dir, { probes: { docs: { helpCmd: "sleep 30", docs: ["usage.md"], helpTimeoutMs: 300 } } });
  const started = Date.now();
  const run = invoke(dir, ["--root", dir, "--config", ".wish-sweep.json", "--receipt", receiptFile(dir), "--unit", "u-m3", "--head", HEAD, "--tree", TREE]);
  const elapsed = Date.now() - started;
  const receipt = JSON.parse(readFileSync(receiptFile(dir), "utf8"));
  expect(elapsed).toBeLessThan(20000);
  expect(receipt.rows.find((entry) => entry.id === "docs/--fail").verdict).toBe("FAIL");
  expect(run.exit).toBe(1);
});

test("a mixed run takes its primary type's identity form", () => {
  const dir = stage("seeded");
  const artifact = "a".repeat(64);
  writeConfig(dir, { type: "mixed", primary: "research", secondary: "code", probes: { secrets: { canary: CANARY, env: { TEST_API_TOKEN: CANARY }, commands: [{ name: "send-fail", cmd: "bun cli.js send --fail" }] } } });
  const run = invoke(dir, ["--root", dir, "--config", ".wish-sweep.json", "--receipt", join(dir, "out"), "--unit", "u-m3", "--head", artifact, "--type", "mixed", "--primary", "research", "--secondary", "code"]);
  const receipt = JSON.parse(readFileSync(join(dir, "out", `verify_lane-sweep-${artifact.slice(0, 7)}.json`), "utf8"));
  expect(receipt.head).toBe(artifact);
  expect(receipt.tree).toBeNull();
  expect(receipt.rows.find((entry) => entry.id === "secrets/send-fail").verdict).toBe("FAIL");
  expect(validateReceipt(receipt)).toEqual({ ok: true, errors: [] });
  expect(run.exit).toBe(1);
});

test("a symlinked candidate is invalid and its target is untouched", () => {
  const dir = stage("clean");
  const outside = join(dir, "..", `outside-${process.pid}.js`);
  writeFileSync(outside, "const untouched = 1;\n");
  Bun.spawnSync(["ln", "-s", outside, join(dir, "linked.js")]);
  writeConfig(dir, { probes: { mutation: { testCmd: "bun check.js", failMarker: "CHECK FAILED", candidates: [{ file: "linked.js", line: 1 }] } } });
  const run = invoke(dir, ["--root", dir, "--config", ".wish-sweep.json", "--receipt", receiptFile(dir), "--unit", "u-m3", "--head", HEAD, "--tree", TREE]);
  const receipt = JSON.parse(readFileSync(receiptFile(dir), "utf8"));
  const linked = receipt.rows.find((entry) => entry.id === "mutation/linked.js:1");
  expect(linked.verdict).toBe("INVALID");
  expect(linked.note).toContain("symlink");
  expect(readFileSync(outside, "utf8")).toBe("const untouched = 1;\n");
  rmSync(outside, { force: true });
  expect(run.exit).toBe(0);
});

test("a config case name cannot steer a write outside the scratch directory", () => {
  const dir = stage("clean");
  writeConfig(dir, { probes: { config: { cases: [{ name: "../../../escaped-case", cmd: "bun cli.js config --file {tmp}", file: { text: "hello" }, expect: "accept" }] } } });
  const run = invoke(dir, ["--root", dir, "--config", ".wish-sweep.json", "--receipt", receiptFile(dir), "--unit", "u-m3", "--head", HEAD, "--tree", TREE]);
  const receipt = JSON.parse(readFileSync(receiptFile(dir), "utf8"));
  const row = receipt.rows.find((entry) => entry.id.startsWith("config/"));
  expect(row.verdict).toBe("PASS");
  expect(row.command).not.toContain("..");
  expect(row.command).toContain("escaped-case");
  expect(run.exit).toBe(0);
});

test("a checker diagnostic never reaches the receipt or stdout", () => {
  const dir = stage("design");
  writeFileSync(join(dir, "leaky.js"), "#!/usr/bin/env bun\nprocess.stderr.write('token=SECRET-abc123\\n');\nprocess.exit(2);\n");
  writeConfig(dir, { type: "design", probes: { "draft-guard": { checker: "bun leaky.js", targets: ["clean.css"] } } });
  const run = invoke(dir, ["--root", dir, "--config", ".wish-sweep.json", "--receipt", receiptFile(dir), "--unit", "u-m3", "--head", HEAD, "--tree", TREE, "--type", "design"]);
  const receipt = JSON.parse(readFileSync(receiptFile(dir), "utf8"));
  const row = receipt.rows.find((entry) => entry.id === "draft-guard");
  expect(row.verdict).toBe("INVALID");
  expect(row.note).not.toContain("SECRET-abc123");
  expect(readFileSync(receiptFile(dir), "utf8")).not.toContain("SECRET-abc123");
  expect(run.stdout).not.toContain("SECRET-abc123");
});

test("killSession takes a child that moved into its own process group", async () => {
  const child = Bun.spawn(["bash", "-c", "set -m; sleep 30 & echo $!; wait"], { stdout: "pipe", stderr: "ignore", detached: true });
  const decoder = new TextDecoder();
  let text = "";
  let moved = null;
  const reader = child.stdout.getReader();
  while (moved === null) {
    const { value, done } = await reader.read();
    if (done) break;
    text += decoder.decode(value);
    const match = /^(\d+)/m.exec(text);
    if (match) moved = Number(match[1]);
  }
  expect(moved).toBeGreaterThan(0);
  expect(sessionMembers(child.pid)).toContain(moved);
  killSession(child.pid);
  expect(sessionMembers(child.pid)).toEqual([]);
  expect(() => process.kill(moved, 0)).toThrow();
  await child.exited;
  await reader.cancel();
}, 30000);

test("the mutation cap cannot be raised above twelve lines", () => {
  const dir = stage("clean");
  const candidates = Array.from({ length: 13 }, (_, index) => ({ file: "cli.js", line: index + 1 }));
  writeConfig(dir, { probes: { mutation: { testCmd: "true", failMarker: "CHECK FAILED", max: 99, candidates } } });
  const run = invoke(dir, ["--root", dir, "--config", ".wish-sweep.json", "--receipt", receiptFile(dir), "--unit", "u-m3", "--head", HEAD, "--tree", TREE]);
  const receipt = JSON.parse(readFileSync(receiptFile(dir), "utf8"));
  const probed = receipt.rows.filter((entry) => entry.id.startsWith("mutation/cli.js")).length;
  expect(probed).toBe(12);
  expect(receipt.rows.find((entry) => entry.id === "mutation/limit").note).toContain("12 of 13 added production lines probed");
});

test("a config that is valid JSON but not an object is a usage error", () => {
  const dir = stage("clean");
  for (const body of ["null", "[]", '"text"']) {
    writeFileSync(join(dir, "odd.json"), body);
    const run = invoke(dir, ["--root", dir, "--config", "odd.json"]);
    expect(run.exit).toBe(2);
    expect(run.stderr).toContain("config must be a JSON object");
  }
});

test("a revision-shaped option in the config cannot write outside the sweep", () => {
  const dir = stage("clean");
  writeConfig(dir, { probes: { errors: { strict: true, base: `--output=${join(dir, "unexpected")}` } } });
  const run = invoke(dir, ["--root", dir, "--config", ".wish-sweep.json"]);
  expect(run.exit).toBe(1);
  expect(run.stdout).toContain("a base must be a revision, not an option");
  expect(existsSync(join(dir, "unexpected...HEAD"))).toBe(false);
});

test("a mutation that does not parse is invalid, not a kill", () => {
  const dir = stage("clean");
  const line = lineOf(dir, "cli.js", "function split(buf, limit");
  writeConfig(dir, { probes: { mutation: { testCmd: "bun check.js", failMarker: "CHECK FAILED", candidates: [{ file: "cli.js", line }] } } });
  const run = invoke(dir, ["--root", dir, "--config", ".wish-sweep.json", "--receipt", receiptFile(dir), "--unit", "u-m3", "--head", HEAD, "--tree", TREE]);
  const receipt = JSON.parse(readFileSync(receiptFile(dir), "utf8"));
  const row = receipt.rows.find((entry) => entry.id === `mutation/cli.js:${line}`);
  expect(row.verdict).toBe("INVALID");
  expect(row.note).toContain("did not parse");
  expect(run.exit).toBe(0);
});

test("an explicit receipt name must already be the M0 form", () => {
  const dir = stage("clean");
  writeConfig(dir);
  const run = invoke(dir, ["--root", dir, "--config", ".wish-sweep.json", "--receipt", join(dir, "receipt.json"), "--unit", "u-m3", "--head", HEAD, "--tree", TREE]);
  expect(run.exit).toBe(2);
  expect(run.stderr).toContain("is not a receipt filename");
  expect(existsSync(join(dir, "receipt.json"))).toBe(false);
});

test("the lifecycle timeouts are clamped to the command ceiling", () => {
  expect(clampMs(999999, 5000)).toBe(300000);
  expect(clampMs(1, 5000)).toBe(1);
  expect(clampMs(undefined, 5000)).toBe(5000);
  expect(clampMs(0, 5000)).toBe(5000);
});

test("an unwritable receipt path is a state mismatch, not a crash", () => {
  const dir = stage("clean");
  writeConfig(dir);
  const run = invoke(dir, ["--root", dir, "--config", ".wish-sweep.json", "--receipt", "/proc/verify_lane-sweep-0123456.json", "--unit", "u-m3", "--head", HEAD, "--tree", TREE]);
  expect(run.exit).toBe(3);
  expect(run.stderr).toContain("cannot write the receipt");
  expect(run.stderr).not.toContain("TypeError");
});

test("a standalone probe refuses a config that is not an object", () => {
  const dir = stage("clean");
  writeFileSync(join(dir, "null.json"), "null");
  const proc = Bun.spawnSync(["bun", join(probeDir, "secrets.mjs"), "--root", dir, "--config", "null.json"], { cwd: repo });
  expect(proc.exitCode).toBe(2);
  expect(proc.stderr.toString()).toContain("config must be a JSON object");
});

test("the round-trip comparison keeps whitespace and forgives one newline", () => {
  const dir = stage("clean");
  writeConfig(dir, {
    probes: {
      boundary: {
        cases: [
          { name: "padded", cmd: "printf ' x '", stdin: "a", expectExit: [0], expectStdout: "x" },
          { name: "newline", cmd: "printf 'x\\n'", stdin: "a", expectExit: [0], expectStdout: "x" },
        ],
      },
    },
  });
  const run = invoke(dir, ["--root", dir, "--config", ".wish-sweep.json", "--receipt", receiptFile(dir), "--unit", "u-m3", "--head", HEAD, "--tree", TREE]);
  const receipt = JSON.parse(readFileSync(receiptFile(dir), "utf8"));
  expect(verdictOf(receipt, "boundary/padded:declared")).toBe("FAIL");
  expect(verdictOf(receipt, "boundary/newline:declared")).toBe("PASS");
  expect(run.exit).toBe(1);
});

test("the dictionary's code table is exactly M0's code class set", () => {
  const doc = readFileSync(join(repo, "skills/wish/references/defect-classes.md"), "utf8");
  const section = doc.split("## 4. Code classes")[1].split("## 5.")[0];
  const tokens = [...section.matchAll(/^\| `([A-Za-z0-9_]+)` /gm)].map((match) => match[1]);
  expect(tokens.length).toBe(findingsClassesFor("code").length);
  for (const token of tokens) expect(classValid("code", token)).toBe(true);
  expect(new Set(tokens)).toEqual(new Set(findingsClassesFor("code")));
});