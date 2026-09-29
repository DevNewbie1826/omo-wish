import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { resolve, join } from "node:path";

const root = resolve(process.argv[2] ?? ".");
const senpi = process.env.SENPI_ROOT ?? join(homedir(), ".bun/install/global/node_modules/@code-yeongyu/senpi");
const { DefaultResourceLoader } = await import(`${senpi}/dist/core/resource-loader.js`);
const { SettingsManager } = await import(`${senpi}/dist/core/settings-manager.js`);
const { expandPromptTemplate } = await import(`${senpi}/dist/core/prompt-templates.js`);
const { ExtensionRunner } = await import(`${senpi}/dist/core/extensions/runner.js`);
const skillPath = join(root, "skills/wish/SKILL.md");
const marker = "<!-- omo-wish:entry:v1 -->";
const armingSymbol = Symbol.for("omo.ultrawork.arming");
const previousArming = Object.getOwnPropertyDescriptor(globalThis, armingSymbol);

function check(name, assertion) {
  assertion();
  console.log(`PASS ${name}`);
}

function createRunner(loader) {
  const loaded = loader.getExtensions();
  assert.deepEqual(loaded.errors, []);
  const wishExtensions = loaded.extensions.filter((extension) =>
    extension.resolvedPath === join(root, "extensions/wish.js"));
  assert.equal(wishExtensions.length, 1);
  const sessionManager = {
    getSessionId: () => "wish-verification",
    getBranch: () => [],
    getSessionFile: () => undefined,
    getEntries: () => [],
  };
  return new ExtensionRunner(wishExtensions, loaded.runtime, root, sessionManager, {}, loaded.eventBus);
}

async function messages(runner, text, options = {}) {
  return (await runner.emitBeforeAgentStart(text, undefined, "", {}, options))?.messages ?? [];
}

try {
  const loader = new DefaultResourceLoader({
    cwd: root,
    agentDir: join(root, ".absent-agent"),
    settingsManager: SettingsManager.inMemory(),
    additionalExtensionPaths: [root],
    noContextFiles: true,
  });
  await loader.reload();
  const skills = loader.getSkills();
  const prompts = loader.getPrompts();
  const runner = createRunner(loader);
  const template = prompts.prompts.find((entry) => entry.name === "wish");
  check("package manifest and resource loader discover skill, command, extension", () => {
    assert.deepEqual(skills.diagnostics, []);
    assert.deepEqual(prompts.diagnostics, []);
    assert.equal(skills.skills.find((skill) => skill.name === "wish")?.filePath, skillPath);
    assert.equal(template?.description, "소원을 빕니다");
    assert.equal(loader.getExtensions().extensions.some((extension) =>
      extension.resolvedPath === join(root, "extensions/wish.js")), true);
    assert.equal(existsSync(skillPath), true);
  });

  const bare = expandPromptTemplate("/wish", prompts.prompts);
  const args = expandPromptTemplate('/wish "keep $ARGUMENTS $1 literal" "x <!-- omo-wish:entry:v1 --> y"', prompts.prompts);
  check("bare and literal arguments expand with terminal entry", () => {
    assert.equal(bare.split("\n")[0], "");
    assert.equal(args.split("\n")[0], `keep $ARGUMENTS $1 literal x ${marker} y`);
    assert.equal(bare.trimEnd().endsWith(marker), true);
    assert.equal(args.trimEnd().endsWith(marker), true);
  });
  check("before_agent_start is preview-safe", () => {
    assert.deepEqual(runner.getPreviewUnsafeBeforeAgentStartPaths(), []);
  });
  for (const text of [bare, args]) {
    const pointer = await messages(runner, text, { preview: true });
    check("expanded command provides a hidden local skill pointer", () => {
      assert.equal(pointer.length, 1);
      assert.equal(pointer[0].customType, "omo-wish:skill");
      assert.equal(pointer[0].display, false);
      assert.ok(pointer[0].content.includes(JSON.stringify(skillPath)));
    });
  }
  for (const raw of ["ordinary ulw text", "/wishful hello", "/WISH hello", `x ${marker} suffix`]) {
    const inactive = await messages(runner, raw);
    check(`unrelated input stays inactive: ${raw}`, () => {
      assert.equal(expandPromptTemplate(raw, prompts.prompts), raw);
      assert.deepEqual(inactive, []);
    });
  }
  const marks = [];
  const armed = new Set();
  globalThis[armingSymbol] = {
    directive: "DIRECTIVE_SENTINEL",
    arming: {
      isArmed: (id) => armed.has(id),
      markArmed: (id) => { marks.push(id); armed.add(id); },
    },
  };
  const preview = await messages(runner, args, { preview: true });
  const unrelated = await messages(runner, "ordinary ulw text");
  check("preview and unrelated input do not consume activation", () => {
    assert.equal(preview.length, 1);
    assert.equal(preview[0].customType, "omo-wish:skill");
    assert.deepEqual(unrelated, []);
    assert.deepEqual(marks, []);
  });
  armed.add("wish-verification");
  const prearmed = await messages(runner, args);
  check("an explicitly armed session receives only the skill pointer", () => {
    assert.equal(prearmed.length, 1);
    assert.equal(prearmed[0].customType, "omo-wish:skill");
    assert.deepEqual(marks, []);
  });
  armed.delete("wish-verification");
  const first = await messages(runner, args);
  const repeat = await messages(runner, args);
  check("first real wish arms once and passes actual directive and skill pointer", () => {
    assert.equal(first.length, 1);
    assert.equal(first[0].customType, "omo-ultrawork:directive");
    assert.ok(first[0].content.includes("DIRECTIVE_SENTINEL"));
    assert.ok(first[0].content.includes(JSON.stringify(skillPath)));
    assert.deepEqual(marks, ["wish-verification"]);
    assert.equal(repeat.length, 1);
    assert.equal(repeat[0].customType, "omo-wish:skill");
    assert.equal(globalThis[armingSymbol].directive, "DIRECTIVE_SENTINEL");
  });
  await loader.reload();
  const fresh = createRunner(loader);
  const afterReload = await messages(fresh, bare);
  check("fresh resource reload preserves already armed state", () => {
    assert.equal(afterReload.length, 1);
    assert.equal(afterReload[0].customType, "omo-wish:skill");
    assert.deepEqual(marks, ["wish-verification"]);
  });
  delete globalThis[armingSymbol];
  const withoutMode = await messages(fresh, bare);
  check("absent mode state provides only a pointer", () => {
    assert.equal(Object.hasOwn(globalThis, armingSymbol), false);
    assert.equal(withoutMode.length, 1);
    assert.equal(withoutMode[0].customType, "omo-wish:skill");
  });
  console.log(`ALL PASS: ${root}`);
} finally {
  if (previousArming) Object.defineProperty(globalThis, armingSymbol, previousArming);
  else delete globalThis[armingSymbol];
}
