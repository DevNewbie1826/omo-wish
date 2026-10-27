import { afterAll, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { checkCoverage, parseVerdict } from "../skills/wish/scripts/check-verdict.mjs";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const script = join(repo, "skills/wish/scripts/check-verdict.mjs");
const fixture = mkdtempSync(join(tmpdir(), "wish-verdict-"));

const HEAD = "4749822" + "0".repeat(33);
const OTHER = "1111111" + "1".repeat(33);

afterAll(() => {
  rmSync(fixture, { recursive: true, force: true });
});

function runWith(bin, scriptPath, args) {
  const result = spawnSync(bin, [scriptPath, ...args], { encoding: "utf8" });
  return {
    code: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

function run(args) {
  return runWith(process.execPath, script, args);
}

function bodyFile(name, body) {
  const path = join(fixture, name);
  writeFileSync(path, body);
  return path;
}

test("parses the last non-empty verdict line and ignores CRLF", () => {
  const body = `notes\r\nVERDICT: REVISE round 1 head ${OTHER}\r\nmore notes\r\nVERDICT: APPROVED round 2 head ${HEAD}\r\n\r\n`;
  expect(parseVerdict(body)).toMatchObject({
    ok: true,
    verdict: "APPROVED",
    round: 2,
    head: HEAD,
  });
});

test("rejects a missing or malformed verdict line", () => {
  for (const body of [
    "",
    "   \n\t\n",
    "no verdict here",
    `VERDICT: APPROVED round 0 head ${HEAD}`,
    `VERDICT: MAYBE round 1 head ${HEAD}`,
    `VERDICT: APPROVED round 1 head ${HEAD.slice(0, 7)}`,
    `VERDICT: APPROVED round 1 head ${HEAD} trailing`,
    `VERDICT: APPROVED round 1 head ${HEAD}\nfooter`,
  ]) {
    expect(parseVerdict(body).ok).toBe(false);
  }
  expect(checkCoverage({ body: "no verdict here", head: HEAD }).ok).toBe(false);
  expect(checkCoverage({ body: `VERDICT: APPROVED round 0 head ${HEAD}`, head: HEAD }).ok).toBe(false);
});

test("checks exact full-SHA head coverage", () => {
  const body = `VERDICT: APPROVED round 1 head ${HEAD}`;
  expect(checkCoverage({ body, head: HEAD }).ok).toBe(true);
  expect(checkCoverage({ body, head: HEAD.toUpperCase() }).ok).toBe(true);
  expect(checkCoverage({ body, head: OTHER }).ok).toBe(false);
  expect(checkCoverage({ body, head: HEAD.slice(0, 7) }).ok).toBe(false);
  expect(checkCoverage({ body, head: "" }).ok).toBe(false);
});

test("require-approved accepts APPROVED and rejects REVISE", () => {
  const approved = `VERDICT: APPROVED round 1 head ${HEAD}`;
  const revise = `VERDICT: REVISE round 1 head ${HEAD}`;
  expect(checkCoverage({ body: approved, head: HEAD, requireApproved: true }).ok).toBe(true);
  expect(checkCoverage({ body: revise, head: HEAD }).ok).toBe(true);
  expect(checkCoverage({ body: revise, head: HEAD, requireApproved: true }).ok).toBe(false);
});

test("CLI exits 0 on coverage and 1 on drift", () => {
  const path = bodyFile("match.md", `notes\nVERDICT: APPROVED round 1 head ${HEAD}\n`);
  const match = run(["--body", path, "--head", HEAD]);
  expect(match.code).toBe(0);
  expect(match.stdout.trim().startsWith("PASS")).toBe(true);
  expect(match.stdout).toContain("covers current head");

  const drift = run(["--body", path, "--head", OTHER]);
  expect(drift.code).toBe(1);
  expect(drift.stderr.trim().startsWith("FAIL")).toBe(true);
  expect(drift.stderr).toContain("does not cover");
});

test("CLI merge gate rejects a REVISE verdict", () => {
  const path = bodyFile("revise.md", `VERDICT: REVISE round 1 head ${HEAD}\n`);
  const result = run(["--body", path, "--head", HEAD, "--require-approved"]);
  expect(result.code).toBe(1);
  expect(result.stderr).toContain("not APPROVED");
});

test("CLI uses the last verdict line, not the first", () => {
  const path = bodyFile(
    "two.md",
    `VERDICT: REVISE round 1 head ${OTHER}\nnotes\nVERDICT: APPROVED round 2 head ${HEAD}\n`,
  );
  expect(run(["--body", path, "--head", HEAD]).code).toBe(0);
  expect(run(["--body", path, "--head", OTHER]).code).toBe(1);
});

test("CLI rejects missing or unknown arguments with a usage failure", () => {
  for (const args of [[], ["--body"], ["--body", "x"], ["--head", HEAD], ["--pr", "1"], ["--unknown"]]) {
    const result = run(args);
    expect(result.code).toBe(2);
    expect(result.stderr).toContain("FAIL");
  }
  expect(run([]).stderr).toContain("usage:");
  expect(run(["--body", "x"]).stderr).toContain("usage:");
  expect(run(["--pr", "1"]).stderr).toContain("unknown argument");
});

test("CLI still runs through a symlinked skill directory under node", () => {
  const linkRoot = join(fixture, "link-root");
  mkdirSync(linkRoot, { recursive: true });
  const link = join(linkRoot, "wish-skill");
  symlinkSync(join(repo, "skills/wish"), link, "dir");
  const linkedScript = join(link, "scripts/check-verdict.mjs");
  const path = bodyFile("symlink-body.md", `VERDICT: APPROVED round 1 head ${HEAD}\n`);

  const match = runWith("node", linkedScript, ["--body", path, "--head", HEAD]);
  expect(match.code).toBe(0);
  expect(match.stdout.trim().startsWith("PASS")).toBe(true);

  const drift = runWith("node", linkedScript, ["--body", path, "--head", OTHER]);
  expect(drift.code).toBe(1);
  expect(drift.stderr).toContain("does not cover");
});