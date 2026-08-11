// vellumBrands.js — institutional palettes sourced from the Vellum brand registry.
//
// Vellum maintains 50 provenance-tracked university identities with semantic
// colour roles. Those roles line up with this app's design tokens, so a whole
// institutional identity can drive the interface without touching a component.
//
// R IS NOT REQUIRED HERE. The registry is compiled to JSON ahead of time by
// scripts/extract-vellum-brands.mjs; Vellum's R package is only needed to render
// figures, never to theme the UI.
//
// Applying a brand sets variables inline on <html>, which outranks the static
// html[data-palette="…"] rules in index.css. Selecting a built-in palette clears
// them again, so the two systems never fight.

import registry from "../data/vellum-brands.json";

export const VELLUM_BRAND_PREFIX = "vellum-";

export const VELLUM_GROUPS = {
  malawi_public: "Malawi public universities",
  russell_group: "Russell Group",
  usa_qs2027_top20: "United States (QS 2027 top 20)",
};

/** Brand-derived variables, cleared together so no stale role survives a switch. */
const MANAGED_VARIABLES = [
  "--color-brand-primary", "--color-brand-secondary",
  "--accent-rgb", "--accent-2-rgb", "--accent-3-rgb",
  "--color-text-primary", "--color-text-secondary",
  "--color-border-subtle", "--color-bg-surface", "--color-bg-canvas",
];

export function listVellumBrands() {
  return registry.brands || [];
}

export function getVellumBrand(id) {
  return listVellumBrands().find((brand) => brand.id === id) || null;
}

export function isVellumPalette(id) {
  return typeof id === "string" && id.startsWith(VELLUM_BRAND_PREFIX);
}

/** Convert "#RRGGBB" to the "r g b" triplet form the accent variables expect. */
export function hexToTriplet(hex) {
  const match = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(String(hex || "").trim());
  if (!match) return null;
  return `${parseInt(match[1], 16)} ${parseInt(match[2], 16)} ${parseInt(match[3], 16)}`;
}

export function clearVellumBrand(root = typeof document !== "undefined" ? document.documentElement : null) {
  // Callers may pass a minimal element stub without a style map; theming is
  // cosmetic and must never throw and take the whole design pass down with it.
  if (!root?.style?.removeProperty) return;
  for (const variable of MANAGED_VARIABLES) root.style.removeProperty(variable);
  root.removeAttribute?.("data-vellum-brand");
}

/**
 * Apply an institutional identity.
 *
 * Brand and accent roles apply in both appearances. The surface roles (ink,
 * surface, background, rule) are authored for light output, so applying them in
 * dark mode would paint a white canvas — they are used only in light mode, and
 * dark mode keeps its own surfaces with the institution's accents on top.
 */
export function applyVellumBrand(id, root = typeof document !== "undefined" ? document.documentElement : null, appearance = "dark") {
  const brand = getVellumBrand(id);
  if (!brand || !root?.style?.setProperty) return null;
  const { colours } = brand;
  const set = (variable, value) => { if (value) root.style.setProperty(variable, value); };

  clearVellumBrand(root);
  set("--color-brand-primary", colours.primary);
  set("--color-brand-secondary", colours.secondary);
  set("--accent-rgb", hexToTriplet(colours.primary));
  set("--accent-2-rgb", hexToTriplet(colours.accent || colours.secondary));
  set("--accent-3-rgb", hexToTriplet(colours.support_1 || colours.support_2 || colours.secondary));

  if (appearance === "light") {
    set("--color-text-primary", colours.ink);
    set("--color-text-secondary", colours.muted);
    set("--color-border-subtle", colours.rule);
    set("--color-bg-surface", colours.surface);
    set("--color-bg-canvas", colours.background);
  }

  root.setAttribute?.("data-vellum-brand", brand.id);
  return brand;
}

/** Brands grouped for a select element, in registry order. */
export function groupedVellumBrands() {
  const groups = new Map();
  for (const brand of listVellumBrands()) {
    const label = VELLUM_GROUPS[brand.group] || brand.group;
    if (!groups.has(label)) groups.set(label, []);
    groups.get(label).push(brand);
  }
  return [...groups.entries()].map(([label, brands]) => ({ label, brands }));
}
