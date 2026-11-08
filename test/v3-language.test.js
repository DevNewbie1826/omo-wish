import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

const ROOT = join(import.meta.dir, "..");

const GATED = [
  "skills/wish/SKILL.md",
  "README.md",
  "prompts",
  "skills/wish/references",
];

const MENU_LABEL = "prompts/wish.md";
const EXEMPT_FILES = [
  "skills/wish/references/dag-construction-ko.md",
  "skills/wish/references/verification-device.md",
];

const SENTINELS = [
  "skills/wish/SKILL.md",
  "README.md",
  MENU_LABEL,
  "skills/wish/references/dag-construction.md",
  ...EXEMPT_FILES,
];

const HANGUL = /[\uAC00-\uD7A3]/;

const HOME_ROOTS = ["tmp", "Volumes", "home", "Users", "root"];
const SCRATCH = new RegExp(`/(?:${HOME_ROOTS.join("|")})/[A-Za-z0-9._-]+`);
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

describe("language and scratch gate", () => {
  test("the gate walks the shipped prose tree and never the test tree", () => {
    for (const sentinel of SENTINELS) expect(FILES).toContain(sentinel);
    expect(FILES.some((file) => file.startsWith("test/"))).toBe(false);
    expect(FILES.length).toBeGreaterThanOrEqual(SENTINELS.length);
  });

  test("no Hangul ships outside the three named exemptions", () => {
    const offenders = FILES
      .filter((file) => file !== MENU_LABEL && !EXEMPT_FILES.includes(file))
      .flatMap((file) => numberedLines(file, (line) => HANGUL.test(line))
        .map(({ number }) => `${file}:${number}`));
    expect(offenders).toEqual([]);
  });

  test("the menu label is the only Hangul line in the entry prompt", () => {
    const lines = numberedLines(MENU_LABEL, (line) => HANGUL.test(line));
    expect(lines.length).toBeLessThanOrEqual(1);
    for (const { line } of lines) expect(line).toMatch(/^description: /);
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
