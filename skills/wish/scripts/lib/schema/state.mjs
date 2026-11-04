import { T, isObj, isStr, fail, rejectUnknown, RUN_ID, HEX40, HEX64, GATE_ID } from "./primitives.mjs";
import { PROGRESS_PATTERN, PRIMARY_TYPES, DEVICE_PATTERN_SOURCES } from "./constants.mjs";
import { STATUS_SPEC, FRONT_MATTER_SPEC } from "./specs.mjs";
export function validateStatusJson(value) {
  const errors = [];
  T.obj(STATUS_SPEC)(value, "status", errors);
  rejectUnknown(value, Object.keys(STATUS_SPEC), "status", errors);
  if (isObj(value) && isStr(value.run_id) && !RUN_ID.test(value.run_id)) {
    fail(errors, "status.run_id", "expected w-<slug>-<yyyymmdd>-<hhmm>");
  }
  if (isObj(value) && isObj(value.progress)) {
    const p = value.progress;
    if (p.units_done > p.units_total) fail(errors, "status.progress.units_done", "exceeds units_total");
    if (p.gaps_total !== null && p.gaps_fixed > p.gaps_total) fail(errors, "status.progress.gaps_fixed", "exceeds gaps_total");
  }
  return { ok: errors.length === 0, errors };
}

export function validatePlanFrontMatter(value) {
  const errors = [];
  if (!isObj(value) || !isObj(value.wish)) {
    return { ok: false, errors: [{ path: "frontmatter.wish", message: "expected a wish: object" }] };
  }
  T.obj(FRONT_MATTER_SPEC)(value.wish, "frontmatter.wish", errors);
  rejectUnknown(value.wish, Object.keys(FRONT_MATTER_SPEC), "frontmatter.wish", errors);
  if (!errors.length) {
    if (!RUN_ID.test(value.wish.run_id)) fail(errors, "frontmatter.wish.run_id", "expected w-<slug>-<yyyymmdd>-<hhmm>");
    if (!/^(\/|[A-Za-z]:[\\/])/.test(value.wish.worktree)) fail(errors, "frontmatter.wish.worktree", "expected an absolute path");
    if (value.wish.frozen_head !== null && !(HEX40.test(value.wish.frozen_head) || HEX64.test(value.wish.frozen_head))) {
      fail(errors, "frontmatter.wish.frozen_head", "expected null, a 40-hex commit or a 64-hex artifact sha256");
    }
    if (value.wish.type === "mixed" && value.wish.unit === null) {
      fail(errors, "frontmatter.wish.unit", "a mixed plan names its unit");
    }
  }
  return { ok: errors.length === 0, errors };
}

export function parseProgressLine(line) {
  const match = PROGRESS_PATTERN.exec(String(line ?? ""));
  if (!match) return { ok: false, errors: [{ path: "progress", message: "does not match PROGRESS_PATTERN_SOURCE" }] };
  const [run_id, units_done, units_total] = [match[1], match[2], match[3]];
  const gaps = match[4] === undefined ? null : { fixed: Number(match[4]), total: Number(match[5]) };
  const value = {
    run_id,
    units_done: Number(units_done),
    units_total: Number(units_total),
    gaps_fixed: gaps ? gaps.fixed : null,
    gaps_total: gaps ? gaps.total : null,
    prs_merged: Number(match[6]),
    prs_open: Number(match[7]),
    wave_k: Number(match[8]),
    wave_n: Number(match[9]),
    round: Number(match[10]),
    pr: match[11] === "none" ? null : match[11],
    switch: Number(match[12]),
    waiting: match[13],
  };
  const errors = [];
  if (value.units_done > value.units_total) errors.push({ path: "units_done", message: "exceeds units_total" });
  if (gaps && gaps.fixed > gaps.total) errors.push({ path: "gaps_fixed", message: "exceeds gaps_total" });
  if (value.wave_k < 1 || value.wave_k > value.wave_n) errors.push({ path: "wave_k", message: "expected 1 <= k <= n" });
  return { ok: errors.length === 0, value, errors };
}

export function formatProgressLine(value) {
  const gaps = value.gaps_total === null || value.gaps_total === undefined
    ? "n/a"
    : `${value.gaps_fixed}/${value.gaps_total}`;
  return `PROGRESS: run ${value.run_id} · units ${value.units_done}/${value.units_total} · gaps ${gaps} · ` +
    `prs ${value.prs_merged} merged ${value.prs_open} open · wave ${value.wave_k}/${value.wave_n} · ` +
    `round r${value.round} on ${value.pr ?? "none"} · switch ${value.switch} · waiting ${value.waiting}`;
}

export function parseGatesMarkdown(text) {
  const errors = [];
  const raw = String(text ?? "").replace(/\r/g, "").trim();
  const prefix = "# Gates\n\n## ";
  if (raw === "") return { ok: true, gates: [], errors };
  if (!raw.startsWith(prefix)) return { ok: false, gates: [], errors: [{ path: "gates", message: "expected a # Gates heading" }] };
  const gates = [];
  const ids = new Set();
  raw.slice(prefix.length).split("\n\n## ").forEach((block, index) => {
    const lines = block.split("\n").filter((line) => line !== "");
    const id = lines.shift() ?? "";
    const fields = new Map();
    for (const line of lines) {
      const match = /^- ([^:]+): (.*)$/.exec(line);
      if (!match) return fail(errors, `gate[${index}]`, "malformed field line");
      fields.set(match[1], match[2]);
    }
    if (!id) fail(errors, `gate[${index}]`, "missing id");
    else if (!GATE_ID.test(id)) fail(errors, `gate[${index}]`, "id must match [A-Za-z0-9][A-Za-z0-9_-]*");
    if (ids.has(id)) fail(errors, `gate[${index}]`, `duplicate id ${id}`);
    ids.add(id);
    for (const key of fields.keys()) {
      if (!["Status", "Question", "Options", "Default", "Answer"].includes(key)) {
        fail(errors, `gate[${index}]`, `unknown field ${key}`);
      }
    }
    const status = fields.get("Status");
    const question = fields.get("Question");
    const options = fields.get("Options");
    const fallback = fields.get("Default");
    if (question === undefined || options === undefined || fallback === undefined) {
      return fail(errors, `gate[${index}]`, "Question, Options and Default are required");
    }
    const choices = options.split(" | ");
    if (choices.length < 2) fail(errors, `gate[${index}].options`, "at least two choices");
    if (!choices.includes(fallback)) fail(errors, `gate[${index}].default`, "must be one of the options");
    if (status === "open") {
      if (fields.has("Answer")) fail(errors, `gate[${index}]`, "an open gate has no answer");
      gates.push({ id, status, question, options, default: fallback });
    } else if (status === "resolved" && fields.has("Answer")) {
      gates.push({ id, status, question, options, default: fallback, answer: fields.get("Answer") });
    } else {
      fail(errors, `gate[${index}].status`, "expected open, or resolved with an answer");
    }
  });
  return { ok: errors.length === 0, gates, errors };
}

export function validateDeviceRow(type, value) {
  const errors = [];
  if (!PRIMARY_TYPES.includes(type)) return { ok: false, errors: [{ path: "device.type", message: "expected a concrete work type" }] };
  if (!isStr(value)) return { ok: false, errors: [{ path: "device", message: "expected a non-empty DEVICE row" }] };
  const body = value.startsWith("DEVICE: ") ? value.slice(8) : value;
  const form = DEVICE_PATTERN_SOURCES[type].find((pattern) => pattern.test(body));
  if (!form) fail(errors, "device", `does not match the ${type} device grammar in A §B4`);
  return { ok: errors.length === 0, form: form ? form.source : null, errors };
}
