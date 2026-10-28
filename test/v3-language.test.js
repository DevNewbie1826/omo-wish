// wish v3 - unit u6: the language and scratch gate, as a repository test.
//
// The gate scans the shipped prose tree and the shipped entry files. It names
// exactly three exemptions, so a future edit either fits one of them or fails:
//   1. the single menu-label line in `prompts/wish.md` (the plugin menu text);
//   2. the CJK line-breaking example block inside `skills/wish/references/prompts.md`,
//      which is a verbatim mirror of omo's visual-QA conditions. Only that block
//      is exempt; the rest of the file is scanned like any other prose;
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

// Exemption 1, and the exempt block inside exemption 2, named once and reused.
const MENU_LABEL = "prompts/wish.md";
const CJK_MIRROR = "skills/wish/references/prompts.md";

// Only the visual-QA line-breaking example block of the mirror file is exempt,
// not its prose: the block opens at its own heading and closes at the first
// blank line, so Hangul anywhere else in the same file still fails.
const MIRROR_HEADING = "4. CJK precision:";
const MIRROR_MAX_LINES = 16;

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
// The exemption is the URL token itself, never the whole line that carries it,
// so a path elsewhere on that line is still scanned.
const REPOSITORY_URL = /https?:\/\/[^\s`'"()<>]*github\.com\/[^\s`'"()<>]*/g;

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
    .filter(({ line, number }) => predicate(line, number));
}

function withoutRepositoryUrls(line) {
  return line.replace(REPOSITORY_URL, " ");
}

let mirrorNumbers = null;

function mirrorLineNumbers() {
  if (mirrorNumbers) return mirrorNumbers;
  const lines = textOf(CJK_MIRROR).split("\n");
  const start = lines.findIndex((line) => line.trim() === MIRROR_HEADING);
  expect(start).toBeGreaterThanOrEqual(0);
  const stop = lines.findIndex((line, index) => index > start
    && (line.trim() === "" || index - start > MIRROR_MAX_LINES));
  expect(stop).toBeGreaterThan(start + 1);
  mirrorNumbers = new Set();
  for (let index = start; index < stop; index += 1) mirrorNumbers.add(index + 1);
  return mirrorNumbers;
}

describe("language and scratch gate", () => {
  test("the gate walks the shipped tree and never the test tree", () => {
    for (const sentinel of SENTINELS) expect(FILES).toContain(sentinel);
    expect(FILES.some((file) => file.startsWith("test/"))).toBe(false);
    expect(FILES.length).toBeGreaterThan(SENTINELS.length);
  });

  test("no Hangul ships outside the two named exemptions", () => {
    const mirror = mirrorLineNumbers();
    const offenders = FILES
      .filter((file) => file !== MENU_LABEL)
      .flatMap((file) => numberedLines(file, (line, number) => HANGUL.test(line)
        && !(file === CJK_MIRROR && mirror.has(number)))
        .map(({ number }) => `${file}:${number}`));
    expect(offenders).toEqual([]);
  });

  test("the menu label is the only Hangul line in the entry prompt", () => {
    const lines = numberedLines(MENU_LABEL, (line) => HANGUL.test(line));
    expect(lines.length).toBeLessThanOrEqual(1);
    for (const { line } of lines) expect(line).toMatch(/^description: /);
  });

  test("the CJK mirror is exempt because it carries the non-ASCII examples", () => {
    const mirror = mirrorLineNumbers();
    expect(numberedLines(CJK_MIRROR, (line, number) => HANGUL.test(line) && mirror.has(number))
      .length).toBeGreaterThan(0);
  });

  test("the URL exemption covers the URL and not the rest of its line", () => {
    const url = ["https:", "", ["github", "com"].join("."), "example", "example"].join("/");
    const scratch = ["", "tmp", "review-proof"].join("/");
    expect(SCRATCH.test(scratch)).toBe(true);
    expect(SCRATCH.test(withoutRepositoryUrls(`git clone ${url} ${scratch}`))).toBe(true);
    expect(SCRATCH.test(withoutRepositoryUrls(`git clone ${url}`))).toBe(false);
  });

  test("no author scratch path ships in the gated tree", () => {
    const offenders = FILES
      .flatMap((file) => numberedLines(file, (line) => SCRATCH.test(withoutRepositoryUrls(line)))
        .map(({ number, line }) => `${file}:${number}:${line.trim()}`));
    expect(offenders).toEqual([]);
  });
});