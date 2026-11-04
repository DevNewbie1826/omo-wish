import { afterAll, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, sep } from "node:path";
import { isPublicTool, shippedScripts, smokeScript } from "../scripts/verify.mjs";
import { repo, fixtures, removeFixtures } from "./wish-harness.js";

afterAll(removeFixtures);

function packageCopy() {
  const dir = mkdtempSync(join(tmpdir(), "wish-verify-"));
  fixtures.push(dir);
  for (const entry of ["package.json", "prompts", "extensions", "skills"]) {
    cpSync(join(repo, entry), join(dir, entry), { recursive: true });
  }
  return dir;
}

function verifyRun(root) {
  return spawnSync(process.execPath, [join(repo, "scripts/verify.mjs"), root], {
    cwd: root,
    encoding: "utf8",
    timeout: 120_000,
  });
}

function mjsFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return mjsFiles(path);
    return entry.name.endsWith(".mjs") ? [path] : [];
  });
}

test("verify.mjs discovers every shipped script and gives each one a usage line", () => {
  const scripts = shippedScripts(repo);
  const expected = mjsFiles(join(repo, "skills/wish/scripts")).sort();
  expect(scripts).toEqual(expected);
  const names = expected.map((file) => relative(join(repo, "skills/wish/scripts"), file).split(sep).join("/"));
  for (const tool of ["wish.mjs", "check-plan.mjs", "pr-watch.mjs"]) {
    expect(names).toContain(tool);
  }
  for (const file of scripts) {
    const row = smokeScript(repo, file);
    expect(row.rel.endsWith(".mjs")).toBe(true);
    if (isPublicTool(repo, file)) expect(row.bytes).toBeGreaterThan(0);
  }
}, 120_000);

test("verify.mjs passes on this repository through the real loader", () => {
  const result = verifyRun(repo);
  const output = `${result.stdout}${result.stderr}`;
  expect(output).toContain("ALL PASS");
  expect(result.status).toBe(0);
  expect(output.split("\n").filter((line) => line.startsWith("PASS --help exits 0: ")).length)
    .toBe(shippedScripts(repo).length);
}, 120_000);

test("verify.mjs fails and names a shipped script that does not answer --help", () => {
  const dir = packageCopy();
  writeFileSync(join(dir, "skills/wish/scripts/patch-id.mjs"), "process.exit(1);\n");
  const result = verifyRun(dir);
  const output = `${result.stdout}${result.stderr}`;
  expect(result.status).not.toBe(0);
  expect(output).toContain("skills/wish/scripts/patch-id.mjs --help failed");
}, 120_000);

test("verify.mjs fails when --help output is not a usage line", () => {
  const dir = packageCopy();
  writeFileSync(join(dir, "skills/wish/scripts/patch-id.mjs"),
    "#!/usr/bin/env node\n" +
    "if (process.argv.includes(\"--help\")) { console.log(\"BROKEN_HELP_SENTINEL\"); process.exit(0); }\n");
  const result = verifyRun(dir);
  const output = `${result.stdout}${result.stderr}`;
  expect(result.status).not.toBe(0);
  expect(output).toContain("skills/wish/scripts/patch-id.mjs --help printed no usage line");
}, 120_000);

test("verify.mjs fails and names a skill file the loader cannot find", () => {
  const dir = packageCopy();
  rmSync(join(dir, "skills/wish/SKILL.md"));
  const result = verifyRun(dir);
  const output = `${result.stdout}${result.stderr}`;
  expect(result.status).not.toBe(0);
  expect(output).toContain("skill file is missing");
  expect(output).toContain("skills/wish/SKILL.md");
}, 120_000);
