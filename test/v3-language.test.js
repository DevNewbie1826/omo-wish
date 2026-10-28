// wish v3 - unit u6: the language and scratch gate, as a repository test.
//
// The gate scans the shipped prose tree and the shipped entry files. It names
// exactly three exemptions, so a future edit either fits one of them or fails:
//   1. the single menu-label line in `prompts/wish.md` (the plugin menu text);
//   2. all of `skills/wish/references/prompts.md`, whose CJK line-breaking
//      examples are a verbatim mirror of omo's visual-QA conditions;
//   3. `test/` is never walked: its fixtures carry deliberately non-ASCII paths
//      as a robustness case, and they are not shipped prose.
// Both patterns are written generically: this file names no author and no
// author's path.

import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

const ROOT = join(import.meta.dir, "..");

// The gate's scope. `test/` is absent by construction, not filtered out later.
const GATED = [
  "skills/wish/SKILL.md",
  "README.md",
  "prompts",
  "skills/wish/playbooks",
  "skills/wish/references",
  "skills/wish/scripts",
];

// Exemption 1 and exemption 2, named once and reused by every assertion.
const MENU_LABEL = "prompts/wish.md";
const CJK_MIRROR = "skills/wish/references/prompts.md";

// Files the gate must reach, so an empty walk cannot pass vacuously.
const SENTINELS = [
  "skills/wish/SKILL.md",
  "README.md",
  MENU_LABEL,
  CJK_MIRROR,
  "skills/wish/references/plan-format.md",
  "skills/wish/playbooks/code.md",
  "skills/wish/scripts/wish.mjs",
];

// The Hangul block of the Unicode planes; written as escapes so this file
// itself carries no non-ASCII prose.
const HANGUL = /[\uAC00-\uD7A3]/;

// Author scratch roots, assembled from parts so the test ships no author path:
// a home directory, the shared temporary directory, and the mounted volumes.
const HOME_ROOTS = ["tmp", "Volumes", "home", "Users", "root"];
const SCRATCH = new RegExp(`/(?:${HOME_ROOTS.join("|")})/[A-Za-z0-9._-]+`);
// The repository URL from the install instructions is the product's address.
const REPOSITORY_URL = /github\.com/;

function collect() {
  const found = [];
  const walk = (entry) => {
    const full = join(ROOT, entry);
    const info = statSync(full);
    if (info.isDirectory()) {
      for (const name of readdirSync(full)) walk(join(entry, name));
      return;
    }
    found.push(relative(ROOT, full).split(sep).join("/"));
  };
  for (const entry of GATED) walk(entry);
  return found.sort();
}

const FILES = collect();

function textOf(file) {
  return readFileSync(join(ROOT, file), "utf8");
}

function numberedLines(file, predicate) {
  return textOf(file).split("\n")
    .map((line, index) => ({ number: index + 1, line }))
    .filter(({ line }) => predicate(line));
}

describe("language and scratch gate", () => {
  test("the gate walks the shipped tree and never the test tree", () => {
    for (const sentinel of SENTINELS) expect(FILES).toContain(sentinel);
    expect(FILES.some((file) => file.startsWith("test/"))).toBe(false);
    expect(FILES.length).toBeGreaterThan(SENTINELS.length);
  });

  test("no Hangul ships outside the two named exemptions", () => {
    const offenders = FILES
      .filter((file) => file !== CJK_MIRROR && file !== MENU_LABEL)
      .flatMap((file) => numberedLines(file, (line) => HANGUL.test(line))
        .map(({ number }) => `${file}:${number}`));
    expect(offenders).toEqual([]);
  });

  test("the menu label is the only Hangul line in the entry prompt", () => {
    const lines = numberedLines(MENU_LABEL, (line) => HANGUL.test(line));
    expect(lines.length).toBeLessThanOrEqual(1);
    for (const { line } of lines) expect(line).toMatch(/^description: /);
  });

  test("the CJK mirror is exempt because it carries the non-ASCII examples", () => {
    expect(numberedLines(CJK_MIRROR, (line) => HANGUL.test(line)).length).toBeGreaterThan(0);
  });

  test("no author scratch path ships in the gated tree", () => {
    const offenders = FILES
      .flatMap((file) => numberedLines(file, (line) => SCRATCH.test(line) && !REPOSITORY_URL.test(line))
        .map(({ number, line }) => `${file}:${number}:${line.trim()}`));
    expect(offenders).toEqual([]);
  });
});