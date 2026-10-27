#!/usr/bin/env node
// Classify a PR diff for the wish final-review route (SKILL.md step 9).
// Zero dependencies; run with bun or node.

import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

export const TABLE_VERSION = "c6-2026-10-27";

const TEST_DIRS = new Set([
  "test", "tests", "__tests__", "__mocks__", "__snapshots__", "__fixtures__",
  "spec", "specs", "testdata", "e2e",
]);
const DOC_DIRS = new Set(["docs", "doc", "documentation"]);
const DOC_ROOT_BASENAME = /^(README|CHANGELOG|CHANGES|CONTRIBUTING|CODE_OF_CONDUCT|SECURITY|AUTHORS|NOTICE|LICENSE|COPYING)(\..*)?$/i;
const TEST_BASENAME = [
  /\.test\.[^./]+$/i,
  /\.spec\.[^./]+$/i,
  /_test\.[^./]+$/i,
  /_spec\.[^./]+$/i,
  /\.snap$/i,
  /^test_.*\.py$/i,
  /.*_test\.py$/i,
  /.*Tests?\.(java|kt|scala)$/i,
  /.*Tests?\.cs$/i,
  /.*_test\.go$/i,
];
const CI_PREFIXES = [
  ".github/workflows/",
  ".github/actions/",
  ".circleci/",
  ".buildkite/",
  ".gitlab/",
  ".azure-pipelines/",
  "ci/",
  ".ci/",
];
const CI_BASENAME = [
  /^Jenkinsfile(\..*)?$/,
  /^\.gitlab-ci\.ya?ml$/,
  /^\.travis\.ya?ml$/,
  /^azure-pipelines\.ya?ml$/i,
  /^appveyor\.ya?ml$/i,
  /^\.drone\.ya?ml$/,
  /^bitbucket-pipelines\.ya?ml$/,
  /^\.github\/dependabot\.ya?ml$/i,
  /^renovate\.json5?$/i,
  /^\.renovaterc(\.json)?$/i,
];

function normalizePath(path) {
  return String(path ?? "").replace(/\\/g, "/").replace(/^\.?\//, "").replace(/\/+$/, "");
}

function normalizeRoots(roots) {
  return (roots ?? []).map(normalizePath).filter(Boolean);
}

function underRoot(path, roots) {
  return roots.some((root) => path === root || path.startsWith(`${root}/`));
}

export function classifyPath(path, { productRoots = [] } = {}) {
  const p = normalizePath(path);
  if (!p) return "production";
  if (underRoot(p, normalizeRoots(productRoots))) return "production";
  const parts = p.split("/");
  const base = parts.at(-1);
  const dirs = parts.slice(0, -1);

  if (dirs.some((dir) => TEST_DIRS.has(dir)) || TEST_BASENAME.some((re) => re.test(base))) {
    return "test";
  }
  if (CI_PREFIXES.some((prefix) => p.startsWith(prefix)) || CI_BASENAME.some((re) => re.test(p))) {
    return "ci";
  }
  if (dirs.some((dir) => DOC_DIRS.has(dir))) return "docs";
  if (parts.length === 1 && DOC_ROOT_BASENAME.test(base)) return "docs";
  return "production";
}

// rows: [{ status, paths: [string, ...] }] (a rename has two paths).
export function classifyRows(rows, options = {}) {
  return rows.map((row) => {
    const files = row.paths.map((path) => ({ path, cls: classifyPath(path, options) }));
    const cls = files.some((file) => file.cls === "production") ? "production" : files[0].cls;
    return { status: row.status, files, cls };
  });
}

export function decideRoute(rows, options = {}) {
  if (rows.length === 0) {
    return {
      tableVersion: TABLE_VERSION,
      route: "ultrabrain",
      reason: "empty diff",
      counts: { test: 0, docs: 0, ci: 0, production: 0 },
    };
  }
  const classified = classifyRows(rows, options);
  const paths = classified.flatMap((row) => row.files);
  const counts = { test: 0, docs: 0, ci: 0, production: 0 };
  for (const file of paths) counts[file.cls] += 1;
  if (counts.production > 0) {
    return {
      tableVersion: TABLE_VERSION,
      route: "ultrabrain",
      reason: `${counts.production} production path(s)`,
      counts,
      rows: classified,
    };
  }
  return {
    tableVersion: TABLE_VERSION,
    route: "code-reviewer",
    reason: `every changed path is test, docs, or CI (test ${counts.test}, docs ${counts.docs}, ci ${counts.ci})`,
    counts,
    rows: classified,
  };
}

export function parseNameStatusZ(text) {
  const tokens = text.split("\0").filter((token) => token.length > 0);
  const rows = [];
  for (let i = 0; i < tokens.length; i += 1) {
    const status = tokens[i];
    const kind = status[0];
    if (kind === "R" || kind === "C") {
      rows.push({ status, paths: [tokens[i + 1], tokens[i + 2]] });
      i += 2;
    } else {
      rows.push({ status, paths: [tokens[i + 1]] });
      i += 1;
    }
  }
  return rows;
}

export function formatReport(result) {
  const lines = [
    `REVIEW ROUTE: ${result.route}`,
    `table version: ${result.tableVersion}`,
    `reason: ${result.reason}`,
  ];
  if (result.rows) {
    lines.push("files:");
    for (const row of result.rows) {
      const label = row.files.map((file) => file.path).join(" -> ");
      lines.push(`  ${row.status} ${label} -> ${row.cls}`);
    }
  }
  return lines.join("\n");
}

function usage() {
  return "usage: review-route.mjs --base <rev> [--head <rev>] [--repo <dir>] [--product-root <dir>]... [--json]";
}

function parseArgs(argv) {
  const options = { base: undefined, head: "HEAD", repo: ".", productRoots: [], json: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--json") {
      options.json = true;
    } else if (arg === "--base" || arg === "--head" || arg === "--repo" || arg === "--product-root") {
      const value = argv[i + 1];
      if (value === undefined) throw new Error(`${arg} needs a value`);
      i += 1;
      if (arg === "--base") options.base = value;
      else if (arg === "--head") options.head = value;
      else if (arg === "--repo") options.repo = value;
      else options.productRoots.push(...value.split(",").map((entry) => entry.trim()).filter(Boolean));
    } else if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }
  return options;
}

export function main(argv) {
  let options;
  try {
    options = parseArgs(argv);
    if (options.help) {
      console.log(usage());
      return 0;
    }
    if (!options.base) throw new Error("--base is required");
    const diff = execFileSync(
      "git",
      ["-C", options.repo, "diff", "--name-status", "-z", "--find-renames", "--diff-filter=ACDMRTUXB", `${options.base}...${options.head}`],
      { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
    );
    const result = decideRoute(parseNameStatusZ(diff), { productRoots: options.productRoots });
    if (options.json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log(formatReport(result));
    }
    return 0;
  } catch (error) {
    console.error(`review-route: ${error.message}`);
    console.error(usage());
    return 2;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  process.exitCode = main(process.argv.slice(2));
}