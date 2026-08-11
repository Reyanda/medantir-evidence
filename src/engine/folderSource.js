// folderSource.js — Local folder attachment, over two interchangeable backends.
//
// Desktop (Electron): routes through the __medantirDesktop__.workspace IPC
// surface, which resolves paths inside a per-project root with traversal and
// symlink guards and persists the mapping in project-workspaces.json. Folder
// attachment therefore survives restarts and needs no per-session picker.
//
// Browser (Chromium): falls back to the File System Access API, persisting
// FileSystemDirectoryHandle references in IndexedDB (the only browser store that
// accepts structured-cloneable handles).
//
// Both backends yield the same handle-shaped value and the same entry records,
// so callers (projectstore, ProjectsTab, ProjectFiles) stay backend-agnostic.

const DB_NAME = "medantir-folder-handles";
const DB_VERSION = 1;
const STORE_NAME = "handles";

// --- desktop workspace backend ----------------------------------------------

// Mirrors validateProjectId() in medantir-desktop/project-runtime.js. An id the
// main process would reject must fall through to the browser path rather than
// surface an IPC exception.
const DESKTOP_ID_PATTERN = /^[A-Za-z0-9_.-]{1,128}$/;

function desktopWorkspace() {
  if (typeof window === "undefined") return null;
  const desktop = window.__medantirDesktop__;
  return desktop?.isAvailable?.() && desktop.workspace ? desktop.workspace : null;
}

function desktopId(projectId) {
  const value = String(projectId || "");
  return DESKTOP_ID_PATTERN.test(value) ? value : null;
}

/** Wrap a workspace descriptor in a handle-shaped object callers can pass around. */
function desktopHandle(info) {
  if (!info?.root) return null;
  const name = String(info.root).split(/[\\/]/).filter(Boolean).pop() || info.root;
  return { __desktopWorkspace: true, projectId: info.projectId, root: info.root, name };
}

function isDesktopHandle(handle) {
  return !!handle && handle.__desktopWorkspace === true;
}

/** Attach `truncated` without making it a visible array element. */
function withTruncated(entries, truncated) {
  Object.defineProperty(entries, "truncated", { value: !!truncated, enumerable: false });
  return entries;
}

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => { req.result.createObjectStore(STORE_NAME); };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function withStore(mode, fn) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, mode);
    const store = tx.objectStore(STORE_NAME);
    const result = fn(store);
    tx.oncomplete = () => resolve(result && "result" in result ? result.result : result);
    tx.onerror = () => reject(tx.error);
  });
}

/** Store a directory handle keyed by project id. */
export async function storeFolderHandle(projectId, handle) {
  // The desktop backend already persists the mapping in project-workspaces.json;
  // duplicating it in IndexedDB would let the two stores drift apart.
  if (isDesktopHandle(handle)) return;
  await withStore("readwrite", (store) => store.put(handle, projectId));
}

/** Retrieve a stored directory handle, requesting read permission. */
export async function getFolderHandle(projectId) {
  const workspace = desktopWorkspace();
  const id = desktopId(projectId);
  if (workspace && id) {
    try {
      const info = await workspace.info(id);
      if (!info) return null; // no folder has ever been attached
      if (info.authorized && info.root) return desktopHandle(info);
      // Authorization is per app launch by design, so a configured project needs
      // the operator to re-consent before its files can be read again.
      if (info.configured) return desktopHandle(await workspace.authorize(id));
      return null;
    } catch {
      return null; // declined consent, or the mapped root no longer exists
    }
  }
  const handle = await withStore("readonly", (store) => store.get(projectId));
  if (!handle) return null;
  const opts = { mode: "read" };
  const ok = (await handle.queryPermission(opts)) === "granted"
    || (await handle.requestPermission(opts)) === "granted";
  return ok ? handle : null;
}

/** Remove a stored handle. */
export async function removeFolderHandle(projectId) {
  await withStore("readwrite", (store) => store.delete(projectId));
}

/**
 * Prompt the user to pick a local folder. Returns the handle or null.
 *
 * On desktop the native directory dialog can attach any existing folder
 * (~/Documents/IAGE, ~/Documents/QMUL PhD) and the choice is remembered; the
 * browser picker re-prompts each session.
 */
export async function pickLocalFolder(projectId, projectName) {
  const workspace = desktopWorkspace();
  const id = desktopId(projectId);
  if (workspace && id) {
    try {
      // select() opens the native dialog and authorizes the project on success,
      // so no separate authorize() call is needed here.
      return desktopHandle(await workspace.select(id, projectName));
    } catch {
      return null; // dialog dismissed, or consent refused
    }
  }
  if (typeof window === "undefined" || !window.showDirectoryPicker) return null;
  try {
    return await window.showDirectoryPicker({ mode: "read" });
  } catch {
    return null; // user cancelled
  }
}

/** Recursively list a bounded directory tree without ingesting file contents. */
export async function listFolderContents(handle, prefix = "", options = {}) {
  if (isDesktopHandle(handle)) {
    const listing = await desktopWorkspace().list(handle.projectId);
    return withTruncated(listing?.entries || [], listing?.truncated);
  }
  const state = options._state || { count: 0, truncated: false };
  const maxEntries = Number(options.maxEntries) || 2000;
  const maxDepth = Number(options.maxDepth) || 12;
  const depth = Number(options._depth) || 0;
  /** @type {Array<{path:string,name:string,kind:'file'|'directory',size?:number,modified?:number,type?:string}>} */
  const entries = [];
  const children = [];
  for await (const [name, entry] of handle.entries()) children.push([name, entry]);
  children.sort(([aName, a], [bName, b]) => a.kind === b.kind ? aName.localeCompare(bName) : (a.kind === "directory" ? -1 : 1));

  for (const [name, entry] of children) {
    if (state.count >= maxEntries) { state.truncated = true; break; }
    const full = prefix ? `${prefix}/${name}` : name;
    state.count += 1;
    if (entry.kind === "file") {
      try {
        const file = await entry.getFile();
        entries.push({ path: full, name, kind: "file", size: file.size, modified: file.lastModified, type: file.type || "" });
      } catch {
        entries.push({ path: full, name, kind: "file" });
      }
    } else if (entry.kind === "directory") {
      entries.push({ path: full, name, kind: "directory" });
      if (depth < maxDepth) {
        try {
          entries.push(...await listFolderContents(entry, full, { ...options, _state: state, _depth: depth + 1 }));
        } catch {
          // Keep the directory visible even when a child cannot be read.
        }
      }
    }
  }
  return withTruncated(entries, state.truncated);
}

/**
 * Read through the desktop bridge, re-consenting once if this app launch has not
 * authorized the project yet. Keeps the common path to a single IPC round trip.
 */
async function desktopRead(workspace, id, projectId, relativePath) {
  try {
    return await workspace.read(id, relativePath);
  } catch (error) {
    if (!/not been authorized/i.test(String(error?.message || ""))) throw error;
    if (!(await getFolderHandle(projectId))) throw new Error("Folder not available — re-attach it.");
    return workspace.read(id, relativePath);
  }
}

/** Read a file's text content from the attached folder. */
export async function readFolderFile(projectId, relativePath) {
  const workspace = desktopWorkspace();
  const id = desktopId(projectId);
  if (workspace && id) return (await desktopRead(workspace, id, projectId, relativePath))?.content ?? "";
  return (await readFolderFileObject(projectId, relativePath)).text();
}

/** Return the browser File object for local preview without persisting it. */
export async function readFolderFileObject(projectId, relativePath) {
  const workspace = desktopWorkspace();
  const id = desktopId(projectId);
  if (workspace && id) {
    // The workspace channel decodes as UTF-8, so binary payloads (PDF, DOCX)
    // cannot round-trip through it. Fail loudly rather than hand back a
    // corrupted File that the document extractor would silently mis-parse.
    if (!isReadableTextPath(relativePath)) {
      throw new Error("Binary preview is unavailable over the desktop workspace bridge — open this file natively.");
    }
    const file = await desktopRead(workspace, id, projectId, relativePath);
    return new File([file?.content ?? ""], relativePath.split("/").pop() || relativePath, { type: "text/plain" });
  }
  const handle = await getFolderHandle(projectId);
  if (!handle) throw new Error("Folder not available — re-attach it.");
  const segments = relativePath.split("/").filter(Boolean);
  let current = handle;
  for (let i = 0; i < segments.length - 1; i++) {
    current = await current.getDirectoryHandle(segments[i]);
  }
  const fileHandle = await current.getFileHandle(segments[segments.length - 1]);
  return fileHandle.getFile();
}

const TEXT_EXTENSIONS = new Set([
  "txt", "md", "markdown", "csv", "tsv", "json", "jsonl", "xml", "html", "htm", "css",
  "js", "jsx", "ts", "tsx", "py", "r", "sql", "sh", "yaml", "yml", "toml", "ini", "log",
  "tex", "bib", "ris", "env", "gitignore",
]);

export function isReadableTextPath(path, type = "") {
  if (String(type).startsWith("text/")) return true;
  if (["application/json", "application/xml", "application/x-ndjson"].includes(type)) return true;
  const name = String(path || "").split("/").pop() || "";
  const extension = name.includes(".") ? name.split(".").pop().toLowerCase() : name.toLowerCase();
  return TEXT_EXTENSIONS.has(extension);
}

export async function searchFolderContents(projectId, entries, query, k = 6, reader = readFolderFile) {
  const terms = String(query || "").toLowerCase().match(/[a-z0-9]{3,}/g) || [];
  if (!terms.length) return [];
  const candidates = (entries || [])
    .filter((entry) => entry.kind === "file" && isReadableTextPath(entry.path, entry.type) && (!entry.size || entry.size <= 2_000_000))
    .slice(0, 80);
  const hits = [];
  for (const entry of candidates) {
    try {
      const content = await reader(projectId, entry.path);
      const lower = content.toLowerCase();
      const score = terms.reduce((total, term) => total + lower.split(term).length - 1, 0);
      if (score > 0) hits.push({ path: entry.path, name: entry.name, score, snippet: makeSnippet(content, terms), source: "attached-folder" });
    } catch {
      // A single unreadable or changed file must not block the rest of the folder.
    }
  }
  return hits.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path)).slice(0, k);
}

function makeSnippet(content, terms, window = 420) {
  const text = String(content || "");
  const lower = text.toLowerCase();
  const indices = terms.map((term) => lower.indexOf(term)).filter((index) => index >= 0);
  const index = indices.length ? Math.min(...indices) : 0;
  const start = Math.max(0, index - Math.floor(window / 4));
  return `${start > 0 ? "…" : ""}${text.slice(start, start + window).trim()}${start + window < text.length ? "…" : ""}`;
}

/** Check whether either folder backend can serve this runtime. */
export function isFolderApiAvailable() {
  if (desktopWorkspace()) return true;
  return typeof window !== "undefined" && !!window.showDirectoryPicker;
}

/** Which backend is active — lets the UI explain what attaching a folder will do. */
export function folderBackend() {
  if (desktopWorkspace()) return "desktop";
  return typeof window !== "undefined" && window.showDirectoryPicker ? "browser" : "none";
}
