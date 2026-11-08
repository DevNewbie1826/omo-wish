import { afterAll, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { referencedFiles } from "../scripts/verify.mjs";
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

test("verify.mjs passes on this repository through the real loader", () => {
  const result = verifyRun(repo);
  const output = `${result.stdout}${result.stderr}`;
  expect(output).toContain("ALL PASS");
  expect(result.status).toBe(0);
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

test("verify.mjs fails and names a reference file the skill names but does not ship", () => {
  const dir = packageCopy();
  const [reference] = referencedFiles(join(dir, "skills/wish/SKILL.md"));
  expect(reference).toBeDefined();
  rmSync(join(dir, "skills/wish", reference));
  const result = verifyRun(dir);
  const output = `${result.stdout}${result.stderr}`;
  expect(result.status).not.toBe(0);
  expect(output).toContain("reference file is missing");
  expect(output).toContain(reference);
}, 120_000);
