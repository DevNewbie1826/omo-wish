import { afterAll, expect, test } from "bun:test";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PROBES } from "../skills/wish/scripts/probes/index.mjs";
import {
  clampMs, commentOnlyLines, ctxFor, hasCommentSyntax, killSession, q, runCommand, sessionMembers, sweepBudget,
} from "../skills/wish/scripts/probes/lib.mjs";
import { COMPILED_EXTENSIONS } from "../skills/wish/scripts/probes/mutation.mjs";
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

test("a comment-only added line is never a mutation candidate, declared or diff-derived", () => {
  const dir = stage("clean");
  const git = (...args) => Bun.spawnSync(["git", "-c", "user.name=sweep", "-c", "user.email=sweep@test", ...args], { cwd: dir });
  const facts = () => ({
    head: git("rev-parse", "HEAD").stdout.toString().trim(),
    tree: git("rev-parse", "HEAD^{tree}").stdout.toString().trim(),
  });
  const sweepOnce = () => {
    const { head, tree } = facts();
    const out = join(dir, `verify_lane-sweep-${head.slice(0, 7)}.json`);
    const run = invoke(dir, ["--root", dir, "--config", ".wish-sweep.json", "--receipt", out, "--unit", "u-m3", "--head", head, "--tree", tree]);
    return { ...run, receipt: existsSync(out) ? JSON.parse(readFileSync(out, "utf8")) : null };
  };
  expect(git("init", "-q").exitCode).toBe(0);
  expect(git("add", "-A").exitCode).toBe(0);
  expect(git("commit", "-q", "-m", "base").exitCode).toBe(0);
  const cli = join(dir, "cli.js");
  const base = readFileSync(cli, "utf8");
  // A block comment's body carries no marker of its own: that is the line that
  // used to survive and fail the lane, and the guarded line beside it is the
  // control that must still be probed and killed.
  writeFileSync(cli, `${base}
/*
Sends one message and reports it.
The transport may refuse the request; the failure never echoes the credential.
*/
`);
  const comment = lineOf(dir, "cli.js", "may refuse the request");
  const guard = lineOf(dir, "cli.js", "upstream rejected");

  writeConfig(dir, { probes: { mutation: { testCmd: "bun check.js", failMarker: "CHECK FAILED", candidates: [{ file: "cli.js", line: comment }, { file: "cli.js", line: guard }] } } });
  const declared = sweepOnce();
  expect(declared.receipt.rows.some((entry) => entry.id === `mutation/cli.js:${comment}`)).toBe(false);
  expect(verdictOf(declared.receipt, `mutation/cli.js:${guard}`)).toBe("PASS");
  expect(declared.receipt.status).toBe("PASS");
  expect(declared.exit).toBe(0);

  expect(git("add", "-A").exitCode).toBe(0);
  expect(git("commit", "-q", "-m", "add the comment").exitCode).toBe(0);
  writeConfig(dir, { probes: { mutation: { testCmd: "bun check.js", failMarker: "CHECK FAILED", base: "HEAD~1" } } });
  const derived = sweepOnce();
  expect(derived.receipt.rows.some((entry) => entry.id.startsWith("mutation/cli.js"))).toBe(false);
  expect(derived.receipt.rows.some((entry) => entry.verdict === "FAIL")).toBe(false);
  expect(derived.exit).toBe(0);
}, 120000);

test("a compiled-language deletion that cannot build is a non-candidate, not a kill", () => {
  const dir = stage("clean");
  // A Go source file with a build step that refuses the broken deletion, so the
  // classification under test is the probe's own and never a toolchain's presence.
  writeFileSync(join(dir, "guard.go"), "package guard\n\nfunc Guard(x int) bool {\n\tif x > 0 {\n\t\treturn true\n\t}\n\treturn false\n}\n");
  writeFileSync(join(dir, "build.sh"), [
    "#!/bin/sh",
    "if ! grep -q 'func Guard(x int) bool {' guard.go; then",
    "  echo 'BuildMessage: syntax error: unexpected newline, expecting function signature'",
    "  exit 1",
    "fi",
    "echo 'CHECK OK'",
    "",
  ].join("\n"));
  const signature = lineOf(dir, "guard.go", "func Guard(x int) bool {");
  const guard = lineOf(dir, "guard.go", "return true");
  writeConfig(dir, { probes: { mutation: { testCmd: "sh build.sh", failMarker: "CHECK FAILED", candidates: [{ file: "guard.go", line: signature }, { file: "guard.go", line: guard }] } } });
  const run = invoke(dir, ["--root", dir, "--config", ".wish-sweep.json", "--receipt", receiptFile(dir), "--unit", "u-m3", "--head", HEAD, "--tree", TREE]);
  const receipt = JSON.parse(readFileSync(receiptFile(dir), "utf8"));
  expect(receipt.rows.some((entry) => entry.id === `mutation/guard.go:${signature}`)).toBe(false);
  const skipped = receipt.rows.find((entry) => entry.id === "mutation/noncandidate/guard.go");
  expect(skipped.verdict).toBe("SKIP");
  expect(skipped.note).toContain("does not build");
  expect(skipped.note).toContain(String(signature));
  expect(skipped.class).toBeUndefined();
  expect(receipt.rows.some((entry) => entry.verdict === "INVALID")).toBe(false);
  // The buildable candidate is still a real mutation: the suite stayed green.
  expect(verdictOf(receipt, `mutation/guard.go:${guard}`)).toBe("FAIL");
  expect(receipt.status).toBe("FAIL");
  expect(run.exit).toBe(1);
}, 120000);

test("a run where every candidate cannot build never reads as PASS", () => {
  const dir = stage("clean");
  writeFileSync(join(dir, "guard.go"), "package guard\n\nfunc Guard(x int) bool {\n\treturn x > 0\n}\n");
  writeFileSync(join(dir, "build.sh"), [
    "#!/bin/sh",
    "if ! grep -q 'func Guard(x int) bool {' guard.go; then",
    "  echo 'BuildMessage: syntax error: unexpected newline, expecting function signature'",
    "  exit 1",
    "fi",
    "echo 'CHECK OK'",
    "",
  ].join("\n"));
  const signature = lineOf(dir, "guard.go", "func Guard(x int) bool {");
  writeConfig(dir, { probes: { mutation: { testCmd: "sh build.sh", failMarker: "CHECK FAILED", candidates: [{ file: "guard.go", line: signature }] } } });
  const run = invoke(dir, ["--root", dir, "--config", ".wish-sweep.json", "--receipt", receiptFile(dir), "--unit", "u-m3", "--head", HEAD, "--tree", TREE]);
  const receipt = JSON.parse(readFileSync(receiptFile(dir), "utf8"));
  expect(verdictOf(receipt, "mutation/noncandidate/guard.go")).toBe("SKIP");
  expect(verdictOf(receipt, "mutation/unprobed")).toBe("WARN");
  expect(receipt.status).toBe("WARN");
  expect(run.exit).toBe(0);
}, 120000);

test("a green suite survives even when the log says syntax error", () => {
  const dir = stage("clean");
  // A compiled candidate whose build succeeds and whose suite stays green, while the
  // suite's own log prints a build-error phrase. The exit code decides, so this is a
  // SURVIVED mutation and never a non-candidate.
  writeFileSync(join(dir, "guard.go"), "package guard\n\nfunc Guard(x int) bool {\n\treturn x > 0\n}\n");
  writeFileSync(join(dir, "build.sh"), [
    "#!/bin/sh",
    "echo 'syntax error: this line is a test log, not a build failure'",
    "exit 0",
    "",
  ].join("\n"));
  const guard = lineOf(dir, "guard.go", "return x > 0");
  writeConfig(dir, { probes: { mutation: { testCmd: "sh build.sh", failMarker: "CHECK FAILED", candidates: [{ file: "guard.go", line: guard }] } } });
  const run = invoke(dir, ["--root", dir, "--config", ".wish-sweep.json", "--receipt", receiptFile(dir), "--unit", "u-m3", "--head", HEAD, "--tree", TREE]);
  const receipt = JSON.parse(readFileSync(receiptFile(dir), "utf8"));
  expect(verdictOf(receipt, `mutation/guard.go:${guard}`)).toBe("FAIL");
  expect(receipt.rows.some((entry) => entry.id.startsWith("mutation/noncandidate/"))).toBe(false);
  expect(receipt.status).toBe("FAIL");
  expect(run.exit).toBe(1);
}, 120000);

test("every extension the compiled set names has a comment syntax and drops a comment body", () => {
  // A compiled extension outside the comment table would fall back to the marker test,
  // and the block-comment body symptom would return for it. The table must cover the set.
  // A Set has no enumerable keys, so the set must be spread: Object.keys here would make
  // this loop vacuous and the coverage claim false.
  const compiled = [...COMPILED_EXTENSIONS];
  expect(compiled.length).toBeGreaterThan(20);
  for (const extension of compiled) {
    expect(hasCommentSyntax(extension)).toBe(true);
  }
  const dir = stage("clean");
  // Per-extension syntax: a C-family block, and the ML block for the ML extensions.
  const sources = {
    "guard.cxx": ["/*", "body of a comment with a ' quote", "*/", "real statement", ""],
    "guard.hh": ["/*", "body of a comment with a \" quote", "*/", "real statement", ""],
    "guard.mli": ["(*", "body of a comment with a ' quote", "*)", "real statement", ""],
  };
  for (const [name, lines] of Object.entries(sources)) writeFileSync(join(dir, name), lines.join("\n"));
  writeFileSync(join(dir, "build.sh"), "#!/bin/sh\nexit 0\n");
  const files = Object.keys(sources);
  writeConfig(dir, { probes: { mutation: {
    testCmd: "sh build.sh", failMarker: "CHECK FAILED", codeExtensions: [...files.map((name) => name.split(".")[1]), "js"],
    candidates: files.flatMap((file) => [{ file, line: 2 }, { file, line: 4 }]),
  } } });
  const run = invoke(dir, ["--root", dir, "--config", ".wish-sweep.json", "--receipt", receiptFile(dir), "--unit", "u-m3", "--head", HEAD, "--tree", TREE]);
  const receipt = JSON.parse(readFileSync(receiptFile(dir), "utf8"));
  for (const name of files) {
    expect(receipt.rows.some((entry) => entry.id === `mutation/${name}:2`)).toBe(false);
    expect(receipt.rows.some((entry) => entry.id === `mutation/${name}:4`)).toBe(true);
  }
  expect(run.exit).toBe(1);
}, 120000);

test("a string or regular expression that looks like a comment never hides real code", () => {
  const dir = stage("clean");
  // A template string holding "/*" whose closing "*/" only appears after the statement
  // below it, and a regular expression containing "/*": both used to open a phantom block
  // comment that swallowed the next statement.
  writeFileSync(join(dir, "app.js"), [
    "export const banner = `",
    "/* this is inside a string, not a comment",
    "`;",
    "export const re = /[/*]/;",
    "export const victim = 2;",
    "export const tail = `*/ still a string`;",
    "",
  ].join("\n"));
  // The suite never reads `victim`, so removing it leaves the run green: a real survivor
  // the filter must not have swallowed.
  writeFileSync(join(dir, "check.js"), [
    'import { banner, re, tail } from "./app.js";',
    "let failures = 0;",
    "if (!banner.includes(\"not a comment\")) failures += 1;",
    "if (!re.test(\"/\")) failures += 1;",
    "if (!tail.includes(\"still a string\")) failures += 1;",
    "if (failures > 0) { console.log(\"CHECK FAILED\"); process.exit(1); }",
    "",
  ].join("\n"));
  const victimLine = lineOf(dir, "app.js", "export const victim");
  // The candidates carry their own text, the shape the diff reader produces: without it
  // the marker-prefix heuristic never runs and this test would miss a real shape.
  const appLines = readFileSync(join(dir, "app.js"), "utf8").split("\n");
  const candidate = (line) => ({ file: "app.js", line, text: appLines[line - 1] });
  writeConfig(dir, { probes: { mutation: {
    testCmd: "bun check.js", failMarker: "CHECK FAILED", max: 6,
    candidates: [candidate(2), candidate(lineOf(dir, "app.js", "export const re")), candidate(victimLine)],
  } } });
  const run = invoke(dir, ["--root", dir, "--config", ".wish-sweep.json", "--receipt", receiptFile(dir), "--unit", "u-m3", "--head", HEAD, "--tree", TREE]);
  const receipt = JSON.parse(readFileSync(receiptFile(dir), "utf8"));
  expect(verdictOf(receipt, `mutation/app.js:${victimLine}`)).toBe("FAIL");
  expect(receipt.status).toBe("FAIL");
  expect(run.exit).toBe(1);
}, 120000);

test("a string that spans lines keeps a comment marker inside the string", () => {
  const dir = stage("clean");
  // Both C and JavaScript accept a backslash-newline inside a quoted literal. The second
  // physical line begins with /* inside that string, so a scanner without carried string
  // state would open a comment and drop the surviving statement below it.
  writeFileSync(join(dir, "app.c"), [
    'const char *note = "one \\',
    '/* two";',
    "int survivor(int x) {",
    "  return x > 0;",
    "}",
    'const char *tail = "end */ here";',
    "",
  ].join("\n"));
  writeFileSync(join(dir, "app.js"), [
    'export const note = "one \\',
    '/* two";',
    "export function survivor(x) {",
    "  return x > 0;",
    "}",
    'export const tail = "end */ here";',
    "",
  ].join("\n"));
  // The suite reads the string but never calls survivor, so removing that statement leaves
  // the run green: a real survivor the scanner must not have swallowed.
  writeFileSync(join(dir, "check.js"), [
    'import { note } from "./app.js";',
    'if (!note.includes("two")) { console.log("CHECK FAILED"); process.exit(1); }',
    "",
  ].join("\n"));
  const cLine = lineOf(dir, "app.c", "return x > 0");
  const jsLine = lineOf(dir, "app.js", "return x > 0");
  writeConfig(dir, { probes: { mutation: {
    testCmd: "bun check.js", failMarker: "CHECK FAILED",
    candidates: [{ file: "app.c", line: cLine }, { file: "app.js", line: jsLine }],
  } } });
  const run = invoke(dir, ["--root", dir, "--config", ".wish-sweep.json", "--receipt", receiptFile(dir), "--unit", "u-m3", "--head", HEAD, "--tree", TREE]);
  const receipt = JSON.parse(readFileSync(receiptFile(dir), "utf8"));
  // The suite reads neither line's value behaviour, so removing the JS survivor leaves it
  // green: that line must reach the probe and FAIL, not vanish from the candidate list.
  expect(verdictOf(receipt, `mutation/app.js:${jsLine}`)).toBe("FAIL");
  expect(receipt.status).toBe("FAIL");
  expect(run.exit).toBe(1);
}, 120000);

test("a backtick inside a regular expression is not a template opener", () => {
  const dir = stage("clean");
  writeFileSync(join(dir, "app.js"), [
    "export const tick = /`/;",
    "/* a real comment",
    "with a body line",
    "*/",
    "export const value = 1;",
    "",
  ].join("\n"));
  writeFileSync(join(dir, "check.js"), [
    'import { tick, value } from "./app.js";',
    "let failures = 0;",
    'if (!tick.test("`")) failures += 1;',
    "if (value !== 1) failures += 1;",
    'if (failures > 0) { console.log("CHECK FAILED"); process.exit(1); }',
    "",
  ].join("\n"));
  const body = lineOf(dir, "app.js", "with a body line");
  writeConfig(dir, { probes: { mutation: {
    testCmd: "bun check.js", failMarker: "CHECK FAILED",
    candidates: [{ file: "app.js", line: body }],
  } } });
  const run = invoke(dir, ["--root", dir, "--config", ".wish-sweep.json", "--receipt", receiptFile(dir), "--unit", "u-m3", "--head", HEAD, "--tree", TREE]);
  const receipt = JSON.parse(readFileSync(receiptFile(dir), "utf8"));
  expect(receipt.rows.some((entry) => entry.id === `mutation/app.js:${body}`)).toBe(false);
  expect(run.exit).toBe(0);
}, 120000);

test("a backslash before a Go raw-string close does not escape it", () => {
  const source = [
    "package app",
    "",
    "var raw = `a\\`",
    "",
    "/* a real comment",
    "with a body line",
    "*/",
    "var value = 1",
    "",
  ].join("\n");
  const only = [...commentOnlyLines(source, "app.go")];
  expect(only).toContain(6);
  expect(only).not.toContain(8);
}, 30000);

test("every language whose block comments nest counts depth", () => {
  const cases = [
    ["a.ml", "(* outer", "(* inner *)", "body", "*)", "let x = 1"],
    ["a.hs", "{- outer", "{- inner -}", "body", "-}", "x = 1"],
    ["a.nim", "#[ outer", "#[ inner ]#", "body", "]#", "var x = 1"],
    ["a.rs", "/* outer", "/* inner */", "body", "*/", "let x = 1;"],
  ];
  for (const [file, ...lines] of cases) {
    const source = lines.join("\n") + "\n";
    const only = [...commentOnlyLines(source, file)];
    expect(only).toContain(3);
    expect(only).not.toContain(5);
  }
  const flat = "/* outer\n/* inner */\nint x;\n*/\nint y;\n";
  expect([...commentOnlyLines(flat, "a.c")]).not.toContain(3);
}, 30000);

test("a real block comment after code keeps its body out of the candidates", () => {
  const dir = stage("clean");
  writeFileSync(join(dir, "app.js"), [
    "export const first = 1; /* a comment that runs",
    "across a line with no marker at all",
    "*/",
    "export const second = 2;",
    "",
  ].join("\n"));
  writeFileSync(join(dir, "check.js"), [
    'import { first, second } from "./app.js";',
    "let failures = 0;",
    "if (first !== 1) failures += 1;",
    "if (second !== 2) failures += 1;",
    'if (failures > 0) { console.log("CHECK FAILED"); process.exit(1); }',
    "",
  ].join("\n"));
  const body = lineOf(dir, "app.js", "across a line with no marker");
  writeConfig(dir, { probes: { mutation: {
    testCmd: "bun check.js", failMarker: "CHECK FAILED",
    candidates: [{ file: "app.js", line: body }],
  } } });
  const run = invoke(dir, ["--root", dir, "--config", ".wish-sweep.json", "--receipt", receiptFile(dir), "--unit", "u-m3", "--head", HEAD, "--tree", TREE]);
  const receipt = JSON.parse(readFileSync(receiptFile(dir), "utf8"));
  expect(receipt.rows.some((entry) => entry.id === `mutation/app.js:${body}`)).toBe(false);
  expect(receipt.rows.some((entry) => entry.verdict === "FAIL")).toBe(false);
  expect(run.exit).toBe(0);
}, 120000);

test("a comment inside a template expression is a comment", () => {
  const dir = stage("clean");
  writeFileSync(join(dir, "app.js"), [
    "export const value = 2;",
    "export const label = `x${",
    "  /* a comment inside the interpolation */",
    "  value",
    "}y`;",
    "",
  ].join("\n"));
  writeFileSync(join(dir, "check.js"), [
    'import { label } from "./app.js";',
    'if (label !== "x2y") { console.log("CHECK FAILED"); process.exit(1); }',
    "",
  ].join("\n"));
  const comment = lineOf(dir, "app.js", "a comment inside the interpolation");
  writeConfig(dir, { probes: { mutation: {
    testCmd: "bun check.js", failMarker: "CHECK FAILED",
    candidates: [{ file: "app.js", line: comment }],
  } } });
  const run = invoke(dir, ["--root", dir, "--config", ".wish-sweep.json", "--receipt", receiptFile(dir), "--unit", "u-m3", "--head", HEAD, "--tree", TREE]);
  const receipt = JSON.parse(readFileSync(receiptFile(dir), "utf8"));
  expect(receipt.rows.some((entry) => entry.id === `mutation/app.js:${comment}`)).toBe(false);
  expect(run.exit).toBe(0);
}, 120000);

test("a stray CR inside a string does not shift the scanner's line numbers", () => {
  const dir = stage("clean");
  // git counts lines on \n only, so the scanner must too: a raw CR before the comment
  // would otherwise move every later line by one and drop a code line as comment-only.
  writeFileSync(join(dir, "app.js"), `export const raw = \`a\rb\`;\n/*\nbody\n*/\nexport const kept = 3;\n`);
  writeFileSync(join(dir, "check.js"), [
    'import { raw, kept } from "./app.js";',
    "let failures = 0;",
    "if (raw.length !== 3) failures += 1;",
    "if (kept !== 3) failures += 1;",
    'if (failures > 0) { console.log("CHECK FAILED"); process.exit(1); }',
    "",
  ].join("\n"));
  const kept = lineOf(dir, "app.js", "export const kept");
  writeConfig(dir, { probes: { mutation: {
    testCmd: "bun check.js", failMarker: "CHECK FAILED",
    candidates: [{ file: "app.js", line: kept }],
  } } });
  const run = invoke(dir, ["--root", dir, "--config", ".wish-sweep.json", "--receipt", receiptFile(dir), "--unit", "u-m3", "--head", HEAD, "--tree", TREE]);
  const receipt = JSON.parse(readFileSync(receiptFile(dir), "utf8"));
  expect(receipt.rows.some((entry) => entry.id === `mutation/app.js:${kept}`)).toBe(true);
}, 120000);

test("a failure-summary line that says error: does not demote a real kill", () => {
  const dir = stage("clean");
  writeFileSync(join(dir, "app.go"), "package app\n\nfunc Guard(x int) bool {\n\treturn x > 0\n}\n");
  writeFileSync(join(dir, "run.sh"), [
    "#!/bin/sh",
    "if ! grep -q 'return x > 0' app.go; then",
    "  echo 'CHECK FAILED'",
    "  echo 'error: test failed, to rerun pass --lib'",
    "  exit 1",
    "fi",
    "echo ok",
    "",
  ].join("\n"));
  const guard = lineOf(dir, "app.go", "return x > 0");
  writeConfig(dir, { probes: { mutation: {
    testCmd: "sh run.sh", failMarker: "CHECK FAILED",
    candidates: [{ file: "app.go", line: guard }],
  } } });
  const run = invoke(dir, ["--root", dir, "--config", ".wish-sweep.json", "--receipt", receiptFile(dir), "--unit", "u-m3", "--head", HEAD, "--tree", TREE]);
  const receipt = JSON.parse(readFileSync(receiptFile(dir), "utf8"));
  expect(verdictOf(receipt, `mutation/app.go:${guard}`)).toBe("PASS");
  expect(receipt.rows.some((entry) => entry.id.startsWith("mutation/noncandidate/"))).toBe(false);
  expect(receipt.status).toBe("PASS");
  expect(run.exit).toBe(0);
}, 120000);

test("a line that opens a block comment and carries code after it is still code", () => {
  const dir = stage("clean");
  writeFileSync(join(dir, "app.js"), [
    "/* short */ export const kept = 1;",
    "export const plain = 2;",
    "",
  ].join("\n"));
  writeFileSync(join(dir, "check.js"), [
    'import { kept, plain } from "./app.js";',
    "let failures = 0;",
    "if (kept !== 1) failures += 1;",
    "if (failures > 0) { console.log(\"CHECK FAILED\"); process.exit(1); }",
    "",
  ].join("\n"));
  const appLines = readFileSync(join(dir, "app.js"), "utf8").split("\n");
  const keptLine = lineOf(dir, "app.js", "export const kept");
  writeConfig(dir, { probes: { mutation: {
    testCmd: "bun check.js", failMarker: "CHECK FAILED", max: 4,
    candidates: [{ file: "app.js", line: keptLine, text: appLines[keptLine - 1] }],
  } } });
  const run = invoke(dir, ["--root", dir, "--config", ".wish-sweep.json", "--receipt", receiptFile(dir), "--unit", "u-m3", "--head", HEAD, "--tree", TREE]);
  const receipt = JSON.parse(readFileSync(receiptFile(dir), "utf8"));
  // The line starts with a comment marker but carries real code, so it reaches the probe.
  // Deleting a whole declaration breaks the import, which the probe reports as INVALID
  // rather than a kill; the property under test is that the line is a candidate at all.
  expect(receipt.rows.some((entry) => entry.id === `mutation/app.js:${keptLine}`)).toBe(true);
  expect(receipt.rows.some((entry) => entry.id === "mutation" && entry.verdict === "SKIP")).toBe(false);
  expect(run.exit).toBe(0);
}, 120000);

test("a nested block comment stays comment in a language that nests it", () => {
  const dir = stage("clean");
  writeFileSync(join(dir, "source.rs"), [
    "/* outer",
    "/* inner */",
    "body still inside the outer comment",
    "*/",
    "fn real() {}",
    "",
  ].join("\n"));
  writeFileSync(join(dir, "wrap.rs"), [
    "/* outer",
    "/* inner */",
    "the old handler used new Error(error.message)",
    "*/",
    "fn real() {}",
    "",
  ].join("\n"));
  const body = 3;
  writeConfig(dir, { probes: {
    mutation: { testCmd: "true", failMarker: "CHECK FAILED", candidates: [{ file: "source.rs", line: body }] },
    errors: { strict: true, lines: [{ file: "wrap.rs", line: body }] },
  } });
  const run = invoke(dir, ["--root", dir, "--config", ".wish-sweep.json", "--receipt", receiptFile(dir), "--unit", "u-m3", "--head", HEAD, "--tree", TREE]);
  const receipt = JSON.parse(readFileSync(receiptFile(dir), "utf8"));
  expect(receipt.rows.some((entry) => entry.id === `mutation/source.rs:${body}`)).toBe(false);
  expect(receipt.rows.some((entry) => entry.id.startsWith("errors/"))).toBe(false);
  expect(verdictOf(receipt, "mutation")).toBe("SKIP");
  expect(verdictOf(receipt, "errors")).toBe("SKIP");
  expect(run.exit).toBe(0);
}, 120000);

test("a native compiler diagnostic marks the deletion a non-candidate", () => {
  const dir = stage("clean");
  writeFileSync(join(dir, "guard.c"), "int guard(int x) {\n  if (x > 0) return 1;\n  return 0;\n}\n");
  writeFileSync(join(dir, "main.c"), "#include <stdio.h>\nint guard(int x);\nint main(void) { if (guard(1) != 1) { printf(\"CHECK FAILED\\n\"); return 1; } return 0; }\n");
  writeFileSync(join(dir, "run.sh"), [
    "#!/bin/sh",
    "if ! cc -std=c99 -o prog guard.c main.c 2>build.log; then",
    "  cat build.log",
    "  exit 1",
    "fi",
    "./prog",
    "",
  ].join("\n"));
  const signature = lineOf(dir, "guard.c", "int guard(int x) {");
  writeConfig(dir, { probes: { mutation: { testCmd: "sh run.sh", failMarker: "CHECK FAILED", candidates: [{ file: "guard.c", line: signature }] } } });
  const run = invoke(dir, ["--root", dir, "--config", ".wish-sweep.json", "--receipt", receiptFile(dir), "--unit", "u-m3", "--head", HEAD, "--tree", TREE]);
  const receipt = JSON.parse(readFileSync(receiptFile(dir), "utf8"));
  // cc prints "guard.c:1:1: error: ..." — the default pattern must classify it.
  expect(verdictOf(receipt, "mutation/noncandidate/guard.c")).toBe("SKIP");
  expect(receipt.rows.some((entry) => entry.verdict === "INVALID")).toBe(false);
  expect(receipt.status).toBe("WARN");
  expect(run.exit).toBe(0);
}, 120000);

test("the error scan skips a comment line and still reports a real wrap site", () => {
  const dir = stage("clean");
  const cli = join(dir, "cli.js");
  writeFileSync(cli, `${readFileSync(cli, "utf8")}\n/*\nThe old handler used new Error(error.message) and lost the cause.\n*/\nfunction wrap(error) {\n  throw new Error(error.message);\n}\n`);
  const comment = lineOf(dir, "cli.js", "lost the cause");
  const site = lineOf(dir, "cli.js", "throw new Error(error.message)");
  writeConfig(dir, { probes: { errors: { strict: true, lines: [{ file: "cli.js", line: comment }, { file: "cli.js", line: site }] } } });
  const run = invoke(dir, ["--root", dir, "--config", ".wish-sweep.json", "--receipt", receiptFile(dir), "--unit", "u-m3", "--head", HEAD, "--tree", TREE]);
  const receipt = JSON.parse(readFileSync(receiptFile(dir), "utf8"));
  const rows = receipt.rows.filter((entry) => entry.id === "errors" || entry.id.startsWith("errors/"));
  expect(rows.map((entry) => entry.id)).toEqual([`errors/rewrapped-message:cli.js:${site}`]);
  expect(rows[0].verdict).toBe("FAIL");
  expect(run.exit).toBe(1);
}, 120000);

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

test("an unreadable base keeps the full doc set and every absent flag still fails", () => {
  const dir = stage("clean");
  const git = (...args) => Bun.spawnSync(["git", "-c", "user.name=sweep", "-c", "user.email=sweep@test", ...args], { cwd: dir });
  expect(git("init", "-q").exitCode).toBe(0);
  writeFileSync(join(dir, "usage.md"), "# cli\n\n`--dry-run` is an old documented flag.\n");
  expect(git("add", "-A").exitCode).toBe(0);
  expect(git("commit", "-q", "-m", "base").exitCode).toBe(0);
  // "no-such-ref" cannot be read, so the probe falls back to the full declared
  // doc set: the pre-existing flag FAILs instead of silently skipping, and the
  // run still exits 1 rather than passing on a state the probe cannot see.
  writeConfig(dir, { probes: { docs: { helpCmd: "bun cli.js --help", docs: ["usage.md"], base: "no-such-ref" } } });
  const out = join(dir, "out");
  const run = invoke(dir, ["--root", dir, "--config", ".wish-sweep.json", "--receipt", out, "--unit", "u-m3", "--probe", "docs"]);
  const head = Bun.spawnSync(["git", "-C", dir, "rev-parse", "HEAD"]).stdout.toString().trim();
  const receipt = JSON.parse(readFileSync(join(out, `verify_lane-docs-${head.slice(0, 7)}.json`), "utf8"));
  expect(verdictOf(receipt, "docs/--dry-run")).toBe("FAIL");
  expect(receipt.rows.find((entry) => entry.id === "docs") === undefined).toBe(true);
  expect(run.exit).toBe(1);
}, 120000);

test("a diff that only adds prose keeps the pre-existing flag on a warn and the run exits 0", () => {
  const dir = stage("clean");
  const git = (...args) => Bun.spawnSync(["git", "-c", "user.name=sweep", "-c", "user.email=sweep@test", ...args], { cwd: dir });
  expect(git("init", "-q").exitCode).toBe(0);
  const usageMd = join(dir, "usage.md");
  writeFileSync(usageMd, "# cli\n\n`--dry-run` is an old documented flag.\n");
  expect(git("add", "-A").exitCode).toBe(0);
  expect(git("commit", "-q", "-m", "base").exitCode).toBe(0);
  // The diff adds prose, no new flag: the pre-existing documented flag only
  // warns, and a WARN-only docs lane must not block the run.
  writeFileSync(usageMd, readFileSync(usageMd, "utf8") + "The flag prints the payload without sending.\n");
  expect(git("add", "-A").exitCode).toBe(0);
  expect(git("commit", "-q", "-m", "docs").exitCode).toBe(0);
  writeConfig(dir, { probes: { docs: { helpCmd: "bun cli.js --help", docs: ["usage.md"], base: "HEAD~1" } } });
  const out = join(dir, "out");
  const run = invoke(dir, ["--root", dir, "--config", ".wish-sweep.json", "--receipt", out, "--unit", "u-m3", "--probe", "docs"]);
  const head = Bun.spawnSync(["git", "-C", dir, "rev-parse", "HEAD"]).stdout.toString().trim();
  const receipt = JSON.parse(readFileSync(join(out, `verify_lane-docs-${head.slice(0, 7)}.json`), "utf8"));
  expect(verdictOf(receipt, "docs/--dry-run")).toBe("WARN");
  expect(receipt.status).toBe("WARN");
  expect(run.exit).toBe(0);
}, 120000);

test("a moved doc keeps its pre-existing flag on a warn, and a code comment is not a pre-existing flag", () => {
  const dir = stage("clean");
  const git = (...args) => Bun.spawnSync(["git", "-c", "user.name=sweep", "-c", "user.email=sweep@test", ...args], { cwd: dir });
  expect(git("init", "-q").exitCode).toBe(0);
  writeFileSync(join(dir, "usage.md"), "# cli\n\n`--dry-run` is an old documented flag.\n");
  // A code file that mentions the new flag in a comment is not documentation.
  writeFileSync(join(dir, "cli.js"), readFileSync(join(dir, "cli.js"), "utf8") + "// --brand-new is planned\n");
  expect(git("add", "-A").exitCode).toBe(0);
  expect(git("commit", "-q", "-m", "base").exitCode).toBe(0);
  // Move the doc and document the new flag in the moved file: the move keeps
  // the old flag on the WARN side, and the code comment never promotes the new
  // flag to pre-existing, so it still FAILs.
  expect(git("mv", "usage.md", "docs-usage.md").exitCode).toBe(0);
  writeFileSync(join(dir, "docs-usage.md"), "# cli\n\n`--dry-run` is an old documented flag. `--brand-new` is a new flag.\n");
  expect(git("add", "-A").exitCode).toBe(0);
  expect(git("commit", "-q", "-m", "docs").exitCode).toBe(0);
  writeConfig(dir, { probes: { docs: { helpCmd: "bun cli.js --help", docs: ["*.md"], base: "HEAD~1" } } });
  const out = join(dir, "out");
  const run = invoke(dir, ["--root", dir, "--config", ".wish-sweep.json", "--receipt", out, "--unit", "u-m3", "--probe", "docs"]);
  const head = Bun.spawnSync(["git", "-C", dir, "rev-parse", "HEAD"]).stdout.toString().trim();
  const receipt = JSON.parse(readFileSync(join(out, `verify_lane-docs-${head.slice(0, 7)}.json`), "utf8"));
  expect(verdictOf(receipt, "docs/--dry-run")).toBe("WARN");
  expect(verdictOf(receipt, "docs/--brand-new")).toBe("FAIL");
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

test("a git-quoted non-ASCII doc path is not misparsed into a silent skip", () => {
  const dir = stage("clean");
  const git = (...args) => Bun.spawnSync(["git", "-c", "user.name=sweep", "-c", "user.email=sweep@test", ...args], { cwd: dir });
  expect(git("init", "-q").exitCode).toBe(0);
  const docName = "docs-한글.md";
  writeFileSync(join(dir, docName), "# cli\n\n`--dry-run` is an old documented flag.\n");
  expect(git("add", "-A").exitCode).toBe(0);
  expect(git("commit", "-q", "-m", "base").exitCode).toBe(0);
  // The diff documents a new, unsupported flag in the non-ASCII-named doc: the
  // -z delimited diff must name that file (not a quoted string) so the probe
  // checks it instead of silently skipping it.
  writeFileSync(join(dir, docName), readFileSync(join(dir, docName), "utf8") + "`--brand-new` is a new flag.\n");
  expect(git("add", "-A").exitCode).toBe(0);
  expect(git("commit", "-q", "-m", "docs").exitCode).toBe(0);
  writeConfig(dir, { probes: { docs: { helpCmd: "bun cli.js --help", docs: ["*.md"], base: "HEAD~1" } } });
  const out = join(dir, "out");
  const run = invoke(dir, ["--root", dir, "--config", ".wish-sweep.json", "--receipt", out, "--unit", "u-m3", "--probe", "docs"]);
  const head = Bun.spawnSync(["git", "-C", dir, "rev-parse", "HEAD"]).stdout.toString().trim();
  const receipt = JSON.parse(readFileSync(join(out, `verify_lane-docs-${head.slice(0, 7)}.json`), "utf8"));
  expect(verdictOf(receipt, "docs/--brand-new")).toBe("FAIL");
  expect(verdictOf(receipt, "docs/--dry-run")).toBe("WARN");
  expect(run.exit).toBe(1);
}, 120000);

test("a nested sweep root under the git toplevel reads the changed docs relative to the root", () => {
  const dir = stage("clean");
  const git = (...args) => Bun.spawnSync(["git", "-c", "user.name=sweep", "-c", "user.email=sweep@test", ...args], { cwd: dir });
  expect(git("init", "-q").exitCode).toBe(0);
  expect(git("add", "-A").exitCode).toBe(0);
  expect(git("commit", "-q", "-m", "base").exitCode).toBe(0);
  const nested = join(dir, "nested");
  mkdirSync(nested, { recursive: true });
  writeFileSync(join(nested, "guide.md"), "# guide\n\n`--dry-run` is an old documented flag.\n");
  expect(git("add", "-A").exitCode).toBe(0);
  expect(git("commit", "-q", "-m", "guide").exitCode).toBe(0);
  writeFileSync(join(nested, "guide.md"), readFileSync(join(nested, "guide.md"), "utf8") + "`--brand-new` is a new flag.\n");
  expect(git("add", "-A").exitCode).toBe(0);
  expect(git("commit", "-q", "-m", "docs").exitCode).toBe(0);
  writeFileSync(join(nested, ".wish-sweep.json"), JSON.stringify({ probes: { docs: { helpCmd: "bun ../cli.js --help", docs: ["guide.md"], base: "HEAD~1" } } }, null, 2));
  const out = join(nested, "out");
  const run = invoke(nested, ["--root", nested, "--config", ".wish-sweep.json", "--receipt", out, "--unit", "u-m3", "--probe", "docs"]);
  const head = Bun.spawnSync(["git", "-C", nested, "rev-parse", "HEAD"]).stdout.toString().trim();
  const receipt = JSON.parse(readFileSync(join(out, `verify_lane-docs-${head.slice(0, 7)}.json`), "utf8"));
  expect(verdictOf(receipt, "docs/--brand-new")).toBe("FAIL");
  expect(verdictOf(receipt, "docs/--dry-run")).toBe("WARN");
  expect(run.exit).toBe(1);
}, 120000);

test("a diverged base compares the merge base, not the branch tip, for the pre-existing side", () => {
  const dir = stage("clean");
  const git = (...args) => Bun.spawnSync(["git", "-c", "user.name=sweep", "-c", "user.email=sweep@test", ...args], { cwd: dir });
  expect(git("init", "-q").exitCode).toBe(0);
  writeFileSync(join(dir, "usage.md"), "# cli\n\n`--dry-run` is an old documented flag.\n");
  expect(git("add", "-A").exitCode).toBe(0);
  expect(git("commit", "-q", "-m", "base").exitCode).toBe(0);
  expect(git("branch", "upstream").exitCode).toBe(0);
  // Upstream documents --upstream-flag after the fork: it is not part of the
  // reviewed diff and must not be blamed on it.
  expect(git("checkout", "-q", "upstream").exitCode).toBe(0);
  writeFileSync(join(dir, "usage.md"), "# cli\n\n`--dry-run` is an old documented flag. `--upstream-flag` is an upstream flag.\n");
  expect(git("add", "-A").exitCode).toBe(0);
  expect(git("commit", "-q", "-m", "upstream").exitCode).toBe(0);
  expect(git("checkout", "-q", "-b", "fork", "upstream~1").exitCode).toBe(0);
  // The fork documents its own new flag and also the flag upstream already
  // documented: the merge base documents neither of them.
  writeFileSync(join(dir, "usage.md"), "# cli\n\n`--dry-run` is an old documented flag. `--brand-new` is a new flag. `--upstream-flag` is an upstream flag.\n");
  expect(git("add", "-A").exitCode).toBe(0);
  expect(git("commit", "-q", "-m", "fork").exitCode).toBe(0);
  writeConfig(dir, { probes: { docs: { helpCmd: "bun cli.js --help", docs: ["usage.md"], base: "upstream" } } });
  const out = join(dir, "out");
  const run = invoke(dir, ["--root", dir, "--config", ".wish-sweep.json", "--receipt", out, "--unit", "u-m3", "--probe", "docs"]);
  const head = Bun.spawnSync(["git", "-C", dir, "rev-parse", "HEAD"]).stdout.toString().trim();
  const receipt = JSON.parse(readFileSync(join(out, `verify_lane-docs-${head.slice(0, 7)}.json`), "utf8"));
  // The fork's own new flag still fails: the change is blamed for it.
  expect(verdictOf(receipt, "docs/--brand-new")).toBe("FAIL");
  // --upstream-flag is documented at the upstream tip but not at the merge
  // base the diff actually compares against, so it still FAILs: a branch-tip
  // read would find it pre-existing and downgrade it to WARN, which is the
  // regression this test pins.
  expect(verdictOf(receipt, "docs/--upstream-flag")).toBe("FAIL");
  // The pre-existing flag is compared against the merge base, not the
  // diverged branch tip, so it stays on the WARN side.
  expect(verdictOf(receipt, "docs/--dry-run")).toBe("WARN");
  expect(run.exit).toBe(1);
}, 120000);

test("a changed doc outside the root never selects an unchanged file that shares its name", () => {
  const dir = stage("clean");
  const git = (...args) => Bun.spawnSync(["git", "-c", "user.name=sweep", "-c", "user.email=sweep@test", ...args], { cwd: dir });
  expect(git("init", "-q").exitCode).toBe(0);
  expect(git("add", "-A").exitCode).toBe(0);
  expect(git("commit", "-q", "-m", "base").exitCode).toBe(0);
  const nested = join(dir, "nested");
  mkdirSync(nested, { recursive: true });
  writeFileSync(join(nested, "guide.md"), "# guide\n\n`--dry-run` is an old documented flag.\n");
  expect(git("add", "-A").exitCode).toBe(0);
  expect(git("commit", "-q", "-m", "guide").exitCode).toBe(0);
  // The diff changes a doc that lives next to the nested root; it does not
  // touch the nested root's own doc, which must therefore not be judged.
  writeFileSync(join(dir, "guide.md"), "# top guide\n\n`--brand-new` is a new flag.\n");
  expect(git("add", "-A").exitCode).toBe(0);
  expect(git("commit", "-q", "-m", "docs").exitCode).toBe(0);
  writeFileSync(join(nested, ".wish-sweep.json"), JSON.stringify({ probes: { docs: { helpCmd: "bun ../cli.js --help", docs: ["guide.md"], base: "HEAD~1" } } }, null, 2));
  const out = join(nested, "out");
  const run = invoke(nested, ["--root", nested, "--config", ".wish-sweep.json", "--receipt", out, "--unit", "u-m3", "--probe", "docs"]);
  const head = Bun.spawnSync(["git", "-C", nested, "rev-parse", "HEAD"]).stdout.toString().trim();
  const receipt = JSON.parse(readFileSync(join(out, `verify_lane-docs-${head.slice(0, 7)}.json`), "utf8"));
  const skip = receipt.rows.find((entry) => entry.id === "docs");
  expect(skip?.verdict).toBe("SKIP");
  expect(skip?.note).toContain("changed no doc");
  expect(run.exit).toBe(0);
}, 120000);

test("a symlinked sweep root reads the changed docs exactly as the physical root does", () => {
  const dir = stage("clean");
  const git = (...args) => Bun.spawnSync(["git", "-c", "user.name=sweep", "-c", "user.email=sweep@test", ...args], { cwd: dir });
  expect(git("init", "-q").exitCode).toBe(0);
  const usageMd = join(dir, "usage.md");
  writeFileSync(usageMd, "# cli\n\n`--dry-run` is an old documented flag.\n");
  expect(git("add", "-A").exitCode).toBe(0);
  expect(git("commit", "-q", "-m", "base").exitCode).toBe(0);
  writeFileSync(usageMd, readFileSync(usageMd, "utf8") + "`--brand-new` is a new flag.\n");
  expect(git("add", "-A").exitCode).toBe(0);
  expect(git("commit", "-q", "-m", "docs").exitCode).toBe(0);
  // The same checkout through a symlink alias must not read as outside the
  // repository and fall back to the full set of FAILs.
  const link = join(dir, "..", `alias-${process.pid}`);
  expect(Bun.spawnSync(["ln", "-s", dir, link]).exitCode).toBe(0);
  try {
    writeConfig(link, { probes: { docs: { helpCmd: "bun cli.js --help", docs: ["usage.md"], base: "HEAD~1" } } });
    const out = join(link, "out");
    const run = invoke(link, ["--root", link, "--config", ".wish-sweep.json", "--receipt", out, "--unit", "u-m3", "--probe", "docs"]);
    const head = Bun.spawnSync(["git", "-C", link, "rev-parse", "HEAD"]).stdout.toString().trim();
    const receipt = JSON.parse(readFileSync(join(out, `verify_lane-docs-${head.slice(0, 7)}.json`), "utf8"));
    expect(verdictOf(receipt, "docs/--brand-new")).toBe("FAIL");
    expect(verdictOf(receipt, "docs/--dry-run")).toBe("WARN");
    expect(run.exit).toBe(1);
  } finally {
    rmSync(link, { force: true });
  }
}, 120000);

test("a diff.relative checkout keeps the toplevel-relative diff the probe needs", () => {
  const dir = stage("clean");
  const git = (...args) => Bun.spawnSync(["git", "-c", "user.name=sweep", "-c", "user.email=sweep@test", ...args], { cwd: dir });
  expect(git("init", "-q").exitCode).toBe(0);
  expect(git("add", "-A").exitCode).toBe(0);
  expect(git("commit", "-q", "-m", "base").exitCode).toBe(0);
  // The checkout's configuration makes git diff report paths relative to the
  // nested root; the probe must force the toplevel form back with
  // --no-relative, or the prefix filter would discard the changed doc and
  // the run would silently skip.
  expect(git("config", "diff.relative", "true").exitCode).toBe(0);
  const nested = join(dir, "nested");
  mkdirSync(nested, { recursive: true });
  writeFileSync(join(nested, "guide.md"), "# guide\n\n`--dry-run` is an old documented flag.\n");
  expect(git("add", "-A").exitCode).toBe(0);
  expect(git("commit", "-q", "-m", "guide").exitCode).toBe(0);
  writeFileSync(join(nested, "guide.md"), readFileSync(join(nested, "guide.md"), "utf8") + "`--brand-new` is a new flag.\n");
  expect(git("add", "-A").exitCode).toBe(0);
  expect(git("commit", "-q", "-m", "docs").exitCode).toBe(0);
  writeFileSync(join(nested, ".wish-sweep.json"), JSON.stringify({ probes: { docs: { helpCmd: "bun ../cli.js --help", docs: ["guide.md"], base: "HEAD~1" } } }, null, 2));
  const out = join(nested, "out");
  const run = invoke(nested, ["--root", nested, "--config", ".wish-sweep.json", "--receipt", out, "--unit", "u-m3", "--probe", "docs"]);
  const head = Bun.spawnSync(["git", "-C", nested, "rev-parse", "HEAD"]).stdout.toString().trim();
  const receipt = JSON.parse(readFileSync(join(out, `verify_lane-docs-${head.slice(0, 7)}.json`), "utf8"));
  expect(verdictOf(receipt, "docs/--brand-new")).toBe("FAIL");
  expect(verdictOf(receipt, "docs/--dry-run")).toBe("WARN");
  expect(run.exit).toBe(1);
}, 120000);

test("an unreadable base document forces the full doc set and drops every pre-existing exemption", () => {
  const dir = stage("clean");
  const git = (...args) => Bun.spawnSync(["git", "-c", "user.name=sweep", "-c", "user.email=sweep@test", ...args], { cwd: dir });
  expect(git("init", "-q").exitCode).toBe(0);
  const nested = join(dir, "nested");
  mkdirSync(nested, { recursive: true });
  writeFileSync(join(nested, "usage.md"), "# cli\n\n`--dry-run` is an old documented flag.\n");
  // The unchanged top-level doc documents a distinct flag, --unchanged-only,
  // that lives nowhere in the diff: only a full-set fallback can judge it.
  writeFileSync(join(dir, "usage.md"), "# cli\n\n`--dry-run` is an old documented flag. `--unchanged-only` is a top-level flag.\n");
  expect(git("add", "-A").exitCode).toBe(0);
  expect(git("commit", "-q", "-m", "base").exitCode).toBe(0);
  // The diff touches the nested doc and adds prose: with the base blob
  // intact the flag reads as pre-existing and the row stays a WARN. The next
  // fixture breaks that read: the diff read succeeds, but the base entry
  // cannot, so the probe must keep the full declared doc set and judge every
  // absent flag rather than half-know the pre-existing side.
  writeFileSync(join(nested, "usage.md"), readFileSync(join(nested, "usage.md"), "utf8") + "The flag prints the payload without sending.\n");
  expect(git("add", "-A").exitCode).toBe(0);
  expect(git("commit", "-q", "-m", "docs").exitCode).toBe(0);
  const nestedConfig = JSON.stringify({ probes: { docs: { helpCmd: "bun cli.js --help", docs: ["nested/usage.md", "usage.md"], base: "HEAD~1" } } }, null, 2);
  writeFileSync(join(dir, ".wish-sweep.json"), nestedConfig);
  // A working run: the pre-existing flag only warns and the run exits 0.
  const out = join(dir, "out");
  const runBefore = invoke(dir, ["--root", dir, "--config", ".wish-sweep.json", "--receipt", out, "--unit", "u-m3", "--probe", "docs"]);
  const headBefore = Bun.spawnSync(["git", "-C", dir, "rev-parse", "HEAD"]).stdout.toString().trim();
  const receiptBefore = JSON.parse(readFileSync(join(out, `verify_lane-docs-${headBefore.slice(0, 7)}.json`), "utf8"));
  expect(verdictOf(receiptBefore, "docs/--dry-run")).toBe("WARN");
  expect(runBefore.exit).toBe(0);
  // Break the base read: the merge base of base and HEAD is the commit
  // "docs", so rewrite that commit's tree to point the doc path at a
  // missing blob. The diff against HEAD~1 still lists the path, and the
  // base tree still names it, but `git show` at the base fails: exactly
  // the half-known state the probe must not treat as pre-existing. The
  // top-level doc also carries the flag, so a correct fallback must keep
  // it in the judged set and let the absent flag FAIL there too.
  const missingBlob = "1234567890abcdef1234567890abcdef12345678";
  const gitRepo = (args) => Bun.spawnSync(["git", "-c", "user.name=sweep", "-c", "user.email=sweep@test", ...args], { cwd: dir }).stdout.toString().trim();
  const docsCommit = gitRepo(["-C", dir, "rev-parse", "HEAD~1"]);
  const docsTree = gitRepo(["-C", dir, "rev-parse", "HEAD~1^{tree}"]);
  expect(docsTree.length).toBe(40);
  // The broken entry sits two levels deep (nested/usage.md), and mktree
  // builds one tree level at a time: replace the nested subtree's usage.md
  // entry with the missing blob, then rebuild the top-level tree around the
  // broken subtree.
  const nestedEntry = gitRepo(["-C", dir, "ls-tree", docsTree, "--", "nested"]).trim();
  const nestedSubTreeSha = nestedEntry.split("\t")[0].split(" ")[2];
  expect(nestedSubTreeSha.length).toBe(40);
  const nestedEntries = [];
  for (const line of gitRepo(["-C", dir, "ls-tree", nestedSubTreeSha]).split("\n")) {
    if (!line) continue;
    const [meta, name] = line.split("\t");
    if (name === "usage.md") {
      const [mode, type] = meta.split(" ");
      nestedEntries.push(`${mode} ${type} ${missingBlob}\t${name}`);
      continue;
    }
    nestedEntries.push(line);
  }
  const nestedEntriesFile = join(dir, ".mktree-nested");
  writeFileSync(nestedEntriesFile, nestedEntries.join("\n") + "\n");
  const brokenNestedTree = Bun.spawnSync(["sh", "-c", `git -C ${JSON.stringify(dir)} mktree --missing < ${JSON.stringify(nestedEntriesFile)}`]).stdout.toString().trim();
  expect(brokenNestedTree.length).toBe(40);
  const topEntries = [];
  for (const line of gitRepo(["-C", dir, "ls-tree", docsTree]).split("\n")) {
    if (!line) continue;
    const [meta, name] = line.split("\t");
    if (name === "nested") {
      topEntries.push(`040000 tree ${brokenNestedTree}\tnested`);
      continue;
    }
    topEntries.push(line);
  }
  const topEntriesFile = join(dir, ".mktree-top");
  writeFileSync(topEntriesFile, topEntries.join("\n") + "\n");
  const brokenTreeSha = Bun.spawnSync(["sh", "-c", `git -C ${JSON.stringify(dir)} mktree < ${JSON.stringify(topEntriesFile)}`]).stdout.toString().trim();
  expect(brokenTreeSha.length).toBe(40);
  // Membership proof: the broken tree lists the doc path through the broken
  // subtree, so the entry is not "new" even though the blob cannot be read.
  const brokenListing = gitRepo(["-C", dir, "ls-tree", brokenTreeSha, "--", "nested/usage.md"]);
  expect(brokenListing).toContain(missingBlob);
  expect(gitRepo(["-C", dir, "show", `${brokenTreeSha}:nested/usage.md`]).length).toBe(0);
  const headSha = gitRepo(["-C", dir, "rev-parse", "HEAD"]);
  const headTree = gitRepo(["-C", dir, "rev-parse", "HEAD^{tree}"]);
  const brokenDocsCommit = gitRepo(["-C", dir, "commit-tree", brokenTreeSha, "-m", "docs", "-p", docsCommit]);
  expect(brokenDocsCommit.length).toBe(40);
  const brokenHeadCommit = gitRepo(["-C", dir, "commit-tree", headTree, "-m", "broken", "-p", brokenDocsCommit]);
  expect(brokenHeadCommit.length).toBe(40);
  expect(git("update-ref", "HEAD", brokenHeadCommit).exitCode).toBe(0);
  rmSync(join(dir, ".mktree-nested"), { force: true });
  rmSync(join(dir, ".mktree-top"), { force: true });
  const runAfter = invoke(dir, ["--root", dir, "--config", ".wish-sweep.json", "--receipt", out, "--unit", "u-m3", "--probe", "docs"]);
  const headAfter = Bun.spawnSync(["git", "-C", dir, "rev-parse", "HEAD"]).stdout.toString().trim();
  const receiptAfter = JSON.parse(readFileSync(join(out, `verify_lane-docs-${headAfter.slice(0, 7)}.json`), "utf8"));
  const dryRun = receiptAfter.rows.find((entry) => entry.id === "docs/--dry-run");
  expect(dryRun?.verdict).toBe("FAIL");
  expect(dryRun?.note).not.toContain("pre-existing");
  // The fallback keeps the full declared doc set: a flag that exists only in
  // the unchanged top-level doc is judged too. The pre-fix probe judges the
  // changed file only, so this row does not exist before the fix and the
  // fixture fails on both the missing-blob and the old show-only reads.
  const unchangedOnly = receiptAfter.rows.find((entry) => entry.id === "docs/--unchanged-only");
  expect(unchangedOnly?.verdict).toBe("FAIL");
  expect(receiptAfter.rows.some((entry) => entry.id === "docs" && entry.verdict === "SKIP")).toBe(false);
  expect(runAfter.exit).toBe(1);
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
  // Thirteen code lines: a blank, an import or a comment line is not a candidate,
  // so a fixture that mixed them in would not prove the cap at all.
  const candidates = [7, 8, 12, 13, 14, 15, 16, 22, 23, 24, 25, 30, 31].map((line) => ({ file: "cli.js", line }));
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