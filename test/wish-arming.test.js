import { afterAll, expect, test } from "bun:test";
import { cpSync, existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { repo, expandPromptTemplate, resources, runner, messages, directiveMessages, stageSkillsMessage, fixtures, removeFixtures } from "./wish-harness.js";

afterAll(removeFixtures);

test("expanded wish and ordinary whole-word ulw arm generic mode with only the host directive", async () => {
  const { templates } = await resources();
  const symbol = Symbol.for("omo.ultrawork.arming");
  const prior = Object.getOwnPropertyDescriptor(globalThis, symbol);
  const armed = new Set();
  const marks = [];
  try {
    globalThis[symbol] = {
      directive: "DIRECTIVE_SENTINEL",
      arming: {
        isArmed: (id) => armed.has(id),
        markArmed: (id) => { marks.push(id); armed.add(id); },
      },
    };
    const extensionRunner = await runner();
    for (const text of ["ordinary ULW request", expandPromptTemplate("/wish do it", templates)]) {
      armed.clear();
      const first = await messages(extensionRunner, text);
      expect(directiveMessages(first)).toEqual([{
        customType: "omo-ultrawork:directive",
        content: "DIRECTIVE_SENTINEL",
        display: false,
      }]);
      expect(directiveMessages(await messages(extensionRunner, text))).toEqual([]);
      if (text !== "ordinary ULW request") {
        expect(first.filter((m) => m?.customType === "omo-wish:stage-skills")).toEqual([stageSkillsMessage]);
        expect((await messages(extensionRunner, text)).filter((m) => m?.customType === "omo-wish:stage-skills"))
          .toEqual([stageSkillsMessage]);
      }
    }
    expect(marks).toEqual(["wish-test", "wish-test"]);
  } finally {
    if (prior) Object.defineProperty(globalThis, symbol, prior);
    else delete globalThis[symbol];
  }
});

test("generic mode does not arm on invalid session ids", async () => {
  const extensionRunner = await runner(repo, 0);
  const symbol = Symbol.for("omo.ultrawork.arming");
  const prior = Object.getOwnPropertyDescriptor(globalThis, symbol);
  const marks = [];
  try {
    globalThis[symbol] = {
      directive: "DIRECTIVE_SENTINEL",
      arming: {
        isArmed: () => false,
        markArmed: (id) => marks.push(id),
      },
    };
    const injected = await messages(extensionRunner, "ordinary ULW request with an invalid session id");
    expect(directiveMessages(injected)).toEqual([]);
    expect(marks).toEqual([]);
  } finally {
    if (prior) Object.defineProperty(globalThis, symbol, prior);
    else delete globalThis[symbol];
  }
});

test("package resources discover the available wish skill", async () => {
  const { templates, skills, extensionPaths } = await resources();
  expect(templates.map((template) => template.name)).toContain("wish");
  expect(skills.diagnostics).toEqual([]);
  expect(skills.skills.find((skill) => skill.name === "wish")?.filePath)
    .toBe(join(repo, "skills/wish/SKILL.md"));
  expect(extensionPaths).toEqual([join(repo, "extensions/wish.js")]);
});

test("bare and quoted /wish arguments reach the expanded entry without recursive expansion", async () => {
  const { templates } = await resources();
  const extensionRunner = await runner();
  const bare = expandPromptTemplate("/wish", templates);
  const withArgs = expandPromptTemplate('/wish "keep $ARGUMENTS $1 literal" "x <literal> y"', templates);
  expect(bare.split("\n")[0]).toBe("");
  expect(withArgs.split("\n")[0]).toBe("keep $ARGUMENTS $1 literal x <literal> y");
  for (const text of [bare, withArgs]) {
    expect(text).toContain("Read and follow the `wish` skill");
    expect(text).not.toContain("<!-- omo-wish:entry:v1 -->");
    expect(await messages(extensionRunner, text, { preview: true })).toEqual([]);
    expect(existsSync(join(repo, "skills/wish/SKILL.md"))).toBe(true);
  }
});

test("lookalike words do not activate generic mode", async () => {
  const { templates } = await resources();
  const extensionRunner = await runner();
  const symbol = Symbol.for("omo.ultrawork.arming");
  const prior = Object.getOwnPropertyDescriptor(globalThis, symbol);
  const marks = [];
  try {
    globalThis[symbol] = {
      directive: "DIRECTIVE_SENTINEL",
      arming: {
        isArmed: () => false,
        markArmed: (id) => marks.push(id),
      },
    };
    for (const raw of ["ulworks", "xulw", "ultrawork_ish", "/wishful hello", "/WISH hello"]) {
      const expanded = expandPromptTemplate(raw, templates);
      expect(expanded).toBe(raw);
      expect(await messages(extensionRunner, expanded)).toEqual([]);
    }
    expect(marks).toEqual([]);
  } finally {
    if (prior) Object.defineProperty(globalThis, symbol, prior);
    else delete globalThis[symbol];
  }
});

test("real wish entry arms once; preview, unrelated input and pre-armed sessions do not", async () => {
  const { templates } = await resources();
  const text = expandPromptTemplate("/wish again", templates);
  const symbol = Symbol.for("omo.ultrawork.arming");
  const prior = Object.getOwnPropertyDescriptor(globalThis, symbol);
  const marks = [];
  const armed = new Set();
  try {
    globalThis[symbol] = {
      directive: "DIRECTIVE_SENTINEL",
      arming: {
        isArmed: (id) => armed.has(id),
        markArmed: (id) => { marks.push(id); armed.add(id); },
      },
    };
    const first = await runner();
    const preview = await messages(first, text, { preview: true });
    expect(directiveMessages(preview)).toEqual([]);
    expect(await messages(first, "unrelated input")).toEqual([]);
    expect(marks).toEqual([]);
    armed.add("wish-test");
    const prearmed = await messages(first, text);
    expect(directiveMessages(prearmed)).toEqual([]);
    expect(prearmed.filter((m) => m?.customType === "omo-wish:stage-skills")).toEqual([stageSkillsMessage]);
    expect(marks).toEqual([]);
    armed.delete("wish-test");
    const activation = await messages(first, text);
    expect(directiveMessages(activation)).toEqual([{
      customType: "omo-ultrawork:directive",
      content: "DIRECTIVE_SENTINEL",
      display: false,
    }]);
    expect(activation.filter((m) => m?.customType === "omo-wish:stage-skills")).toEqual([stageSkillsMessage]);
    expect(marks).toEqual(["wish-test"]);
    for (const next of [first, await runner()]) {
      const repeat = await messages(next, text);
      expect(directiveMessages(repeat)).toEqual([]);
      expect(repeat.filter((m) => m?.customType === "omo-wish:stage-skills")).toEqual([stageSkillsMessage]);
    }
    expect(marks).toEqual(["wish-test"]);
    expect(globalThis[symbol].directive).toBe("DIRECTIVE_SENTINEL");
    delete globalThis[symbol];
    const withoutState = await messages(first, text);
    expect(directiveMessages(withoutState)).toEqual([]);
    expect(withoutState.filter((m) => m?.customType === "omo-wish:stage-skills")).toEqual([stageSkillsMessage]);
    expect(Object.hasOwn(globalThis, symbol)).toBe(false);
    globalThis[symbol] = { directive: "DIRECTIVE_SENTINEL" };
    const unsupported = await messages(first, text);
    expect(directiveMessages(unsupported)).toEqual([]);
    expect(unsupported.filter((m) => m?.customType === "omo-wish:stage-skills")).toEqual([stageSkillsMessage]);
    expect(marks).toEqual(["wish-test"]);
  } finally {
    if (prior) Object.defineProperty(globalThis, symbol, prior);
    else delete globalThis[symbol];
  }
});

test("an installation path with spaces, quotes, #, and Unicode discovers skill and activates generic mode", async () => {
  const dir = mkdtempSync(join(tmpdir(), 'wish "quoted" # \uD55C\uAE00 '));
  fixtures.push(dir);
  cpSync(join(repo, "package.json"), join(dir, "package.json"));
  cpSync(join(repo, "prompts"), join(dir, "prompts"), { recursive: true });
  cpSync(join(repo, "extensions"), join(dir, "extensions"), { recursive: true });
  cpSync(join(repo, "skills/wish"), join(dir, "skills/wish"), { recursive: true });
  const { templates, skills } = await resources(dir);
  const actualSkillPath = join(dir, "skills/wish/SKILL.md");
  expect(skills.diagnostics).toEqual([]);
  expect(skills.skills.find((skill) => skill.name === "wish")?.filePath).toBe(actualSkillPath);
  expect(existsSync(actualSkillPath)).toBe(true);
  const symbol = Symbol.for("omo.ultrawork.arming");
  const prior = Object.getOwnPropertyDescriptor(globalThis, symbol);
  const marks = [];
  try {
    globalThis[symbol] = {
      directive: "DIRECTIVE_SENTINEL",
      arming: {
        isArmed: () => false,
        markArmed: (id) => marks.push(id),
      },
    };
    const injected = await messages(await runner(dir), expandPromptTemplate("/wish moved", templates));
    expect(directiveMessages(injected)).toEqual([{
      customType: "omo-ultrawork:directive",
      content: "DIRECTIVE_SENTINEL",
      display: false,
    }]);
    expect(injected.filter((message) => message?.customType === "omo-wish:stage-skills"))
      .toEqual([stageSkillsMessage]);
    expect(marks).toEqual(["wish-test"]);
  } finally {
    if (prior) Object.defineProperty(globalThis, symbol, prior);
    else delete globalThis[symbol];
  }
});
