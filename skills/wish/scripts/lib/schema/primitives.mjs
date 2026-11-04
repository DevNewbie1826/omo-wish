export const isStr = (v) => typeof v === "string" && v.length > 0;
export const isInt = (v, min) => Number.isInteger(v) && v >= min;
export const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
export const KEBAB = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const HEX7 = /^[0-9a-f]{7}$/;
export const HEX40 = /^[0-9a-f]{40}$/;
export const HEX64 = /^[0-9a-f]{64}$/;
export const HEX = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
export const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;
export const GAP = /^G[1-9][0-9]*$/;
export const ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
export const RULE_ID = /^[a-z][a-z0-9._-]*$/;
export const GATE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;
export const COUNT = /^(0|[1-9][0-9]*)$/;
export const SESSION = /^senpi:.+$/;
export const RUN_ID = /^w-[a-z0-9]+(?:-[a-z0-9]+)*-\d{8}-\d{4}$/;

export function fail(errors, path, message) {
  errors.push({ path, message });
}

// Each type function pushes its own path-tagged error; object specs are data so
// a shape is one table, not a hand-written if-chain.
export const T = {
  str: (v, p, e) => { if (!isStr(v)) fail(e, p, "expected a non-empty string"); },
  kebab: (v, p, e) => { if (!isStr(v) || !KEBAB.test(v)) fail(e, p, "expected lowercase kebab-case"); },
  gap: (v, p, e) => { if (!isStr(v) || !GAP.test(v)) fail(e, p, "expected a gap id G<n>, n >= 1"); },
  hex40: (v, p, e) => { if (!isStr(v) || !HEX40.test(v)) fail(e, p, "expected a full 40-hex commit SHA"); },
  hex64: (v, p, e) => { if (!isStr(v) || !HEX64.test(v)) fail(e, p, "expected a 64-hex sha256"); },
  hex: (v, p, e) => { if (!isStr(v) || !HEX.test(v)) fail(e, p, "expected a 40- or 64-hex id"); },
  iso: (v, p, e) => {
    if (!isStr(v) || !ISO.test(v) || Number.isNaN(Date.parse(v))) fail(e, p, "expected an ISO-8601 UTC timestamp with Z");
  },
  int: (min) => (v, p, e) => { if (!isInt(v, min)) fail(e, p, `expected an integer >= ${min}`); },
  bool: (v, p, e) => { if (typeof v !== "boolean") fail(e, p, "expected true or false"); },
  nullable: (fn) => (v, p, e) => { if (v !== null) fn(v, p, e); },
  opt: (fn) => {
    const wrapped = (v, p, e) => fn(v, p, e);
    wrapped.optional = true;
    return wrapped;
  },
  enumOf: (values) => (v, p, e) => {
    if (!values.includes(v)) fail(e, p, `expected one of ${values.join("|")}`);
  },
  arr: (fn, min = 0) => (v, p, e) => {
    if (!Array.isArray(v)) return fail(e, p, "expected an array");
    if (v.length < min) fail(e, p, `expected at least ${min} item(s)`);
    v.forEach((item, index) => fn(item, `${p}[${index}]`, e));
  },
  obj: (spec) => (v, p, e) => {
    if (!isObj(v)) return fail(e, p, "expected an object");
    Object.entries(spec).forEach(([key, fn]) => {
      if (!(key in v)) {
        if (!fn.optional) fail(e, `${p}.${key}`, "missing");
        return;
      }
      fn(v[key], `${p}.${key}`, e);
    });
  },
};

export function rejectUnknown(value, allowed, path, errors) {
  if (!isObj(value)) return;
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) fail(errors, `${path}.${key}`, "unknown field");
  }
}
