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
  globalThis[armingSymbol] = {
    directive: "<existing directive>",
    arming: { isArmed: () => true, markArmed: (id) => marks.push(id) },
  };
  const twice = [await messages(runner, args), await messages(runner, args)];
  check("repeated invocation preserves explicit mode state", () => {
    assert.deepEqual(twice.map((result) => result.length), [1, 1]);
    assert.deepEqual(marks, []);
    assert.equal(globalThis[armingSymbol].directive, "<existing directive>");
  });
  delete globalThis[armingSymbol];
  const withoutMode = await messages(runner, bare);
  check("absent mode state also produces a pointer", () => {
    assert.equal(Object.hasOwn(globalThis, armingSymbol), false);
    assert.equal(withoutMode.length, 1);
  });
  await loader.reload();
  const fresh = createRunner(loader);
  const afterReload = await messages(fresh, bare);
  check("fresh resource reload still provides a pointer", () => {
    assert.equal(afterReload.length, 1);
  });
  console.log(`ALL PASS: ${root}`);
} finally {
  if (previousArming) Object.defineProperty(globalThis, armingSymbol, previousArming);
  else delete globalThis[armingSymbol];
}
