import { fileURLToPath } from "node:url";

const skillPath = fileURLToPath(new URL("../skills/wish/SKILL.md", import.meta.url));
const entry = /(?:^|\r?\n)<!-- omo-wish:entry:v1 -->\s*$/;
const armingSymbol = Symbol.for("omo.ultrawork.arming");

export default function (pi) {
  pi.on("before_agent_start", (event, ctx) => {
    if (typeof event.prompt !== "string" || !entry.test(event.prompt)) return;
    const pointer = `Read the wish skill at ${JSON.stringify(skillPath)} and follow it for this request.`;
    const state = globalThis[armingSymbol];
    const arming = state?.arming;
    const sessionId = ctx.sessionManager?.getSessionId();
    if (event.preview !== true && typeof sessionId === "string" && sessionId.length > 0
      && typeof state?.directive === "string" && state.directive.length > 0
      && typeof arming?.isArmed === "function" && typeof arming?.markArmed === "function"
      && !arming.isArmed(sessionId)) {
      arming.markArmed(sessionId);
      return {
        message: {
          customType: "omo-ultrawork:directive",
          content: `${state.directive}\n\n${pointer}`,
          display: false,
        },
      };
    }
    return {
      message: {
        customType: "omo-wish:skill",
        content: pointer,
        display: false,
      },
    };
  }, { previewSafe: true });
}
