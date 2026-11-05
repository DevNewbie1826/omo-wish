import { expect, test } from "bun:test";
import {
  FINDINGS_COLUMNS,
  VQA_ITEM_IDS,
  classValid,
  parseFindingsTsv,
} from "../skills/wish/scripts/lib/schema.mjs";

const HEAD = "0123456789abcdef0123456789abcdef01234567";
const ACCEPTED = ["A13", "B8", "E7", "F8", "F9"];
const UNKNOWN_DESIGN_IDS = ["A14", "A0", "B9", "E8", "F10", "Z1", "a13"];

const FAMILIES = [
  ["A", 13],
  ["B", 8],
  ["C", 8],
  ["D", 4],
  ["E", 7],
  ["F", 9],
  ["G", 7],
  ["H", 11],
  ["I", 5],
  ["J", 2],
];

const EXPECTED = FAMILIES.flatMap(([letter, count]) =>
  Array.from({ length: count }, (_, index) => `${letter}${index + 1}`),
);

function findingsRow(id) {
  return [
    "F1", "1", "ultrabrain", id, "HIGH", "skills/wish/SKILL.md:1", "1",
    "bun test test/schema.test.js", HEAD, "open", "-",
  ].join("\t");
}

test.each(ACCEPTED)("classValid accepts the new design id %s", (id) => {
  expect(classValid("design", id)).toBe(true);
});

test.each(ACCEPTED)("a design findings row accepts class %s", (id) => {
  const text = `${FINDINGS_COLUMNS.join("\t")}\n${findingsRow(id)}\n`;
  const result = parseFindingsTsv(text, { type: "design" });
  expect(result.errors, JSON.stringify(result.errors)).toEqual([]);
  expect(result.ok).toBe(true);
});

test("design rejects every id outside the VQA item set", () => {
  for (const id of UNKNOWN_DESIGN_IDS) {
    expect(classValid("design", id), `${id} must not be a design class`).toBe(false);
  }
});

test("a findings row with an unknown design class fails on row class", () => {
  const text = [
    FINDINGS_COLUMNS.join("\t"),
    `F1\t1\tsweep\tA14\tLOW\tsrc/a.mjs:4\t1\tbun test\t${HEAD}\topen\t-\n`,
  ].join("\n");
  const result = parseFindingsTsv(text, { type: "design" });
  expect(result.ok).toBe(false);
  expect(result.errors.some((entry) => entry.path.endsWith(".class"))).toBe(true);
});

test("new design-only ids are not code classes", () => {
  expect(classValid("code", "A13")).toBe(false);
  expect(classValid("code", "F8")).toBe(false);
});

test("VQA inventory is the 74-item ordered ten-family checklist", () => {
  expect(VQA_ITEM_IDS.length).toBe(74);
  expect(new Set(VQA_ITEM_IDS).size).toBe(74);

  for (const id of ["A13", "B8", "E7", "F8", "F9"]) {
    expect(VQA_ITEM_IDS).toContain(id);
  }

  expect(VQA_ITEM_IDS).toEqual(EXPECTED);
});
