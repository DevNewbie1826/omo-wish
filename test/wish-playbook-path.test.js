import { expect, test } from "bun:test";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const skill = resolve(import.meta.dir, "../skills/wish");
const playbooks = readdirSync(join(skill, "playbooks"))
  .filter((name) => name.endsWith(".md"))
  .map((name) => ({ name, text: readFileSync(join(skill, "playbooks", name), "utf8") }));

test("playbooks never locate wish scripts under the task worktree", () => {
  expect(playbooks.filter(({ text }) => text.includes("$WT/skills/wish")).map(({ name }) => name)).toEqual([]);
});

test("each playbook wish function runs outside a repository", () => {
  const definitions = playbooks.flatMap(({ name, text }) => {
    const definition = text.match(/^wish\(\) \{.*\}$/m)?.[0];
    return definition ? [{ name, definition }] : [];
  });
  expect(definitions).toHaveLength(6);
  const cwd = mkdtempSync(join(tmpdir(), "wish-playbook-"));
  try {
    for (const { name, definition } of definitions) {
      const result = spawnSync("sh", ["-c", `${definition}\nwish --help`], {
        cwd,
        env: { ...process.env, SKILL: skill, WT: cwd },
        encoding: "utf8",
      });
      expect({ name, status: result.status, stderr: result.stderr }).toEqual({ name, status: 0, stderr: "" });
    }
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
