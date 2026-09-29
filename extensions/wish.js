const keyword = /\b(?:ultrawork|ulw)\b/i;
const armingSymbol = Symbol.for("omo.ultrawork.arming");

export default function (pi) {
  pi.on("before_agent_start", (event, ctx) => {
    if (event.preview === true || typeof event.prompt !== "string" || !keyword.test(event.prompt)) return;
    const state = globalThis[armingSymbol];
    const arming = state?.arming;
    const sessionId = ctx.sessionManager?.getSessionId();
    if (typeof sessionId !== "string" || sessionId.length === 0
      || typeof state?.directive !== "string" || state.directive.length === 0
      || typeof arming?.isArmed !== "function" || typeof arming?.markArmed !== "function"
      || arming.isArmed(sessionId)) return;
    arming.markArmed(sessionId);
    return {
      message: {
        customType: "omo-ultrawork:directive",
        content: state.directive,
        display: false,
      },
    };
  }, { previewSafe: true });
}
