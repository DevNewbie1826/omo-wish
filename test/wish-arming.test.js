import { afterAll, expect, test } from "bun:test";
import { cpSync, existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { repo, expandPromptTemplate, resources, runner, input, submit, messages, directiveMessages, fixtures, removeFixtures } from "./wish-harness.js";

afterAll(removeFixtures);

test("an expanded wish arms generic mode with only the host directive; an ordinary ULW request does not", async () => {
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
    const first = await submit(extensionRunner, "/wish do it", templates);
    expect(directiveMessages(first)).toEqual([{
      customType: "omo-ultrawork:directive",
      content: "DIRECTIVE_SENTINEL",
      display: false,
    }]);
    expect(directiveMessages(await submit(extensionRunner, "/wish do it", templates))).toEqual([]);
    for (const plain of ["ordinary ULW request", "ultrawork this"]) {
      armed.clear();
      expect(await submit(extensionRunner, plain, templates)).toEqual([]);
      expect(await messages(extensionRunner, plain, { preview: true })).toEqual([]);
    }
    expect(marks).toEqual(["wish-test"]);
  } finally {
    if (prior) Object.defineProperty(globalThis, symbol, prior);
    else delete globalThis[symbol];
  }
});

test("generic mode does not arm on invalid session ids", async () => {
  const { templates } = await resources();
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
    for (const invalidId of [0, false, ""]) {
      const extensionRunner = await runner(repo, invalidId);
      expect(directiveMessages(await submit(extensionRunner, "/wish invalid session", templates))).toEqual([]);
    }
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
      expect(await submit(extensionRunner, raw, templates)).toEqual([]);
    }
    expect(marks).toEqual([]);
  } finally {
    if (prior) Object.defineProperty(globalThis, symbol, prior);
    else delete globalThis[symbol];
  }
});

test("real wish entry arms once; unrelated input and pre-armed sessions do not", async () => {
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
    expect(await submit(first, "unrelated input", templates)).toEqual([]);
    expect(marks).toEqual([]);
    await input(first, "/wish again");
    armed.add("wish-test");
    expect(directiveMessages(await messages(first, text))).toEqual([]);
    expect(marks).toEqual([]);
    armed.delete("wish-test");
    expect(directiveMessages(await submit(first, "/wish again", templates))).toEqual([{
      customType: "omo-ultrawork:directive",
      content: "DIRECTIVE_SENTINEL",
      display: false,
    }]);
    expect(marks).toEqual(["wish-test"]);
    for (const next of [first, await runner()]) {
      expect(directiveMessages(await submit(next, "/wish again", templates))).toEqual([]);
    }
    expect(marks).toEqual(["wish-test"]);
    expect(globalThis[symbol].directive).toBe("DIRECTIVE_SENTINEL");
    delete globalThis[symbol];
    expect(directiveMessages(await submit(first, "/wish again", templates))).toEqual([]);
    expect(Object.hasOwn(globalThis, symbol)).toBe(false);
    globalThis[symbol] = { directive: "DIRECTIVE_SENTINEL" };
    expect(directiveMessages(await submit(first, "/wish again", templates))).toEqual([]);
    expect(marks).toEqual(["wish-test"]);
  } finally {
    if (prior) Object.defineProperty(globalThis, symbol, prior);
    else delete globalThis[symbol];
  }
});

test("preview stays silent and does not consume the recorded command", async () => {
  const { templates } = await resources();
  const text = expandPromptTemplate("/wish preview", templates);
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
    const extensionRunner = await runner(repo, "wish-preview");
    await input(extensionRunner, "/wish preview");
    expect(directiveMessages(await messages(extensionRunner, text, { preview: true }))).toEqual([]);
    expect(marks).toEqual([]);
    expect(directiveMessages(await messages(extensionRunner, text))).toEqual([{
      customType: "omo-ultrawork:directive",
      content: "DIRECTIVE_SENTINEL",
      display: false,
    }]);
    expect(marks).toEqual(["wish-preview"]);
  } finally {
    if (prior) Object.defineProperty(globalThis, symbol, prior);
    else delete globalThis[symbol];
  }
});

test("marker text without a typed /wish command never arms", async () => {
  const { templates } = await resources();
  const marker = "Read and follow the `wish` skill";
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
    const extensionRunner = await runner();
    const quoted = `What does "${marker}" mean?`;
    const lookalike = `/wishful ${marker}`;
    for (const raw of [quoted, lookalike]) {
      expect(expandPromptTemplate(raw, templates)).toBe(raw);
      expect(directiveMessages(await submit(extensionRunner, raw, templates))).toEqual([]);
    }
    await input(extensionRunner, "/wish do it");
    expect(directiveMessages(await submit(extensionRunner, quoted, templates))).toEqual([]);
    expect(await submit(extensionRunner, `/wish ${marker}`, templates, { source: "extension", trigger: "prompt" })).toEqual([]);
    await input(extensionRunner, "/wish do it");
    const expanded = expandPromptTemplate("/wish do it", templates);
    expect(directiveMessages(await messages(extensionRunner, expanded, { trigger: "extension" }))).toEqual([]);
    expect(directiveMessages(await messages(extensionRunner, expanded))).toEqual([{
      customType: "omo-ultrawork:directive",
      content: "DIRECTIVE_SENTINEL",
      display: false,
    }]);
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
    const injected = await submit(await runner(dir), "/wish moved", templates);
    expect(directiveMessages(injected)).toEqual([{
      customType: "omo-ultrawork:directive",
      content: "DIRECTIVE_SENTINEL",
      display: false,
    }]);
    expect(marks).toEqual(["wish-test"]);
  } finally {
    if (prior) Object.defineProperty(globalThis, symbol, prior);
    else delete globalThis[symbol];
  }
});
