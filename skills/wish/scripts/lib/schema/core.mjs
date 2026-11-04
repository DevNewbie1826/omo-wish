import { HEX40, HEX64, isStr, RULE_ID } from "./primitives.mjs";
import { WORK_TYPES, PRIMARY_TYPES, FINDINGS_CLASSES, REQUIRED_RECEIPTS, CONDITIONAL_RECEIPTS } from "./constants.mjs";
export function headErrors(type, head) {
  const ok = type === "research" ? HEX64.test(head) : HEX40.test(head);
  return ok ? [] : [{ path: "head", message: type === "research"
    ? "research head is the frozen artifact sha256 (64 lowercase hex)"
    : "head is the full 40-hex commit SHA" }];
}

export function findingsClassesFor(type, { primary, secondary } = {}) {
  if (!WORK_TYPES.includes(type)) return [];
  if (type === "mixed") {
    const classes = [primary, secondary].filter((named) => PRIMARY_TYPES.includes(named));
    return [...new Set(classes.flatMap((named) => FINDINGS_CLASSES[named] ?? []))];
  }
  return FINDINGS_CLASSES[type] ?? [];
}

export function classValid(type, value, options = {}) {
  if (!isStr(value)) return false;
  if (type === "audit") return RULE_ID.test(value);
  if (type === "mixed") {
    const named = [options.primary, options.secondary].filter((entry) => PRIMARY_TYPES.includes(entry));
    return named.some((entry) => classValid(entry, value));
  }
  return findingsClassesFor(type).includes(value);
}

export function blockingStatus(status) {
  return status === "FAIL";
}

export function requiredReceiptsFor(type, { primary, secondary, highRisk = false } = {}) {
  const pick = (named) => (REQUIRED_RECEIPTS[named] ?? [])
    .filter((lane) => CONDITIONAL_RECEIPTS[lane] !== "high-risk" || highRisk);
  if (type === "mixed") return [...new Set([...pick(primary), ...pick(secondary)])];
  return [...pick(type)];
}
