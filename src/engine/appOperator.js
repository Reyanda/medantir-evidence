// Typed command boundary between the Composer agent and the React shell.
// Internal app actions use stable commands instead of brittle DOM clicking.

const listeners = new Set();
let shellHandler = null;
let state = { status: "idle", action: "", message: "Ready", at: Date.now() };

function publish(patch) {
  state = { ...state, ...patch, at: Date.now() };
  for (const listener of listeners) listener({ ...state });
}

export function registerAppOperator(handler) {
  shellHandler = handler;
  return () => { if (shellHandler === handler) shellHandler = null; };
}

export function onOperatorState(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getOperatorState() { return { ...state }; }

export async function executeAppAction(action, args = {}) {
  if (!shellHandler) return { ok: false, error: "Actiora shell is not ready." };
  publish({ status: "working", action, message: describe(action, args) });
  try {
    const result = await shellHandler(action, args);
    const ok = result?.ok !== false;
    publish({ status: ok ? "done" : "error", action, message: ok ? (result?.message || "Done") : (result?.error || "Action failed") });
    return result || { ok: true };
  } catch (error) {
    const message = String(error?.message || error);
    publish({ status: "error", action, message });
    return { ok: false, error: message };
  }
}

function describe(action, args) {
  if (action === "navigate") return `Opening ${args.surface || "surface"}`;
  if (action === "design") return "Updating the visual language";
  if (action === "pane") return `Opening ${args.tab || "tool"}`;
  return "Working";
}

