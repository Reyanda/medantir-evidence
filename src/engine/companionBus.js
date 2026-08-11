// companionBus.js — where the companion lives and whether it may speak.
//
// The pet can sit in two places: floating anywhere on the workspace, or docked
// into the right tool rail. Both surfaces render from this one state so the pet
// is never in two places at once, and the choice survives a reload.
//
// `quiet` exists deliberately. An assistant that pops up unbidden and cannot be
// silenced is the single reason the genre got a bad name; suppression is a
// first-class setting here, not buried.

const DOCKED_KEY = "medantir.companion.docked.v1";
const QUIET_KEY = "medantir.companion.quiet.v1";

const readFlag = (key, fallback) => {
  try {
    const stored = localStorage.getItem(key);
    return stored === null ? fallback : stored === "true";
  } catch {
    return fallback;
  }
};
const writeFlag = (key, value) => {
  try { localStorage.setItem(key, String(value)); } catch { /* storage unavailable */ }
};

const listeners = new Set();
let state = { docked: readFlag(DOCKED_KEY, true), open: false, quiet: readFlag(QUIET_KEY, true) };

function publish(patch) {
  state = { ...state, ...patch };
  for (const listener of listeners) listener({ ...state });
}

export function getCompanionState() { return { ...state }; }

export function onCompanionState(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Dock into the right rail, or release back to floating. Docking closes the
 *  panel: the pet is being put away, so leaving its panel open contradicts that. */
export function setCompanionDocked(docked) {
  writeFlag(DOCKED_KEY, docked);
  publish({ docked, open: docked ? false : state.open });
}

export function setCompanionOpen(open) { publish({ open }); }
export function toggleCompanionOpen() { publish({ open: !state.open }); }

export function setCompanionQuiet(quiet) {
  writeFlag(QUIET_KEY, quiet);
  publish({ quiet });
}
