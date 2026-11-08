const armingSymbol = Symbol.for("omo.ultrawork.arming");
const wishMarker = "Read and follow the `wish` skill";
const wishCommand = /^\/wish(?:\s|$)/;

export default function (pi) {
  const pending = new Set();

  pi.on("input", (event, ctx) => {
    const sessionId = ctx.sessionManager?.getSessionId();
    if (typeof sessionId !== "string" || sessionId.length === 0) return;
    if (event.source !== "extension" && typeof event.text === "string" && wishCommand.test(event.text)) pending.add(sessionId);
    else pending.delete(sessionId);
  });

  pi.on("before_agent_start", (event, ctx) => {
    if (event.preview === true) return;
    const sessionId = ctx.sessionManager?.getSessionId();
    if (typeof sessionId !== "string" || sessionId.length === 0 || !pending.has(sessionId)
      || event.trigger !== "prompt") return;
    pending.delete(sessionId);
    if (typeof event.prompt !== "string" || !event.prompt.includes(wishMarker)) return;
    const state = globalThis[armingSymbol];
    const arming = state?.arming;
    if (typeof state?.directive !== "string" || state.directive.length === 0
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
