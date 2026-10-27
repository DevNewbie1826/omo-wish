import { afterAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const script = join(repo, "skills/wish/scripts/check-verdict.mjs");
const fixture = mkdtempSync(join(tmpdir(), "wish-verdict-test-"));

const HEAD = "4749822" + "0".repeat(33);
const OTHER = "1".repeat(40);

afterAll(() => {
  rmSync(fixture, { recursive: true, force: true });
});

function run(args, scriptPath = script) {
  const result = spawnSync(process.execPath, [scriptPath, ...args], { encoding: "utf8" });
  return { code: result.status, stdout: result.stdout, stderr: result.stderr };
}

function bodyFile(name, text) {
  const path = join(fixture, name);
  writeFileSync(path, text);
  return path;
}

function body(verdict = "APPROVED", round = 4, head = HEAD) {
  return `Axes: state none; boundary none; tests none.\nVERDICT: ${verdict} round ${round} head ${head}\n`;
}

describe("check-verdict CLI", () => {
  test("a verdict that covers the head passes", () => {
    const result = run(["--body", bodyFile("pass.md", body()), "--head", HEAD]);
    expect(result.code).toBe(0);
    expect(result.stdout).toStartWith("PASS");
    expect(result.stdout).toContain(HEAD);
    expect(result.stderr).toBe("");
  });

  test("verdict drift fails with the M0 reason", () => {
    const result = run(["--body", bodyFile("drift.md", body()), "--head", OTHER]);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain(`verdict head ${HEAD} does not cover current head ${OTHER}`);
  });

  test("require-approved turns a REVISE into a failure and accepts an APPROVED", () => {
    const revise = run(["--body", bodyFile("revise.md", body("REVISE")), "--head", HEAD, "--require-approved"]);
    expect(revise.code).toBe(1);
    expect(revise.stderr).toContain("verdict is REVISE, not APPROVED");
    const approved = run(["--body", bodyFile("approved.md", body()), "--head", HEAD, "--require-approved"]);
    expect(approved.code).toBe(0);
  });

  test("the last non-empty line decides, and CRLF bodies normalize", () => {
    const text = `VERDICT: REVISE round 3 head ${OTHER}\r\n\r\nVERDICT: APPROVED round 4 head ${HEAD}\r\n\r\n`;
    const result = run(["--body", bodyFile("last.md", text), "--head", HEAD]);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("APPROVED round 4");
  });

  test("an empty body, a malformed last line and a seven-character head all fail", () => {
    const empty = run(["--body", bodyFile("empty.md", ""), "--head", HEAD]);
    expect(empty.code).toBe(1);
    expect(empty.stderr).toContain("body is empty");
    const malformed = run(["--body", bodyFile("malformed.md", "looks fine\nVERDICT: APPROVED round 0 head abc\n"), "--head", HEAD]);
    expect(malformed.code).toBe(1);
    expect(malformed.stderr).toContain("last non-empty line is not a verdict line");
    const short = run(["--body", bodyFile("short.md", body()), "--head", HEAD.slice(0, 7)]);
    expect(short.code).toBe(1);
    expect(short.stderr).toContain("current head is not a full 40-hex SHA");
  });

  test("usage mistakes exit 2, never 1", () => {
    expect(run(["--body", bodyFile("usage.md", body())]).code).toBe(2);
    expect(run(["--head", HEAD]).code).toBe(2);
    expect(run(["--body", join(fixture, "missing.md"), "--head", HEAD]).code).toBe(2);
    expect(run(["--body", "--head", HEAD]).code).toBe(2);
    expect(run(["--body", bodyFile("x.md", body()), "--head", HEAD, "--bogus"]).code).toBe(2);
  });

  test("--help exits 0 and prints the usage line", () => {
    const result = run(["--help"]);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("usage: check-verdict.mjs --body <file> --head <full-40-hex-sha>");
  });

  test("the script runs through a symlinked skill directory", () => {
    const shadow = join(fixture, "shadow");
    mkdirSync(shadow, { recursive: true });
    const link = join(shadow, "wish");
    symlinkSync(join(repo, "skills/wish"), link, "dir");
    const linked = join(link, "scripts/check-verdict.mjs");
    const result = run(["--body", bodyFile("symlink.md", body()), "--head", HEAD], linked);
    expect(result.code).toBe(0);
    expect(result.stdout).toStartWith("PASS");
  });

  test("the contract's own verdict example passes the parser", () => {
    const example = `Axes: state none; boundary one note; tests none; docs none.\nVERDICT: APPROVED round 4 head ${HEAD}`;
    const result = run(["--body", bodyFile("example.md", example), "--head", HEAD]);
    expect(result.code).toBe(0);
  });
});