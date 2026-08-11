// vellumEngine.js — Vellum R Execution and Palette Engine Bridge.
//
// Combines zero-dependency brand palette resolution with Electron IPC system R
// figure rendering via /usr/local/bin/Rscript.

import { getVellumBrand } from "./vellumBrands.js";

/** Check if desktop Rscript execution bridge is present */
export function isDesktopRAvailable() {
  return typeof window !== "undefined" && Boolean(window.__medantirDesktop__?.vellum?.render);
}

/** Retrieve brand palette for instant client-side rendering (zero R dependency) */
export function getVellumBrandPalette(brandId = "vellum-qmul") {
  return getVellumBrand(brandId) || getVellumBrand("vellum-qmul");
}

/** Render publication figure via system Rscript when in Electron desktop */
export async function renderVellumFigure({ projectId, rScriptPath, brandId = "vellum-qmul" }) {
  if (!isDesktopRAvailable()) {
    return {
      ok: false,
      error: "System R rendering is available in Medantir Desktop. Install R (Rscript) or run from Terminal: Rscript " + rScriptPath,
      standaloneScript: rScriptPath,
    };
  }

  try {
    const result = await window.__medantirDesktop__.vellum.render({ projectId, rScriptPath, brandId });
    return result;
  } catch (err) {
    return { ok: false, error: err.message || "Failed to execute Rscript" };
  }
}
