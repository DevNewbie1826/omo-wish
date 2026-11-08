import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

export function manifestSkillFiles(root) {
  const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).pi;
  return (manifest?.skills ?? []).map((dir) => join(root, dir, "SKILL.md"));
}

// The skill only ships documents, so every references/<file> it names must
// resolve beside SKILL.md; a typo here is a broken pointer for the reader.
export function referencedFiles(skillFilePath) {
  const text = readFileSync(skillFilePath, "utf8");
  return [...new Set(text.match(/references\/[A-Za-z0-9._-]+/g) ?? [])].sort();
}

export const check = (name, assertion) => {
  assertion();
  console.log(`PASS ${name}`);
};

async function main() {
  const root = resolve(process.argv[2] ?? ".");
  const senpi = process.env.SENPI_ROOT ?? join(homedir(), ".bun/install/global/node_modules/@code-yeongyu/senpi");
  const skillPath = join(root, "skills/wish/SKILL.md");

  check("every skill file the manifest names exists", () => {
    const files = manifestSkillFiles(root);
    assert.notEqual(files.length, 0, "package.json pi.skills names no skill directory");
    for (const file of files) {
      assert.equal(existsSync(file), true, `skill file is missing: ${file}`);
    }
  });

  const { DefaultResourceLoader } = await import(`${senpi}/dist/core/resource-loader.js`);
  const { SettingsManager } = await import(`${senpi}/dist/core/settings-manager.js`);
  const { expandPromptTemplate } = await import(`${senpi}/dist/core/prompt-templates.js`);
  const { ExtensionRunner } = await import(`${senpi}/dist/core/extensions/runner.js`);
  const armingSymbol = Symbol.for("omo.ultrawork.arming");
  const previousArming = Object.getOwnPropertyDescriptor(globalThis, armingSymbol);

  const createRunner = (loader) => {
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
  };

  const messages = async (runner, text, options = {}) =>
    (await runner.emitBeforeAgentStart(text, undefined, "", {}, options))?.messages ?? [];
  const directiveMessages = (list) => (list ?? []).filter((message) => message?.customType === "omo-ultrawork:directive");

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
    check("the loader resolved no skill to a missing file", () => {
      for (const skill of skills.skills) {
        assert.equal(existsSync(skill.filePath), true,
          `the loader found skill ${skill.name} at a missing file: ${skill.filePath}`);
      }
    });
    check("every reference file the skill names exists beside it", () => {
      const references = referencedFiles(skillPath);
      assert.notEqual(references.length, 0, `${skillPath} names no references/ file`);
      for (const reference of references) {
        assert.equal(existsSync(join(root, "skills/wish", reference)), true,
          `reference file is missing: ${reference}`);
      }
    });

    const bare = expandPromptTemplate("/wish", prompts.prompts);
    const args = expandPromptTemplate('/wish "keep $ARGUMENTS $1 literal" "x <literal> y"', prompts.prompts);
    check("bare and literal arguments expand without terminal marker", () => {
      assert.equal(bare.split("\n")[0], "");
      assert.equal(args.split("\n")[0], "keep $ARGUMENTS $1 literal x <literal> y");
      assert.equal(bare.includes("<!-- omo-wish:entry:v1 -->"), false);
      assert.equal(args.includes("<!-- omo-wish:entry:v1 -->"), false);
      assert.equal(bare.includes("Read and follow the `wish` skill"), true);
      assert.equal(args.includes("Read and follow the `wish` skill"), true);
    });
    check("before_agent_start is preview-safe", () => {
      assert.deepEqual(runner.getPreviewUnsafeBeforeAgentStartPaths(), []);
    });
    for (const text of [bare, args]) {
      const preview = await messages(runner, text, { preview: true });
      check("preview leaves expanded entry without injected messages", () => {
        assert.deepEqual(directiveMessages(preview), []);
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
    for (const raw of ["unrelated input", "xulw", "ultrawork_ish", "/wishful hello", "/WISH hello"]) {
      const inactive = await messages(runner, raw);
      check(`unrelated or lookalike input stays inactive: ${raw}`, () => {
        assert.equal(expandPromptTemplate(raw, prompts.prompts), raw);
        assert.deepEqual(directiveMessages(inactive), []);
        assert.deepEqual(marks, []);
      });
    }
    const preview = await messages(runner, args, { preview: true });
    check("preview does not consume activation", () => {
      assert.deepEqual(directiveMessages(preview), []);
      assert.deepEqual(marks, []);
    });
    // Taken while this session is still unarmed, so a keyword trigger that
    // arms generic mode here would show as a directive and a mark.
    const ordinary = await messages(runner, "ordinary ulw request");
    check("an ordinary ulw prompt does not arm through this extension", () => {
      assert.deepEqual(directiveMessages(ordinary), []);
      assert.deepEqual(marks, []);
    });
    armed.add("wish-verification");
    const prearmed = await messages(runner, args);
    check("an explicitly armed session remains silent", () => {
      assert.deepEqual(directiveMessages(prearmed), []);
      assert.deepEqual(marks, []);
    });
    armed.delete("wish-verification");
    const first = await messages(runner, args);
    const repeat = await messages(runner, args);
    check("first real wish arms once with the exact supplied directive", () => {
      assert.deepEqual(directiveMessages(first), [{
        customType: "omo-ultrawork:directive",
        content: "DIRECTIVE_SENTINEL",
        display: false,
      }]);
      assert.deepEqual(marks, ["wish-verification"]);
      assert.deepEqual(directiveMessages(repeat), []);
      assert.equal(globalThis[armingSymbol].directive, "DIRECTIVE_SENTINEL");
    });
    await loader.reload();
    const fresh = createRunner(loader);
    const afterReload = await messages(fresh, bare);
    check("fresh resource reload preserves already armed state", () => {
      assert.deepEqual(directiveMessages(afterReload), []);
      assert.deepEqual(marks, ["wish-verification"]);
    });
    delete globalThis[armingSymbol];
    const withoutMode = await messages(fresh, bare);
    check("absent mode state sends no message or mutation", () => {
      assert.equal(Object.hasOwn(globalThis, armingSymbol), false);
      assert.deepEqual(directiveMessages(withoutMode), []);
    });
    globalThis[armingSymbol] = { directive: "DIRECTIVE_SENTINEL" };
    const unsupported = await messages(fresh, bare);
    check("unsupported interop sends no message or mutation", () => {
      assert.deepEqual(directiveMessages(unsupported), []);
      assert.deepEqual(marks, ["wish-verification"]);
    });

    console.log(`ALL PASS: ${root}`);
  } finally {
    if (previousArming) Object.defineProperty(globalThis, armingSymbol, previousArming);
    else delete globalThis[armingSymbol];
  }
}

if (import.meta.main ?? false) await main();
