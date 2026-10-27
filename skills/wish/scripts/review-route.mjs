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
const DOC_DIR_PREFIXES = ["docs/", "doc/", "documentation/"];
const DOC_EXTENSIONS = new Set([".md", ".mdx", ".markdown", ".rst", ".adoc", ".txt"]);
const DOC_ROOT_NAME = /^(README|CHANGELOG|CHANGES|CONTRIBUTING|CODE_OF_CONDUCT|SECURITY|AUTHORS|NOTICE|LICENSE|COPYING)(\..*)?$/;
const CODE_EXTENSIONS = new Set([
  ".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs", ".mts", ".cts", ".py", ".rb",
  ".go", ".java", ".kt", ".kts", ".cs", ".scala", ".php", ".swift", ".vue", ".svelte",
]);
const TEST_BASENAME_ANY = [
  /\.test\.[^./]+$/,
  /\.snap$/,
];
const TEST_BASENAME_CODE = [
  /\.spec\.[^./]+$/,
  /_spec\.[^./]+$/,
  /_test\.[^./]+$/,
];
const TEST_SPECIAL = [
  /^test_.*\.py$/,
  /Tests?\.(java|kt|kts|scala|cs)$/,
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
  /^azure-pipelines\.ya?ml$/,
  /^appveyor\.ya?ml$/,
  /^\.drone\.ya?ml$/,
  /^bitbucket-pipelines\.ya?ml$/,
  /^renovate\.json5?$/,
  /^\.renovaterc(\.json)?$/,
];
const CI_FULL_PATH = [
  /^\.github\/dependabot\.ya?ml$/,
];

function normalizePath(path) {
  return String(path ?? "").replace(/\\/g, "/").replace(/^\.?\//, "").replace(/\/+$/, "");
}

function normalizeRoots(roots) {
  return (roots ?? []).map((root) => {
    const normalized = normalizePath(root);
    return normalized === "" || normalized === "." ? "*" : normalized;
  }).filter(Boolean);
}

function underRoot(path, roots) {
  return roots.some((root) => root === "*" || path === root || path.startsWith(`${root}/`));
}

function extensionOf(base) {
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(dot).toLowerCase() : "";
}

function isTestBase(base) {
  if (TEST_BASENAME_ANY.some((re) => re.test(base))) return true;
  const ext = extensionOf(base);
  if (CODE_EXTENSIONS.has(ext) && TEST_BASENAME_CODE.some((re) => re.test(base))) return true;
  return TEST_SPECIAL.some((re) => re.test(base));
}

function isRootDoc(base) {
  if (!DOC_ROOT_NAME.test(base)) return false;
  const ext = extensionOf(base);
  return ext === "" || DOC_EXTENSIONS.has(ext.toLowerCase());
}

export function classifyPath(path, { productRoots = [] } = {}) {
  const p = normalizePath(path);
  if (!p) return "production";
  if (underRoot(p, normalizeRoots(productRoots))) return "production";
  const parts = p.split("/");
  const base = parts.at(-1);
  const dirs = parts.slice(0, -1);

  if (dirs.some((dir) => TEST_DIRS.has(dir)) || isTestBase(base)) return "test";
  if (CI_PREFIXES.some((prefix) => p.startsWith(prefix)) || CI_FULL_PATH.some((re) => re.test(p)) || CI_BASENAME.some((re) => re.test(base))) {
    return "ci";
  }
  if (DOC_DIR_PREFIXES.some((prefix) => p.startsWith(prefix))) return "docs";
  if (parts.length === 1 && isRootDoc(base)) return "docs";
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
    if (options.base.startsWith("-") || options.head.startsWith("-")) {
      throw new Error("a revision must not start with '-'");
    }
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