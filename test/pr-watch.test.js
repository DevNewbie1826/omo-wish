import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import {
  backoffSeconds, classifyPr, defaultSleep, formatLine, main, observation, parseArgs,
  redactSecrets, tokenValues, watch, GH_FIELDS,
} from "../skills/wish/scripts/pr-watch.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const script = resolve(here, "../skills/wish/scripts/pr-watch.mjs");
const HEAD = "0123456789abcdef0123456789abcdef01234567";
const dirs = [];

function tempDir() {
  const dir = mkdtempSync(join(tmpdir(), "wish-pr-watch-"));
  dirs.push(dir);
  return dir;
}

afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

function view(overrides = {}) {
  return {
    number: 7, state: "OPEN", isDraft: false, mergeable: "MERGEABLE",
    mergeStateStatus: "CLEAN", reviewDecision: "", statusCheckRollup: [], headRefOid: HEAD,
    ...overrides,
  };
}

function run(args, env = {}, cwd = here) {
  return new Promise((resolvePromise) => {
    const child = spawn("bun", [script, ...args], { cwd, env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("close", (code) => resolvePromise({ code, stdout, stderr }));
  });
}

function fakeGh(dir, name, body) {
  const path = join(dir, name);
  writeFileSync(path, `#!/bin/sh\n${body}\n`);
  chmodSync(path, 0o755);
  return path;
}

describe("classifyPr", () => {
  test("a merged PR is MERGED regardless of its stale merge fields", () => {
    const result = classifyPr(view({ state: "MERGED", mergeable: "UNKNOWN", mergeStateStatus: "UNKNOWN" }));
    expect(result.state).toBe("MERGED");
    expect(result.reasons).toEqual(["merged"]);
  });

  test("a closed PR is CLOSED, not a blocker", () => {
    expect(classifyPr(view({ state: "CLOSED" })).state).toBe("CLOSED");
  });

  test("a draft waits", () => {
    expect(classifyPr(view({ isDraft: true }))).toMatchObject({ state: "WAITING", reasons: ["draft"] });
  });

  test("a conflicting PR is BLOCKED for conflict", () => {
    expect(classifyPr(view({ mergeable: "CONFLICTING" }))).toMatchObject({ state: "BLOCKED", reasons: ["conflict"] });
    expect(classifyPr(view({ mergeStateStatus: "DIRTY" })).reasons).toEqual(["conflict"]);
  });

  test("a failed check blocks and a pending check waits, with the counts reported", () => {
    const failed = classifyPr(view({
      statusCheckRollup: [
        { __typename: "CheckRun", name: "tests", status: "COMPLETED", conclusion: "FAILURE" },
        { __typename: "StatusContext", context: "lint", state: "SUCCESS" },
      ],
    }));
    expect(failed).toMatchObject({ state: "BLOCKED", reasons: ["checks-failing"], checks: { total: 2, failing: 1, pending: 0 } });
    const pending = classifyPr(view({ statusCheckRollup: [{ name: "tests", status: "IN_PROGRESS" }] }));
    expect(pending).toMatchObject({ state: "WAITING", reasons: ["checks-pending"], checks: { total: 1, failing: 0, pending: 1 } });
  });

  test("skipped and neutral checks do not block", () => {
    const result = classifyPr(view({
      statusCheckRollup: [
        { status: "COMPLETED", conclusion: "SKIPPED" },
        { state: "NEUTRAL" },
      ],
    }));
    expect(result.state).toBe("READY");
  });

  test("changes requested blocks, review required waits", () => {
    expect(classifyPr(view({ reviewDecision: "CHANGES_REQUESTED" }))).toMatchObject({ state: "BLOCKED", reasons: ["changes-requested"] });
    expect(classifyPr(view({ reviewDecision: "REVIEW_REQUIRED" }))).toMatchObject({ state: "WAITING", reasons: ["review-required"] });
  });

  test("an unknown check shape, an unreadable rollup and an unknown merge state never read READY", () => {
    expect(classifyPr(view({ statusCheckRollup: [{ name: "mystery" }] })).state).toBe("WAITING");
    expect(classifyPr(view({ statusCheckRollup: { unexpected: true } })).reasons).toEqual(["checks-pending"]);
    expect(classifyPr(view({ mergeStateStatus: "UNKNOWN" })).reasons).toEqual(["merge-state-unknown"]);
    expect(classifyPr(view({ mergeStateStatus: "" })).state).toBe("WAITING");
  });

  test("an OPEN PR with no blocker is READY, and gh reporting BLOCKED is a blocker", () => {
    expect(classifyPr(view())).toMatchObject({ state: "READY", reasons: ["ready"], head: HEAD });
    expect(classifyPr(view({ mergeStateStatus: "BLOCKED" }))).toMatchObject({ state: "BLOCKED", reasons: ["blocked"] });
  });

  test("a missing or unknown PR state is never a pass", () => {
    expect(classifyPr(null).reasons).toEqual(["query-failed"]);
    expect(classifyPr(view({ state: "WEIRD" }))).toMatchObject({ state: "BLOCKED", reasons: ["unknown-state"] });
  });
});

describe("backoffSeconds", () => {
  test("doubles from the base and stops at the cap", () => {
    expect(backoffSeconds(60, 1)).toBe(60);
    expect(backoffSeconds(60, 2)).toBe(120);
    expect(backoffSeconds(60, 3)).toBe(240);
    expect(backoffSeconds(60, 4)).toBe(300);
    expect(backoffSeconds(60, 12)).toBe(300);
    expect(backoffSeconds(120, 1)).toBe(120);
    expect(backoffSeconds(1, 1)).toBe(60);
    expect(backoffSeconds(120, 1, 90)).toBe(90);
    expect(backoffSeconds(60, 1, 45)).toBe(60);
    expect(backoffSeconds(Number.NaN, 0)).toBe(60);
  });
});

describe("redactSecrets", () => {
  test("replaces a literal token value and a gh token pattern", () => {
    const secrets = tokenValues({ GH_TOKEN: "canary-value-1234", GITHUB_TOKEN: "" }, "GH_TOKEN,GITHUB_TOKEN");
    expect(secrets).toEqual(["canary-value-1234"]);
    const text = redactSecrets(`auth failed for canary-value-1234 and gho_${"a".repeat(24)}`, secrets);
    expect(text).not.toContain("canary-value-1234");
    expect(text).not.toContain("gho_");
    expect(text).toContain("[redacted]");
  });

  test("an empty token value is never redacted, a short one still is", () => {
    const secrets = tokenValues({ GH_TOKEN: "" }, "GH_TOKEN");
    expect(secrets).toEqual([]);
    expect(redactSecrets("nothing secret here", secrets)).toBe("nothing secret here");
    const short = tokenValues({ GH_TOKEN: "abc" }, "GH_TOKEN");
    expect(redactSecrets("token=abc", short)).toBe("token=[redacted]");
  });
});

describe("parseArgs", () => {
  test("accepts the documented flags", () => {
    const parsed = parseArgs(["--pr", "7", "--repo", "owner/name", "--interval", "90", "--max-interval", "240", "--max-failures", "2", "--until", "ready", "--once", "--all"]);
    expect(parsed.ok).toBe(true);
    expect(parsed.options).toMatchObject({ pr: 7, repo: "owner/name", interval: 90, maxInterval: 240, maxFailures: 2, until: "ready", once: true, all: true });
  });

  test("rejects a repo string that could be a shell payload and a missing pr", () => {
    const injected = parseArgs(["--pr", "1", "--repo", "evil;touch /tmp/pwn"]);
    expect(injected.ok).toBe(false);
    expect(injected.errors.join(" ")).toContain("owner/name");
    const missing = parseArgs(["--repo", "owner/name"]);
    expect(missing.ok).toBe(false);
    const badUntil = parseArgs(["--pr", "1", "--repo", "owner/name", "--until", "soon"]);
    expect(badUntil.ok).toBe(false);
    const unknown = parseArgs(["--pr", "1", "--repo", "owner/name", "--shell", "sh"]);
    expect(unknown.ok).toBe(false);
  });

  test("--help short-circuits the required flags", () => {
    expect(parseArgs(["--help"]).options.help).toBe(true);
  });
});

describe("watch", () => {
  function harness(views, { options = {}, failing = [], fatal = null } = {}) {
    const emitted = [];
    const waits = [];
    let index = 0;
    const query = async () => {
      if (fatal) return { ok: false, fatal: true, error: fatal };
      if (failing.length > 0) return { ok: false, error: failing.shift() };
      const next = views[Math.min(index, views.length - 1)];
      index += 1;
      return { ok: true, view: next };
    };
    const code = watch({
      query,
      emit: (record) => emitted.push(record),
      now: () => "2026-10-27T17:00:00.000Z",
      sleep: async (ms) => { waits.push(ms); },
      options: {
        pr: 7, repo: "owner/name", interval: 60, maxInterval: 300, maxFailures: 3,
        until: "merged", all: false, once: false, ...options,
      },
    });
    return { emitted, waits, code };
  }

  test("polls with the backoff schedule and resets it after a state change", async () => {
    const waiting = view({ statusCheckRollup: [{ status: "IN_PROGRESS" }] });
    const blocked = view({ mergeable: "CONFLICTING" });
    const merged = view({ state: "MERGED" });
    const { emitted, waits, code } = harness([waiting, waiting, waiting, blocked, merged]);
    expect(await code).toBe(0);
    expect(emitted.map((record) => record.state)).toEqual(["WAITING", "BLOCKED", "MERGED"]);
    expect(emitted.map((record) => record.next_poll_s)).toEqual([60, 60, null]);
    expect(waits).toEqual([60000, 120000, 240000, 60000]);
    expect(emitted.every((record) => record.error === null)).toBe(true);
  });

  test("grows the wait while nothing changes and stops at the cap", async () => {
    const waiting = view({ statusCheckRollup: [{ status: "IN_PROGRESS" }] });
    const { emitted, waits, code } = harness([waiting, waiting, waiting, waiting, view({ state: "MERGED" })], { options: { all: true } });
    await code;
    expect(emitted.map((record) => record.next_poll_s)).toEqual([60, 120, 240, 300, null]);
    expect(waits).toEqual([60000, 120000, 240000, 300000]);
  });

  test("--all prints every poll and dedupes nothing", async () => {
    const waiting = view({ statusCheckRollup: [{ status: "IN_PROGRESS" }] });
    const { emitted, code } = harness([waiting, waiting, view({ state: "MERGED" })], { options: { all: true } });
    await code;
    expect(emitted.map((record) => record.state)).toEqual(["WAITING", "WAITING", "MERGED"]);
  });

  test("--until ready returns at READY; a merge under --until ready is not the requested state", async () => {
    const readyHarness = harness([view({})], { options: { until: "ready" } });
    expect(await readyHarness.code).toBe(0);
    const mergedHarness = harness([view({ state: "MERGED" })], { options: { until: "ready" } });
    expect(await mergedHarness.code).toBe(1);
  });

  test("a closed PR exits 1 and a query failure retries then exits 1 with one deduped line", async () => {
    const closed = harness([view({ state: "CLOSED" })]);
    expect(await closed.code).toBe(1);
    const failing = harness([], { failing: ["boom", "boom", "boom"] });
    expect(await failing.code).toBe(1);
    expect(failing.emitted.length).toBe(2);
    expect(failing.emitted[0]).toMatchObject({ state: "BLOCKED", reasons: ["query-failed"], error: "boom", next_poll_s: 60 });
    expect(failing.emitted[1]).toMatchObject({ state: "BLOCKED", error: "boom", next_poll_s: null });
  });

  test("--once reports a failed poll once and exits 1 without retrying", async () => {
    const once = harness([], { failing: ["boom"], options: { once: true } });
    expect(await once.code).toBe(1);
    expect(once.emitted.length).toBe(1);
    expect(once.emitted[0]).toMatchObject({ state: "BLOCKED", reasons: ["query-failed"], next_poll_s: null, error: "boom" });
    expect(once.waits).toEqual([]);
  });

  test("a fatal query failure stops at once with exit 3", async () => {
    const fatal = harness([], { fatal: "Could not resolve to a PullRequest" });
    expect(await fatal.code).toBe(3);
    expect(fatal.emitted[0]).toMatchObject({ state: "BLOCKED", reasons: ["query-failed"], next_poll_s: null });
    expect(fatal.waits).toEqual([]);
  });

  test("--once returns after one observation without waiting", async () => {
    const once = harness([view({ statusCheckRollup: [{ status: "IN_PROGRESS" }] })], { options: { once: true } });
    expect(await once.code).toBe(0);
    expect(once.waits).toEqual([]);
    expect(once.emitted.length).toBe(1);
  });

  test("an abort before the first poll throws AbortError and emits nothing", async () => {
    const controller = new AbortController();
    controller.abort();
    const emitted = [];
    await expect(watch({
      query: async () => ({ ok: true, view: view() }),
      emit: (record) => emitted.push(record),
      options: { pr: 7, repo: "owner/name", interval: 60, maxInterval: 300, maxFailures: 3, until: "merged", all: false, once: false },
      signal: controller.signal,
    })).rejects.toMatchObject({ name: "AbortError" });
    expect(emitted).toEqual([]);
  });

  test("defaultSleep rejects with AbortError on an aborted signal", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(defaultSleep(1000, controller.signal)).rejects.toMatchObject({ name: "AbortError" });
  });
});

describe("observation and NDJSON", () => {
  test("a line is one parseable JSON object with the documented keys", () => {
    const line = formatLine(observation({
      seq: 1, at: "2026-10-27T17:00:00.000Z", pr: 7, repo: "owner/name",
      classification: classifyPr(view({ mergeable: "CONFLICTING" })), nextPollS: 60, error: null,
    }));
    expect(line.endsWith("\n")).toBe(true);
    expect(line.trimEnd().includes("\n")).toBe(false);
    const parsed = JSON.parse(line);
    expect(Object.keys(parsed).sort()).toEqual(["at", "checks", "error", "head", "next_poll_s", "pr", "reasons", "repo", "seq", "state"]);
    expect(parsed).toMatchObject({ seq: 1, pr: 7, state: "BLOCKED", reasons: ["conflict"], next_poll_s: 60, error: null });
  });
});

describe("CLI", () => {
  test("--help exits 0 and documents every flag", async () => {
    const result = await run(["--help"]);
    expect(result.code).toBe(0);
    for (const flag of ["--until", "--once", "--all", "--interval", "--max-interval", "--max-failures"]) {
      expect(result.stdout).toContain(flag);
    }
    expect(result.stdout).toContain(GH_FIELDS.split(",")[0]);
  });

  test("an end-to-end poll emits one JSON line and exits by the PR state", async () => {
    const dir = tempDir();
    const gh = fakeGh(dir, "gh-merged.sh", `printf '%s\\n' '{"number":40,"state":"MERGED","isDraft":false,"mergeable":"UNKNOWN","mergeStateStatus":"UNKNOWN","reviewDecision":"","statusCheckRollup":[],"headRefOid":"${HEAD}"}'`);
    const result = await run(["--pr", "40", "--repo", "owner/name", "--gh", gh, "--once", "--all"]);
    expect(result.code).toBe(0);
    const lines = result.stdout.trimEnd().split("\n");
    expect(lines.length).toBe(1);
    expect(JSON.parse(lines[0])).toMatchObject({ pr: 40, repo: "owner/name", state: "MERGED", reasons: ["merged"] });
  });

  test("a gh failure redacts the token the child printed, and an empty token stays untouched", async () => {
    const dir = tempDir();
    const canary = "canary-secret-9931";
    const gh = fakeGh(dir, "gh-fail.sh", `printf 'request failed token=%s\\n' "$GH_TOKEN" 1>&2\nexit 1`);
    const raw = await new Promise((resolvePromise) => {
      const child = spawn(gh, [], { env: { ...process.env, GH_TOKEN: canary }, stdio: ["ignore", "pipe", "pipe"] });
      let stderr = "";
      child.stderr.on("data", (chunk) => { stderr += chunk; });
      child.on("close", () => resolvePromise(stderr));
    });
    expect(raw).toContain(canary);
    const result = await run(["--pr", "1", "--repo", "owner/name", "--gh", gh, "--max-failures", "1"], { GH_TOKEN: canary });
    expect(result.code).toBe(1);
    expect(result.stdout).toContain("[redacted]");
    expect(result.stdout).not.toContain(canary);
    expect(result.stderr).not.toContain(canary);
    const empty = await run(["--pr", "1", "--repo", "owner/name", "--gh", gh, "--max-failures", "1"], { GH_TOKEN: "" });
    expect(empty.code).toBe(1);
    expect(empty.stdout).toContain("token=");
    expect(empty.stdout).not.toContain("[redacted]");
    expect(empty.stderr).not.toContain("[redacted]");
  });

  test("an unexpected gh shape is a failed poll, never an endless loop", async () => {
    const dir = tempDir();
    const array = fakeGh(dir, "gh-array.sh", "printf '%s\\n' '[]'");
    const result = await run(["--pr", "7", "--repo", "owner/name", "--gh", array, "--max-failures", "1"]);
    expect(result.code).toBe(1);
    expect(JSON.parse(result.stdout.trim())).toMatchObject({ state: "BLOCKED", reasons: ["query-failed"], next_poll_s: null });
    expect(result.stdout).toContain("unexpected shape");
    const empty = fakeGh(dir, "gh-empty.sh", "printf ''");
    const emptyResult = await run(["--pr", "7", "--repo", "owner/name", "--gh", empty, "--max-failures", "1"]);
    expect(emptyResult.code).toBe(1);
    expect(emptyResult.stdout).toContain("malformed JSON");
  });

  test("a usage error never echoes a token and a poll line redacts an observation field", async () => {
    const canary = "canary-usage-4417";
    const usage = await run(["--pr", "1", "--repo", "owner/name", "--bogus", canary], { GH_TOKEN: canary });
    expect(usage.code).toBe(2);
    expect(usage.stderr).not.toContain(canary);
    expect(usage.stderr).toContain("[redacted]");
    const dir = tempDir();
    const gh = fakeGh(dir, "gh-token-head.sh", `printf '%s\\n' '{"number":1,"state":"OPEN","isDraft":false,"mergeable":"MERGEABLE","mergeStateStatus":"CLEAN","reviewDecision":"","statusCheckRollup":[],"headRefOid":"ghp_${"a".repeat(24)}"}'`);
    const observed = await run(["--pr", "1", "--repo", "owner/name", "--gh", gh, "--once"]);
    expect(observed.code).toBe(0);
    expect(observed.stdout).toContain("[redacted]");
    expect(observed.stdout).not.toContain("ghp_");
  });

  test("the last --token-env wins and even a whitespace token is redacted", async () => {
    const canary = "second-name-canary-7781";
    const result = await run(["--pr", "1", "--repo", "owner/name", "--token-env", "GH_TOKEN", "--token-env", "OTHER_TOKEN", "--bogus", canary], { OTHER_TOKEN: canary });
    expect(result.code).toBe(2);
    expect(result.stderr).not.toContain(canary);
    const dir = tempDir();
    const spaced = await run(["--pr", "1", "--repo", "owner/name", "--bogus", " \t "], { GH_TOKEN: " \t " });
    expect(spaced.code).toBe(2);
    expect(spaced.stderr).toContain("[redacted]");
    expect(spaced.stderr).not.toContain(" \t ");
  });

  test("a token that equals a field name still leaves a readable record", async () => {
    const dir = tempDir();
    const gh = fakeGh(dir, "gh-merged2.sh", `printf '%s\\n' '{"number":40,"state":"MERGED","isDraft":false,"mergeable":"UNKNOWN","mergeStateStatus":"UNKNOWN","reviewDecision":"","statusCheckRollup":[],"headRefOid":"${HEAD}"}'`);
    const result = await run(["--pr", "40", "--repo", "owner/name", "--gh", gh, "--once"], { GH_TOKEN: "pr" });
    expect(result.code).toBe(0);
    const parsed = JSON.parse(result.stdout.trim());
    expect(parsed.pr).toBe(40);
    expect(parsed.state).toBe("MERGED");
  });

  test("a shell-looking repo value exits 2 and creates nothing", async () => {
    const dir = tempDir();
    const marker = join(dir, "pwned");
    const result = await run(["--pr", "1", "--repo", `evil;touch ${marker}`, "--once"]);
    expect(result.code).toBe(2);
    expect(existsSync(marker)).toBe(false);
  });
});