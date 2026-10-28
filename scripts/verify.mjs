import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";

export const HELP_TIMEOUT_MS = 20_000;
// A public tool's help must carry a real synopsis line, not just any output.
export const USAGE_LINE = /^\s*(usage|synopsis)\b/im;
const SCRIPTS_DIR = "skills/wish/scripts";

export function scriptsUnder(dir) {
  const found = [];
  const walk = (current) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.name.endsWith(".mjs")) found.push(path);
    }
  };
  walk(dir);
  return found.sort();
}

export function shippedScripts(root) {
  return scriptsUnder(join(root, SCRIPTS_DIR));
}

export function scriptsRootOf(skillFilePath) {
  return join(dirname(skillFilePath), "scripts");
}

// A public tool is a script directly under scripts/; probes and lib are modules
// the tools load, so a silent --help is correct there but not for a tool.
export function isPublicTool(root, file) {
  return relative(join(root, SCRIPTS_DIR), file).split(sep).length === 1;
}

export function manifestSkillFiles(root) {
  const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).pi;
  return (manifest?.skills ?? []).map((dir) => join(root, dir, "SKILL.md"));
}

function describeFailure(result) {
  const tail = (text) => text.trim().split("\n").slice(-4).join(" | ").slice(0, 400);
  if (result.error?.code === "ETIMEDOUT") return `timed out after ${HELP_TIMEOUT_MS} ms`;
  if (result.error) return `could not run: ${result.error.message}`;
  const output = [result.stdout, result.stderr].map(tail).filter(Boolean).join(" / ");
  return output ? `exit ${result.status}: ${output}` : `exit ${result.status} with no output`;
}

export function smokeScript(root, file, run = spawnSync) {
  // A script reached through a symlinked install can exit 0 without running;
  // spawn the real path so the usage-line requirement below cannot be vacuous.
  const result = run(process.execPath, [realpathSync(file), "--help"], {
    cwd: root,
    encoding: "utf8",
    timeout: HELP_TIMEOUT_MS,
    killSignal: "SIGKILL",
    maxBuffer: 4 * 1024 * 1024,
  });
  const rel = relative(root, file).split(sep).join("/");
  if (result.error || result.status !== 0) {
    throw new Error(`${rel} --help failed: ${describeFailure(result)}`);
  }
  if (isPublicTool(root, file) && !USAGE_LINE.test(result.stdout ?? "")) {
    const first = (result.stdout ?? "").split("\n").map((line) => line.trim()).filter(Boolean)[0] ?? "(no output)";
    throw new Error(`${rel} --help printed no usage line; first line: ${first.slice(0, 160)}`);
  }
  return { file, rel, bytes: (result.stdout ?? "").length };
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
        assert.deepEqual(preview, []);
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
        assert.deepEqual(inactive, []);
        assert.deepEqual(marks, []);
      });
    }
    const preview = await messages(runner, args, { preview: true });
    check("preview does not consume activation", () => {
      assert.deepEqual(preview, []);
      assert.deepEqual(marks, []);
    });
    armed.add("wish-verification");
    const prearmed = await messages(runner, args);
    check("an explicitly armed session remains silent", () => {
      assert.deepEqual(prearmed, []);
      assert.deepEqual(marks, []);
    });
    armed.delete("wish-verification");
    const first = await messages(runner, args);
    const repeat = await messages(runner, args);
    check("first real wish arms once with the exact supplied directive", () => {
      assert.deepEqual(first, [{
        customType: "omo-ultrawork:directive",
        content: "DIRECTIVE_SENTINEL",
        display: false,
      }]);
      assert.deepEqual(marks, ["wish-verification"]);
      assert.deepEqual(repeat, []);
      assert.equal(globalThis[armingSymbol].directive, "DIRECTIVE_SENTINEL");
    });
    armed.delete("wish-verification");
    const ordinary = await messages(runner, "ordinary ULW request");
    check("ordinary whole-word ulw activates only generic mode", () => {
      assert.deepEqual(ordinary, [{
        customType: "omo-ultrawork:directive",
        content: "DIRECTIVE_SENTINEL",
        display: false,
      }]);
      assert.deepEqual(marks, ["wish-verification", "wish-verification"]);
    });
    await loader.reload();
    const fresh = createRunner(loader);
    const afterReload = await messages(fresh, bare);
    check("fresh resource reload preserves already armed state", () => {
      assert.deepEqual(afterReload, []);
      assert.deepEqual(marks, ["wish-verification", "wish-verification"]);
    });
    delete globalThis[armingSymbol];
    const withoutMode = await messages(fresh, bare);
    check("absent mode state sends no message or mutation", () => {
      assert.equal(Object.hasOwn(globalThis, armingSymbol), false);
      assert.deepEqual(withoutMode, []);
    });
    globalThis[armingSymbol] = { directive: "DIRECTIVE_SENTINEL" };
    const unsupported = await messages(fresh, bare);
    check("unsupported interop sends no message or mutation", () => {
      assert.deepEqual(unsupported, []);
      assert.deepEqual(marks, ["wish-verification", "wish-verification"]);
    });

    const scripts = scriptsUnder(scriptsRootOf(skills.skills.find((skill) => skill.name === "wish").filePath));
    check("the loader-placed skill ships the scripts this run smokes", () => {
      assert.equal(resolve(scriptsRootOf(skills.skills.find((skill) => skill.name === "wish").filePath)),
        join(root, SCRIPTS_DIR));
      assert.notEqual(scripts.length, 0, `no shipped script found under ${join(root, SCRIPTS_DIR)}`);
    });
    for (const script of scripts) {
      check(`--help exits 0: ${relative(root, script).split(sep).join("/")}`, () => {
        smokeScript(root, script);
      });
    }

    console.log(`ALL PASS: ${root}`);
  } finally {
    if (previousArming) Object.defineProperty(globalThis, armingSymbol, previousArming);
    else delete globalThis[armingSymbol];
  }
}

if (import.meta.main ?? false) await main();