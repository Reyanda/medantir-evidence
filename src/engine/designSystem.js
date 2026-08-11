import { listBackgroundArtworks as _listBackgroundArtworks } from "./designAssets.js";
import { applyVellumBrand, clearVellumBrand, isVellumPalette, getVellumBrand } from "./vellumBrands.js";

const STORAGE_KEY = "medantir.design.v5";
const V4_STORAGE_KEY = "medantir.design.v4";
const PREVIOUS_STORAGE_KEY = "medantir.design.v3";
const V2_STORAGE_KEY = "medantir.design.v2";
const LEGACY_STORAGE_KEY = "medantir.design.v1";

export const DESIGN_LANGUAGES = [
  { id: "air", name: "Air" },
  { id: "clear", name: "Clear" },
  { id: "solid", name: "Solid" },
  { id: "glass", name: "Glass" },
  { id: "frosted", name: "Frosted" },
  { id: "brutalist", name: "Brutalist" },
  { id: "skeuomorphic", name: "Skeuomorphic" },
  { id: "studio", name: "Studio" },
];

export const UI_THEMES = [
  { id: "neutral", name: "Neutral" },
  { id: "paper", name: "Paper" },
  { id: "midnight", name: "Midnight" },
  { id: "sunset", name: "Sunset" },
];

export const PALETTES = [
  { id: "twilight", name: "Twilight" },
  { id: "cobalt", name: "Cobalt" },
  { id: "teal", name: "Teal" },
  { id: "violet", name: "Violet" },
  { id: "amber", name: "Amber" },
  { id: "rose", name: "Rose" },
  { id: "forest", name: "Forest" },
];

export const WORKSPACE_PRESETS = [
  {
    id: "studio-dark",
    name: "Studio Dark",
    description: "Dense dark evidence studio with restrained navy chrome and opaque surfaces.",
    settings: { language: "solid", theme: "midnight", palette: "teal", background: "plain", appearance: "dark", typography: "institutional", motion: "calm", transparency: "opaque" },
  },
  {
    id: "clinical-light",
    name: "Clinical Light",
    description: "Publication-oriented light workspace optimized for documents, evidence tables, and long review sessions.",
    settings: { language: "clear", theme: "neutral", palette: "teal", background: "plain", appearance: "light", typography: "institutional", motion: "calm", transparency: "opaque" },
  },
  {
    id: "focus-canvas",
    name: "Focus Canvas",
    description: "Light scientific canvas framed by dark tool rails for figures, scene graphs, and close inspection.",
    settings: { language: "solid", theme: "neutral", palette: "twilight", background: "plain", appearance: "light", typography: "institutional", motion: "calm", transparency: "opaque" },
  },
];

export function workspacePreset(id) {
  return WORKSPACE_PRESETS.find((preset) => preset.id === id) || null;
}

export function inferWorkspacePreset(settings = {}) {
  const match = WORKSPACE_PRESETS.find((preset) => Object.entries(preset.settings).every(([axis, value]) => settings[axis] === value));
  return match?.id || "custom";
}

export const BACKGROUNDS = [
  { id: "aurora", name: "Aurora", hint: "Drifting colour blooms" },
  { id: "calm", name: "Calm", hint: "Soft static gradient" },
  { id: "mesh", name: "Mesh", hint: "Rich multi-colour mesh" },
  { id: "plain", name: "Plain", hint: "Flat neutral" },
  { id: "vision-grey", name: "Vision Grey", hint: "Neutral spatial graphite glass" },
  { id: "gallery-art", name: "Gallery Art", hint: "NGA artwork behind glass" },
  { id: "kiki", name: "KIKI Blossom", hint: "Warm floral wash with floating blossoms" },
  { id: "nature-clean", name: "Clean Journal", hint: "Publication-neutral background" },
  { id: "cytoplasm", name: "Cytoplasm Warmth", hint: "Peach, cream, and rose wash" },
];

// Background imagery lives in the open registry rather than in a frozen array
// here, so a user can search for and apply their own image without a code change.
export { listBackgroundArtworks, artworkUrl } from "./designAssets.js";

export const APPEARANCES = [
  { id: "system", name: "System" },
  { id: "light", name: "Light" },
  { id: "dark", name: "Dark" },
];

export const TYPOGRAPHIES = [
  { id: "institutional", name: "Institutional" },
  { id: "editorial", name: "Editorial" },
  { id: "technical", name: "Technical" },
];

export const MOTIONS = [
  { id: "responsive", name: "Responsive" },
  { id: "calm", name: "Calm" },
  { id: "reduced", name: "Reduced" },
];

export const TRANSPARENCIES = [
  { id: "opaque", name: "Opaque" },
  { id: "translucent", name: "Translucent" },
  { id: "transparent", name: "Transparent" },
];

export const DEFAULT_DESIGN_SETTINGS = {
  workspacePreset: "clinical-light",
  ...workspacePreset("clinical-light").settings,
  backgroundArt: "peaceable-kingdom",
  backgroundArtOpacity: 0.18,
};

const V4_DEFAULT_DESIGN_SETTINGS = {
  language: "solid",
  theme: "neutral",
  palette: "twilight",
  background: "plain",
  backgroundArt: "peaceable-kingdom",
  backgroundArtOpacity: 0.34,
  appearance: "system",
  typography: "institutional",
  motion: "calm",
  transparency: "opaque",
};

const LEGACY_DEFAULT_DESIGN_SETTINGS = {
  language: "clear",
  theme: "neutral",
  palette: "cobalt",
  background: "aurora",
  backgroundArt: "peaceable-kingdom",
  backgroundArtOpacity: 0.55,
  appearance: "dark",
  typography: "institutional",
  motion: "responsive",
  transparency: "transparent",
};

const V3_DEFAULT_DESIGN_SETTINGS = {
  language: "glass",
  theme: "neutral",
  palette: "cobalt",
  background: "aurora",
  backgroundArt: "peaceable-kingdom",
  backgroundArtOpacity: 0.55,
  appearance: "dark",
  typography: "institutional",
  motion: "responsive",
  transparency: "transparent",
};

// backgroundArt is intentionally absent: its permitted values come from the
// live asset registry, which grows whenever a user adds an image.
const AXES = {
  language: DESIGN_LANGUAGES,
  theme: UI_THEMES,
  palette: PALETTES,
  background: BACKGROUNDS,
  appearance: APPEARANCES,
  typography: TYPOGRAPHIES,
  motion: MOTIONS,
  transparency: TRANSPARENCIES,
};

export function normaliseDesignSettings(settings = {}) {
  const requestedPreset = workspacePreset(settings.workspacePreset);
  const next = { ...DEFAULT_DESIGN_SETTINGS, ...(requestedPreset?.settings || {}) };
  for (const [axis, values] of Object.entries(AXES)) {
    if (values.some((value) => value.id === settings[axis])) next[axis] = settings[axis];
  }
  if (isVellumPalette(settings.palette) && getVellumBrand(settings.palette)) next.palette = settings.palette;
  if (_listBackgroundArtworks().some((asset) => asset.id === settings.backgroundArt)) {
    next.backgroundArt = settings.backgroundArt;
  }
  const opacity = Number(settings.backgroundArtOpacity);
  if (Number.isFinite(opacity)) next.backgroundArtOpacity = Math.min(0.78, Math.max(0.08, opacity));
  next.workspacePreset = inferWorkspacePreset(next);
  return next;
}


export function migrateV4DesignSettings(settings = {}) {
  const untouchedV4 = Object.entries(V4_DEFAULT_DESIGN_SETTINGS)
    .every(([axis, value]) => settings[axis] === undefined || settings[axis] === value);
  return untouchedV4 ? { ...DEFAULT_DESIGN_SETTINGS } : normaliseDesignSettings(settings);
}

export function migrateV3DesignSettings(settings = {}) {
  // v3 shipped with glass + transparent + animated aurora as the untouched
  // default. That made every surface compete visually with its content. Only the
  // exact old default is migrated; deliberate custom choices are preserved.
  const untouchedV3 = Object.entries(V3_DEFAULT_DESIGN_SETTINGS)
    .every(([axis, value]) => settings[axis] === undefined || settings[axis] === value);
  return untouchedV3 ? { ...DEFAULT_DESIGN_SETTINGS } : normaliseDesignSettings(settings);
}

export function migrateLegacyDesignSettings(settings = {}) {
  const legacy = normaliseDesignSettings(settings);
  const wasUntouchedDefault = Object.entries(LEGACY_DEFAULT_DESIGN_SETTINGS)
    .every(([axis, value]) => settings[axis] === undefined || settings[axis] === value);
  return migrateV2DesignSettings({
    ...settings,
    language: wasUntouchedDefault ? "glass" : legacy.language,
  });
}

export function migrateV2DesignSettings(settings = {}) {
  if (TRANSPARENCIES.some((value) => value.id === settings.transparency)) {
    return normaliseDesignSettings(settings);
  }
  const migrated = normaliseDesignSettings(settings);
  const transparencyByLanguage = {
    glass: "transparent",
    studio: "transparent",
    frosted: "translucent",
  };
  return {
    ...migrated,
    transparency: transparencyByLanguage[migrated.language] || "opaque",
  };
}

export function loadDesignSettings() {
  if (typeof localStorage === "undefined") return { ...DEFAULT_DESIGN_SETTINGS };
  try {
    const current = localStorage.getItem(STORAGE_KEY);
    if (current) return normaliseDesignSettings(JSON.parse(current));
    const v4 = localStorage.getItem(V4_STORAGE_KEY);
    if (v4) {
      const migrated = migrateV4DesignSettings(JSON.parse(v4));
      localStorage.setItem(STORAGE_KEY, JSON.stringify(migrated));
      return migrated;
    }
    const previous = localStorage.getItem(PREVIOUS_STORAGE_KEY);
    if (previous) {
      const migrated = migrateV3DesignSettings(JSON.parse(previous));
      localStorage.setItem(STORAGE_KEY, JSON.stringify(migrated));
      return migrated;
    }
    const v2 = localStorage.getItem(V2_STORAGE_KEY);
    if (v2) {
      const migrated = migrateV2DesignSettings(JSON.parse(v2));
      localStorage.setItem(STORAGE_KEY, JSON.stringify(migrated));
      return migrated;
    }
    const legacy = localStorage.getItem(LEGACY_STORAGE_KEY);
    if (!legacy) return { ...DEFAULT_DESIGN_SETTINGS };
    const migrated = migrateLegacyDesignSettings(JSON.parse(legacy));
    localStorage.setItem(STORAGE_KEY, JSON.stringify(migrated));
    return migrated;
  }
  catch { return { ...DEFAULT_DESIGN_SETTINGS }; }
}

export function saveDesignSettings(patch) {
  const current = loadDesignSettings();
  let requested;
  const preset = workspacePreset(patch.workspacePreset);
  if (preset) {
    requested = { ...current, ...preset.settings, workspacePreset: preset.id };
  } else {
    requested = { ...current, ...patch };
    if (Object.keys(patch).some((key) => key !== "workspacePreset")) requested.workspacePreset = "custom";
  }
  const next = normaliseDesignSettings(requested);
  if (typeof localStorage !== "undefined") {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch { /* non-critical preference */ }
  }
  return next;
}

export function resolveAppearance(settings = DEFAULT_DESIGN_SETTINGS, prefersDark) {
  if (settings.appearance === "light" || settings.appearance === "dark") return settings.appearance;
  if (typeof prefersDark === "boolean") return prefersDark ? "dark" : "light";
  if (typeof matchMedia !== "undefined") return matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  return "dark";
}

export function applyDesignSettings(settings, root = typeof document !== "undefined" ? document.documentElement : null, prefersDark) {
  const next = normaliseDesignSettings(settings);
  const appearance = resolveAppearance(next, prefersDark);
  if (!root) return appearance;
  root.setAttribute("data-design-language", next.language);
  root.setAttribute("data-ui-theme", next.theme);
  root.setAttribute("data-palette", next.palette);
  root.setAttribute("data-background", next.background);
  root.setAttribute("data-appearance", next.appearance);
  root.setAttribute("data-typography", next.typography);
  root.setAttribute("data-motion", next.motion);
  root.setAttribute("data-transparency", next.transparency);
  root.setAttribute("data-workspace-preset", next.workspacePreset || "custom");
  root.classList.toggle("dark", appearance === "dark");
  // Inline brand variables outrank the static palette rules, so they are applied
  // after the attributes and cleared whenever a built-in palette is selected.
  if (isVellumPalette(next.palette)) applyVellumBrand(next.palette, root, appearance);
  else clearVellumBrand(root);
  return appearance;
}
