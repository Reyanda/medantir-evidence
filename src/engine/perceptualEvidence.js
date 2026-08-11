// perceptualEvidence.js — structured browser perception for the Electron webview.
//
// Cloud browsing performs the same capture server-side in medantir-bridge. This
// client version is intentionally serialisable so Electron can execute it inside
// the authenticated <webview> without moving cookies, passwords, or form values
// into the Medantir renderer.

export function capturePagePerception() {
  const MAX_ELEMENTS = 1800;
  const MAX_VECTORS = 2400;
  const MAX_TABLES = 40;
  const MAX_TEXT = 50000;
  const viewport = {
    width: window.innerWidth,
    height: window.innerHeight,
    scrollX: window.scrollX,
    scrollY: window.scrollY,
    devicePixelRatio: window.devicePixelRatio || 1,
    documentWidth: Math.max(document.documentElement.scrollWidth, document.body?.scrollWidth || 0),
    documentHeight: Math.max(document.documentElement.scrollHeight, document.body?.scrollHeight || 0),
  };
  const visible = (element, style, rect) => style.display !== "none"
    && style.visibility !== "hidden"
    && Number(style.opacity || 1) > 0
    && rect.width > 0 && rect.height > 0;
  const box = (rect) => ({
    x: Number((rect.left + window.scrollX).toFixed(2)),
    y: Number((rect.top + window.scrollY).toFixed(2)),
    width: Number(rect.width.toFixed(2)),
    height: Number(rect.height.toFixed(2)),
  });
  const textFor = (element) => {
    if (!element || element.matches?.('input,textarea,select,[contenteditable="true"]')) return "";
    return String(element.innerText || element.textContent || "").replace(/\s+/g, " ").trim().slice(0, 1200);
  };
  const safeHref = (value) => {
    if (!value) return undefined;
    try {
      const url = new URL(String(value), location.href);
      for (const key of [...url.searchParams.keys()]) {
        if (/(?:token|code|key|secret|session|auth|password|passwd|saml|assertion|ticket|state)/i.test(key)) url.searchParams.set(key, "[REDACTED]");
      }
      url.username = "";
      url.password = "";
      return url.toString().slice(0, 2000);
    } catch { return undefined; }
  };
  const semanticText = (element) => {
    const tag = element.tagName.toLowerCase();
    const semantic = /^(a|button|label|summary|th|td|caption|h[1-6]|p|li|figcaption|legend|option)$/i.test(tag)
      || element.getAttribute("role") || element.getAttribute("aria-label");
    if (!semantic && element.children.length) return "";
    return textFor(element).slice(0, 600);
  };

  const elements = [];
  let omittedElements = 0;
  for (const element of document.querySelectorAll("body *")) {
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    if (!visible(element, style, rect)) continue;
    if (elements.length >= MAX_ELEMENTS) { omittedElements += 1; continue; }
    const tag = element.tagName.toLowerCase();
    const entry = {
      id: `n${elements.length + 1}`,
      tag,
      role: element.getAttribute("role") || undefined,
      ariaLabel: element.getAttribute("aria-label") || undefined,
      text: semanticText(element) || undefined,
      box: box(rect),
      style: {
        display: style.display,
        position: style.position,
        color: style.color,
        backgroundColor: style.backgroundColor,
        borderColor: style.borderColor,
        borderWidth: style.borderWidth,
        borderRadius: style.borderRadius,
        fontFamily: style.fontFamily,
        fontSize: style.fontSize,
        fontWeight: style.fontWeight,
        lineHeight: style.lineHeight,
        textAlign: style.textAlign,
        opacity: style.opacity,
        transform: style.transform === "none" ? undefined : style.transform,
        zIndex: style.zIndex === "auto" ? undefined : style.zIndex,
      },
    };
    if (tag === "a") entry.href = safeHref(element.getAttribute("href"));
    if (element.matches("input,textarea,select")) {
      entry.control = {
        type: element.getAttribute("type") || tag,
        name: element.getAttribute("name") || undefined,
        disabled: Boolean(element.disabled),
        checked: "checked" in element ? Boolean(element.checked) : undefined,
        valueRedacted: true,
      };
    }
    if (tag === "img") entry.image = { alt: element.getAttribute("alt") || "", sourceRedacted: true };
    elements.push(entry);
  }

  const vectors = [];
  let omittedVectors = 0;
  for (const primitive of document.querySelectorAll("svg path,svg line,svg rect,svg circle,svg ellipse,svg polyline,svg polygon,svg text")) {
    if (vectors.length >= MAX_VECTORS) { omittedVectors += 1; continue; }
    const rect = primitive.getBoundingClientRect();
    const style = getComputedStyle(primitive);
    if (!visible(primitive, style, rect) && primitive.tagName.toLowerCase() !== "svg") continue;
    const attrs = {};
    for (const name of ["d","x","y","x1","y1","x2","y2","cx","cy","r","rx","ry","width","height","points","viewBox","fill","stroke","stroke-width","opacity","transform"]) {
      const value = primitive.getAttribute(name);
      if (value != null) attrs[name] = String(value).slice(0, name === "d" ? 6000 : 1200);
    }
    vectors.push({
      kind: primitive.tagName.toLowerCase(),
      box: box(rect),
      attrs,
      text: primitive.tagName.toLowerCase() === "text" ? textFor(primitive).slice(0, 400) : undefined,
    });
  }

  const tables = [...document.querySelectorAll("table")].slice(0, MAX_TABLES).map((table, tableIndex) => ({
    id: `table${tableIndex + 1}`,
    box: box(table.getBoundingClientRect()),
    caption: textFor(table.querySelector("caption")).slice(0, 300),
    rows: [...table.rows].slice(0, 120).map((row) => [...row.cells].slice(0, 80).map((cell) => ({
      text: textFor(cell),
      rowSpan: cell.rowSpan || 1,
      colSpan: cell.colSpan || 1,
      box: box(cell.getBoundingClientRect()),
    }))),
  }));

  const canvases = [...document.querySelectorAll("canvas")].slice(0, 120).map((canvas, index) => ({
    id: `canvas${index + 1}`,
    box: box(canvas.getBoundingClientRect()),
    width: canvas.width,
    height: canvas.height,
    vectorUnavailable: true,
  }));

  return {
    schema: "medantir.rendered-vector-scene.v1",
    viewport,
    elements,
    vectors,
    tables,
    canvases,
    text: String(document.body?.innerText || "").slice(0, MAX_TEXT),
    counts: {
      elements: elements.length,
      vectors: vectors.length,
      tables: tables.length,
      canvases: canvases.length,
      omittedElements,
      omittedVectors,
    },
    redaction: {
      formValues: "removed",
      imageSources: "removed",
      sensitiveUrlParameters: "redacted",
    },
  };
}

export function perceptualCaptureScript() {
  return `(${capturePagePerception.toString()})()`;
}

export function redactPerceptualUrl(value) {
  if (!value) return "";
  try {
    const url = new URL(String(value));
    for (const key of [...url.searchParams.keys()]) {
      if (/(?:token|code|key|secret|session|auth|password|passwd|saml|assertion|ticket|state)/i.test(key)) url.searchParams.set(key, "[REDACTED]");
    }
    url.username = "";
    url.password = "";
    return url.toString();
  } catch { return String(value).slice(0, 2000); }
}

export async function sha256Text(value) {
  if (!globalThis.crypto?.subtle) return null;
  const bytes = new TextEncoder().encode(String(value));
  const hash = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function snapshotForProject(snapshot) {
  if (!snapshot) return null;
  const { raster, ...rest } = snapshot;
  return {
    ...rest,
    raster: raster ? { mimeType: raster.mimeType, sha256: raster.sha256 || null, scope: raster.scope || "viewport", bytesOmitted: true } : undefined,
  };
}
