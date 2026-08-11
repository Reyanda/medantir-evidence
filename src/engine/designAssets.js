// designAssets.js — open registry for design imagery.
//
// The background artwork used to be a frozen list of three museum pieces, so a
// user who wanted something else — a national flag, a lab photo, a client's brand
// image — had no route to it. This turns imagery into a registry: built-in entries
// ship with the app, and anyone can search an open image catalogue or paste a URL
// to add their own. Every design language draws from the same registry, so none of
// them hardcode a picture.
//
// NETWORK: searching is the only outbound call here, it happens solely when the
// user types a query, and the query text goes to the catalogue being searched.
// Nothing is uploaded, and results are stored as URLs — the image itself is never
// copied into local storage.

const KEY = "medantir.designAssets.v1";

// Shipped entries. iiifBase entries are resolved through the IIIF image API;
// anything else carries a direct url.
export const BUILT_IN_ARTWORKS = [
  { id: "mrs-gray", name: "The Hon. Mrs. Gray", artist: "Daniel Gardner", date: "c. 1785/1790", iiifBase: "https://api.nga.gov/iiif/4373e800-f8f6-45a6-848f-3d9e6150170f", source: "National Gallery of Art" },
  { id: "westwood-children", name: "The Westwood Children", artist: "Joshua Johnson", date: "c. 1807", iiifBase: "https://api.nga.gov/iiif/3985dde4-8475-4df9-8ef8-5829de574a26", source: "National Gallery of Art" },
  { id: "peaceable-kingdom", name: "Peaceable Kingdom", artist: "Edward Hicks", date: "c. 1834", iiifBase: "https://api.nga.gov/iiif/d74e4c52-044a-48e7-a549-1f2d95d311b4", source: "National Gallery of Art" },
];

const _listeners = new Set();
let _mem = null;

function notify() {
  for (const listener of _listeners) listener();
}

export function onDesignAssetsChanged(listener) {
  _listeners.add(listener);
  return () => _listeners.delete(listener);
}

function readCustom() {
  if (typeof localStorage === "undefined") return _mem || [];
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY) || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeCustom(assets) {
  if (typeof localStorage === "undefined") { _mem = assets; notify(); return; }
  try { localStorage.setItem(KEY, JSON.stringify(assets)); } catch { /* quota */ }
  notify();
}

/** Built-in entries plus everything the user has added. */
export function listBackgroundArtworks() {
  return [...BUILT_IN_ARTWORKS, ...readCustom()];
}

export function listCustomArtworks() {
  return readCustom();
}

export function getBackgroundArtwork(id) {
  return listBackgroundArtworks().find((asset) => asset.id === id) || null;
}

/**
 * Resolve an asset to a displayable URL. IIIF entries get a sized derivative;
 * everything else is used as supplied.
 */
export function artworkUrl(asset, { width = 1800, height = 1200 } = {}) {
  if (!asset) return "";
  if (asset.iiifBase) return `${asset.iiifBase}/full/!${width},${height}/0/default.jpg`;
  return asset.url || "";
}

const HTTPS_URL = /^https:\/\/[^\s]+$/i;

/**
 * Add an image to the registry.
 *
 * HTTPS only: the ambient layer renders these on every screen, so a plain-http
 * asset would downgrade the page and a javascript:/data: value would be an
 * injection route into a CSS url().
 */
export function addBackgroundArtwork({ name, url, artist = "", date = "", source = "Custom", license = "" }) {
  const address = String(url || "").trim();
  if (!HTTPS_URL.test(address)) return { ok: false, error: "Enter a full https:// image address." };
  const custom = readCustom();
  if (custom.some((asset) => asset.url === address)) return { ok: false, error: "That image is already in the registry." };
  const asset = {
    id: `custom_${Date.now()}_${Math.floor(Math.random() * 1e6)}`,
    name: String(name || "Custom image").slice(0, 120),
    artist: String(artist || "").slice(0, 120),
    date: String(date || "").slice(0, 60),
    source: String(source || "Custom").slice(0, 80),
    license: String(license || "").slice(0, 120),
    url: address,
    custom: true,
    added: Date.now(),
  };
  writeCustom([...custom, asset]);
  return { ok: true, asset };
}

/** Remove a user-added image. Built-ins cannot be removed, only unselected. */
export function removeBackgroundArtwork(id) {
  const custom = readCustom();
  if (!custom.some((asset) => asset.id === id)) return { ok: false, error: "Only images you added can be removed." };
  writeCustom(custom.filter((asset) => asset.id !== id));
  return { ok: true };
}

// --- image search ------------------------------------------------------------

const SEARCH_TIMEOUT = 12000;

async function getJson(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SEARCH_TIMEOUT);
  try {
    const response = await fetch(url, { signal: controller.signal, headers: { Accept: "application/json" } });
    if (!response.ok) throw new Error(`Search failed (${response.status})`);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Wikimedia Commons — no API key, CORS-enabled, and comprehensive for flags,
 * maps, diagrams, and public-domain artwork.
 */
async function searchCommons(query) {
  const url = "https://commons.wikimedia.org/w/api.php"
    + "?action=query&format=json&origin=*&generator=search&gsrnamespace=6"
    + `&gsrsearch=${encodeURIComponent(query)}&gsrlimit=24`
    + "&prop=imageinfo&iiprop=url|extmetadata&iiurlwidth=360";
  const data = await getJson(url);
  return Object.values(data?.query?.pages || []).map((page) => {
    const info = page.imageinfo?.[0] || {};
    const meta = info.extmetadata || {};
    return {
      key: `commons:${page.pageid}`,
      name: String(page.title || "").replace(/^File:/, "").replace(/\.[a-z0-9]+$/i, ""),
      url: info.url || "",
      thumbUrl: info.thumburl || info.url || "",
      artist: String(meta.Artist?.value || "").replace(/<[^>]*>/g, "").slice(0, 120),
      license: String(meta.LicenseShortName?.value || "").slice(0, 80),
      source: "Wikimedia Commons",
    };
  }).filter((result) => result.url.startsWith("https://"));
}

/** Openverse — openly licensed photography, complements Commons. */
async function searchOpenverse(query) {
  const url = `https://api.openverse.org/v1/images/?q=${encodeURIComponent(query)}&page_size=24`;
  const data = await getJson(url);
  return (data?.results || []).map((item) => ({
    key: `openverse:${item.id}`,
    name: String(item.title || "Untitled").slice(0, 120),
    url: item.url || "",
    thumbUrl: item.thumbnail || item.url || "",
    artist: String(item.creator || "").slice(0, 120),
    license: String(item.license || "").toUpperCase().slice(0, 80),
    source: "Openverse",
  })).filter((result) => result.url.startsWith("https://"));
}

export const IMAGE_SOURCES = [
  { id: "commons", name: "Wikimedia Commons", hint: "Flags, maps, diagrams, public-domain art" },
  { id: "openverse", name: "Openverse", hint: "Openly licensed photography" },
];

/**
 * Search an open image catalogue. Returns results the caller can preview and
 * then commit with addBackgroundArtwork. A failing source yields an error rather
 * than silently returning nothing, so the UI can say what went wrong.
 */
export async function searchImages(query, { source = "commons" } = {}) {
  const text = String(query || "").trim();
  if (text.length < 2) return { ok: false, error: "Type at least two characters to search.", results: [] };
  try {
    const results = source === "openverse" ? await searchOpenverse(text) : await searchCommons(text);
    return { ok: true, results };
  } catch (error) {
    const aborted = error?.name === "AbortError";
    return {
      ok: false,
      error: aborted ? "The image search timed out." : `Image search unavailable: ${error?.message || "network error"}.`,
      results: [],
    };
  }
}
