// projectstore.js — canonical durable Project store.
//
// A Project owns the complete working context: metadata, operating mode, tasks,
// files, review state, and orchestration runs. The v2 loader imports both former
// stores additively and leaves their keys untouched for rollback.

import { MODULES } from "./modules.js";
import { defaultMode, modeFromDomain, resolveProjectMode } from "./operatingModes.js";

const KEY = "medantir.workspace.v2";
const LEGACY_WORKSPACE_KEY = "medantir.workspace.v1";
const LEGACY_PROJECTS_KEY = "medantir.projects.v1";
const ACTIVE_KEY = "medantir.workspace.active";
const VERSION = 2;
const CANVAS_VERSION = 1;
export const STATUSES = ["backlog", "scoping", "active", "blocked", "done"];

// Plan metadata. A project and a roadmap work package are the same object: the
// plan fields describe where it sits in the breakdown, the rest of the record
// describes the workspace it owns (folder, files, runs). Keeping one entity is
// what lets a roadmap row carry a real folder instead of pointing at one.
//
// STATUSES above stays the single status vocabulary — the roadmap view renders
// display labels for it rather than storing a competing set.
export const PLAN_TYPES = ["Phase", "Task", "Feature", "Milestone"];
export const PLAN_PRIORITIES = ["Immediate", "High", "Medium", "Low"];
export const DEFAULT_TENANT = "tenant_personal";

function normalisePlan(plan = {}) {
  const source = plan && typeof plan === "object" ? plan : {};
  return {
    parent: source.parent ?? null,
    pillar: typeof source.pillar === "string" ? source.pillar : "",
    type: PLAN_TYPES.includes(source.type) ? source.type : "Task",
    priority: PLAN_PRIORITIES.includes(source.priority) ? source.priority : "Medium",
    // Quarters as "YYYY-Qn"; empty means unscheduled, which the timeline shows
    // explicitly rather than inventing a date.
    start: typeof source.start === "string" ? source.start : "",
    end: typeof source.end === "string" ? source.end : "",
    hours: Math.max(0, Number(source.hours) || 0),
    assignee: typeof source.assignee === "string" ? source.assignee : "",
  };
}
export const PROJECT_TYPES = [
  { id: "general", name: "General", short: "GEN", description: "Everyday work, notes, files, and mixed tasks." },
  { id: "systematic-review", name: "Systematic / evidence review", short: "SR", description: "Protocols, searches, screening, synthesis, GRADE, and review outputs." },
  { id: "research", name: "Research", short: "RES", description: "Research projects that are not evidence reviews." },
  { id: "cybersecurity", name: "Cyber security", short: "CYB", description: "Defensive security, assurance, incidents, and technical evidence." },
  { id: "browsing", name: "Browsing and day-to-day", short: "WEB", description: "Saved browsing, reading, and routine personal work." },
];
export const PROJECT_LANGUAGES = [
  { id: "auto", name: "Automatic / multilingual" },
  { id: "en", name: "English" },
  { id: "fr", name: "Français" },
  { id: "es", name: "Español" },
  { id: "pt", name: "Português" },
  { id: "ar", name: "العربية" },
  { id: "zh", name: "中文" },
  { id: "hi", name: "हिन्दी" },
  { id: "sw", name: "Kiswahili" },
  { id: "ny", name: "Chichewa" },
];
const PROJECT_TYPE_IDS = new Set(PROJECT_TYPES.map((type) => type.id));

let _mem = null;
let _active = null;
let _tid = 0;
const _activeListeners = new Set();
const _projectListeners = new Set();
let _projectChangeScheduled = false;

const uid = (prefix) => `${prefix}_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
const slug = (value) => String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48);
const emptyDb = () => ({ version: VERSION, projects: {}, migration: null });

function parse(raw, fallback) {
  try { return JSON.parse(raw || "") || fallback; } catch { return fallback; }
}

function moduleMeta(id) {
  return MODULES.find((module) => module.id === id) || null;
}

function normaliseCanvas(canvas) {
  if (!canvas || typeof canvas !== "object") return null;
  return {
    version: CANVAS_VERSION,
    panels: Array.isArray(canvas.panels) ? canvas.panels.filter((panel) => panel?.id && panel?.type) : [],
    savedAt: Number(canvas.savedAt) || null,
    audit: Array.isArray(canvas.audit) ? canvas.audit.slice(-100) : [],
  };
}

function inferProjectType(project, fallbackId) {
  if (PROJECT_TYPE_IDS.has(project.projectType)) return project.projectType;
  const files = project.files && typeof project.files === "object" ? project.files : {};
  const hasReviewArtifact = !!project.review
    || Object.values(files).some((file) => file?.type === "review" || file?.path === "review.json")
    || project.id === "systematic-review"
    || fallbackId === "systematic-review";
  return hasReviewArtifact ? "systematic-review" : "general";
}

function normaliseProject(project = {}, fallbackId) {
  const now = Date.now();
  const meta = moduleMeta(project.id || fallbackId);
  const domain = project.domain || meta?.domain || "custom";
  const files = project.files && typeof project.files === "object" ? project.files : {};
  return {
    id: project.id || fallbackId || uid("proj"),
    name: project.name || meta?.name || "Untitled project",
    projectType: inferProjectType(project, fallbackId),
    workingLanguage: PROJECT_LANGUAGES.some((language) => language.id === project.workingLanguage) ? project.workingLanguage : "auto",
    mode: resolveProjectMode({ mode: project.mode, domain }),
    domain,
    status: STATUSES.includes(project.status) ? project.status : "active",
    note: project.note || meta?.note || "",
    capabilities: Array.isArray(project.capabilities) ? project.capabilities : (meta?.capabilities || []),
    repo: project.repo || meta?.repo || null,
    api: project.api || meta?.api || null,
    localFolder: project.localFolder || null,
    githubRepo: project.githubRepo || null,
    moduleStatus: project.moduleStatus || meta?.status || null,
    military: project.military ?? !!meta?.military,
    custom: project.custom ?? !meta,
    files,
    tasks: Array.isArray(project.tasks) ? project.tasks : [],
    review: project.review || null,
    runs: Array.isArray(project.runs) ? project.runs : [],
    transcripts: Array.isArray(project.transcripts) ? project.transcripts.filter((entry) => entry?.id && entry?.role).slice(-300) : [],
    schedule: project.schedule || null,
    plan: normalisePlan(project.plan),
    tenantId: project.tenantId || DEFAULT_TENANT,
    canvas: normaliseCanvas(project.canvas),
    detached: !!project.detached,
    archivedAt: project.detached ? (Number(project.archivedAt) || Number(project.updated) || now) : null,
    restoredAt: Number(project.restoredAt) || null,
    created: project.created || project.createdAt || project.updated || now,
    updated: project.updated || now,
    provenance: project.provenance || { origin: meta ? "module-template" : "user", importedFrom: [] },
  };
}

function findByName(projects, name) {
  const key = slug(name);
  return Object.values(projects).find((project) => slug(project.name) === key);
}

export function migrateWorkspace(workspaceV1 = {}, projectsV1 = {}) {
  const db = emptyDb();
  const importedAt = Date.now();

  for (const [id, raw] of Object.entries(workspaceV1?.projects || {})) {
    const project = normaliseProject({ ...raw, id: raw.id || id }, raw.id || id);
    project.provenance = { ...(project.provenance || {}), importedFrom: [LEGACY_WORKSPACE_KEY] };
    db.projects[project.id] = project;
  }

  for (const [id, raw] of Object.entries(projectsV1 || {})) {
    const meta = moduleMeta(id);
    const name = raw.name || meta?.name || id;
    const existing = db.projects[id] || findByName(db.projects, name);
    if (existing) {
      db.projects[existing.id] = normaliseProject({
        ...existing,
        ...raw,
        id: existing.id,
        name: existing.name || name,
        mode: raw.mode || modeFromDomain(raw.domain || existing.domain),
        files: existing.files,
        tasks: raw.tasks || existing.tasks,
        provenance: {
          ...(existing.provenance || {}),
          importedFrom: [...new Set([...(existing.provenance?.importedFrom || []), LEGACY_PROJECTS_KEY])],
        },
      }, existing.id);
      continue;
    }
    const project = normaliseProject({ ...raw, id, name }, id);
    project.provenance = { ...(project.provenance || {}), importedFrom: [LEGACY_PROJECTS_KEY] };
    db.projects[project.id] = project;
  }

  db.migration = {
    version: VERSION,
    importedAt,
    sources: [LEGACY_WORKSPACE_KEY, LEGACY_PROJECTS_KEY],
    retainedLegacyKeys: true,
  };
  return db;
}

function validDb(db) {
  return db && db.version === VERSION && db.projects && typeof db.projects === "object";
}

function _load() {
  if (typeof localStorage === "undefined") return (_mem ||= emptyDb());
  const current = parse(localStorage.getItem(KEY), null);
  if (validDb(current)) {
    const needsPurposeUpgrade = Object.values(current.projects).some((project) => !PROJECT_TYPE_IDS.has(project?.projectType));
    if (!needsPurposeUpgrade) return current;
    const upgraded = {
      ...current,
      projects: Object.fromEntries(Object.entries(current.projects).map(([id, project]) => [id, normaliseProject(project, id)])),
      migration: { ...(current.migration || {}), projectTypeAddedAt: Date.now() },
    };
    _save(upgraded);
    return upgraded;
  }

  const legacyWorkspace = parse(localStorage.getItem(LEGACY_WORKSPACE_KEY), { projects: {} });
  const legacyProjects = parse(localStorage.getItem(LEGACY_PROJECTS_KEY), {});
  const migrated = migrateWorkspace(legacyWorkspace, legacyProjects);
  _save(migrated);
  return migrated;
}

function _save(db) {
  if (typeof localStorage === "undefined") { _mem = db; return; }
  try { localStorage.setItem(KEY, JSON.stringify(db)); } catch { /* large binaries belong in IndexedDB/S3 */ }
  if (!_projectChangeScheduled && _projectListeners.size) {
    _projectChangeScheduled = true;
    queueMicrotask(() => {
      _projectChangeScheduled = false;
      for (const listener of _projectListeners) listener();
    });
  }
}

export function onProjectsChanged(listener) {
  _projectListeners.add(listener);
  return () => _projectListeners.delete(listener);
}

export function setActiveProject(id) {
  const next = id && getProject(id)?.detached ? null : (id || null);
  _active = next;
  if (typeof localStorage !== "undefined") {
    try { localStorage.setItem(ACTIVE_KEY, next || ""); } catch { /* ignore */ }
  }
  for (const listener of _activeListeners) listener(_active);
}

export function onActiveProject(listener) {
  _activeListeners.add(listener);
  return () => _activeListeners.delete(listener);
}

export function activeProject() {
  if (_active) return getProject(_active)?.detached ? null : _active;
  if (typeof localStorage !== "undefined") {
    try {
      const stored = localStorage.getItem(ACTIVE_KEY) || null;
      return stored && !getProject(stored)?.detached ? stored : null;
    } catch { return null; }
  }
  return null;
}

function visibleProjects() {
  return Object.values(_load().projects)
    // Legacy module catalogue records are connectors, not user projects. Keep
    // their stored data intact for rollback, but never render them as projects.
    .filter((project) => project.provenance?.origin !== "module-template");
}

export function listProjects() {
  return visibleProjects()
    .filter((project) => !project.detached)
    .map((project) => ({ ...project, files: Object.keys(project.files || {}).length }))
    .sort((a, b) => (b.updated || 0) - (a.updated || 0));
}

export function listArchivedProjects() {
  return visibleProjects()
    .filter((project) => project.detached)
    .map((project) => ({ ...project, files: Object.keys(project.files || {}).length }))
    .sort((a, b) => (b.archivedAt || b.updated || 0) - (a.archivedAt || a.updated || 0));
}

export function getProject(id) {
  return _load().projects[id] || null;
}

export function getCanvasComposition(id) {
  return normaliseCanvas(getProject(id)?.canvas) || { version: CANVAS_VERSION, panels: [], savedAt: null, audit: [] };
}

export function recordCanvasEvent(id, event, label) {
  const project = getProject(id);
  if (!project) return null;
  const canvas = getCanvasComposition(id);
  const entry = { id: uid("canvas_event"), event, label: String(label || event).slice(0, 180), at: Date.now() };
  updateProject(id, { canvas: { ...canvas, audit: [...canvas.audit, entry].slice(-100) } });
  return entry;
}

export function saveCanvasComposition(id, composition = {}) {
  const project = getProject(id);
  if (!project) return null;
  const current = getCanvasComposition(id);
  const savedAt = Date.now();
  const panels = Array.isArray(composition.panels) ? composition.panels.filter((panel) => panel?.id && panel?.type) : [];
  const entry = { id: uid("canvas_event"), event: "composition-saved", label: `Saved ${panels.length} visual panel${panels.length === 1 ? "" : "s"}`, at: savedAt };
  return updateProject(id, { canvas: { version: CANVAS_VERSION, panels, savedAt, audit: [...current.audit, entry].slice(-100) } })?.canvas || null;
}

export function createProject(name, options = {}) {
  const db = _load();
  const id = options.id || uid("proj");
  const domain = options.domain || "custom";
  db.projects[id] = normaliseProject({
    ...options,
    id,
    name: name || "Untitled project",
    domain,
    mode: options.mode || modeFromDomain(domain) || defaultMode(),
    status: options.status || "scoping",
    custom: options.custom ?? true,
    created: Date.now(),
    updated: Date.now(),
  }, id);
  _save(db);
  return db.projects[id];
}

export function updateProject(id, patch) {
  const db = _load();
  const project = db.projects[id];
  if (!project) return null;
  db.projects[id] = normaliseProject({ ...project, ...patch, id, files: patch.files || project.files, updated: Date.now() }, id);
  _save(db);
  return db.projects[id];
}

export function setProjectMode(id, mode) {
  return updateProject(id, { mode });
}

export function getProjectType(id) {
  return PROJECT_TYPES.find((type) => type.id === id) || PROJECT_TYPES[0];
}

export function isReviewProject(project) {
  return !!project && project.projectType === "systematic-review";
}

export function setProjectType(id, projectType) {
  return updateProject(id, { projectType: PROJECT_TYPE_IDS.has(projectType) ? projectType : "general" });
}

export function setProjectLanguage(id, workingLanguage) {
  const value = PROJECT_LANGUAGES.some((language) => language.id === workingLanguage) ? workingLanguage : "auto";
  return updateProject(id, { workingLanguage: value });
}

export function addTask(id, text) {
  const project = getProject(id);
  if (!project || !String(text || "").trim()) return null;
  const tasks = [...project.tasks, { id: `t${Date.now()}-${++_tid}`, text: String(text).trim(), done: false }];
  return updateProject(id, { tasks });
}

export function toggleTask(id, taskId) {
  const project = getProject(id);
  if (!project) return null;
  return updateProject(id, { tasks: project.tasks.map((task) => task.id === taskId ? { ...task, done: !task.done } : task) });
}

export function addProjectRun(id, run) {
  const project = getProject(id);
  if (!project || !run?.id) return null;
  return updateProject(id, { runs: [...project.runs, run] });
}

export function updateProjectRun(id, runId, patch) {
  const project = getProject(id);
  if (!project) return null;
  const runs = project.runs.map((run) => run.id === runId ? { ...run, ...patch, updatedAt: Date.now() } : run);
  updateProject(id, { runs });
  return getProject(id)?.runs.find((run) => run.id === runId) || null;
}

export function getProjectRun(id, runId) {
  return getProject(id)?.runs.find((run) => run.id === runId) || null;
}

export function archiveProject(id) {
  const project = getProject(id);
  if (!project) return null;
  const archived = updateProject(id, { detached: true, archivedAt: Date.now() });
  if (activeProject() === id || _active === id) setActiveProject(null);
  return archived;
}

export function restoreProject(id) {
  const project = getProject(id);
  if (!project) return null;
  return updateProject(id, { detached: false, archivedAt: null, restoredAt: Date.now() });
}

export function setDetached(id, detached) {
  return detached ? archiveProject(id) : restoreProject(id);
}

export async function scheduleProject(id, whenISO, title) {
  updateProject(id, { schedule: whenISO });
  try {
    const { callModule } = await import("./modules.js");
    const result = await callModule("ascent", "/calendar/schedule", { method: "POST", body: { title: title || getProject(id)?.name, when: whenISO } });
    return { ok: result.ok, via: "ascent", detail: result.ok ? result.data : result.error };
  } catch (error) {
    return { ok: false, error: String(error.message || error) };
  }
}

export function projectStats() {
  const all = listProjects();
  const by = {};
  for (const project of all) by[project.status] = (by[project.status] || 0) + 1;
  return { total: all.length, by };
}

export function listFiles(projectId) {
  const project = getProject(projectId);
  if (!project) return [];
  return Object.values(project.files || {})
    .map((file) => ({ path: file.path, name: file.name, type: file.type, size: (file.content || "").length, updated: file.updated }))
    .sort((a, b) => a.path.localeCompare(b.path));
}

export function putFile(projectId, { path, name, type = "text", content = "", meta = {} }) {
  const db = _load();
  const project = db.projects[projectId];
  if (!project) return null;
  const clean = (path || name || uid("file")).replace(/^\/+/, "");
  project.files ||= {};
  project.files[clean] = { path: clean, name: name || clean.split("/").pop(), type, content, meta, updated: Date.now() };
  project.updated = Date.now();
  _save(db);
  return project.files[clean];
}

export function getFile(projectId, path) {
  return getProject(projectId)?.files?.[path] || null;
}

export function retrieve(projectId, query, k = 5) {
  const project = getProject(projectId);
  if (!project) return [];
  const terms = String(query || "").toLowerCase().match(/[a-z0-9]{3,}/g) || [];
  if (!terms.length) return [];
  return Object.values(project.files || {})
    .map((file) => {
      const text = (file.content || "").toLowerCase();
      return { file, score: terms.reduce((score, term) => score + text.split(term).length - 1, 0) };
    })
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, k)
    .map(({ file, score }) => ({ path: file.path, name: file.name, score, snippet: snippet(file.content, terms) }));
}

function snippet(content, terms, window = 160) {
  const text = content || "";
  const lower = text.toLowerCase();
  let index = -1;
  for (const term of terms) {
    const found = lower.indexOf(term);
    if (found >= 0 && (index < 0 || found < index)) index = found;
  }
  if (index < 0) return text.slice(0, window);
  const start = Math.max(0, index - window / 3);
  return `${start > 0 ? "…" : ""}${text.slice(start, start + window).trim()}…`;
}

// --- plan / roadmap ---------------------------------------------------------

/** Projects belonging to one tenant, excluding archived ones. */
export function listProjectsByTenant(tenantId) {
  return listProjects().filter((project) => (project.tenantId || DEFAULT_TENANT) === tenantId);
}

export function setProjectTenant(id, tenantId) {
  return updateProject(id, { tenantId: tenantId || DEFAULT_TENANT });
}

/**
 * Patch a project's plan metadata. Invalid quarters and a self-parent are
 * ignored rather than written, so a bad edit cannot corrupt the breakdown.
 */
export function updateProjectPlan(id, patch = {}) {
  const project = getProject(id);
  if (!project) return null;
  const next = { ...project.plan };
  for (const [field, value] of Object.entries(patch)) {
    if (!(field in next)) continue;
    if (field === "parent") { next.parent = value === id ? next.parent : (value ?? null); continue; }
    if (field === "hours") { next.hours = Math.max(0, Number(value) || 0); continue; }
    if ((field === "start" || field === "end") && value && !/^\d{4}-Q[1-4]$/.test(String(value))) continue;
    next[field] = value;
  }
  return updateProject(id, { plan: next });
}

/**
 * Permanently delete a project and everything it owns — files, runs, review
 * state, transcripts, canvas. Requires an authorisation from destructiveGuard;
 * an unauthorised call is refused so the credential gate cannot be bypassed.
 *
 * archiveProject() is the reversible option and is deliberately not gated.
 * Children in the breakdown are re-parented rather than destroyed alongside it.
 */
export function removeProject(id, authorisation) {
  if (!authorisation?.ok) return { ok: false, error: "Deletion requires confirmed credentials." };
  const db = _load();
  const project = db.projects[id];
  if (!project) return { ok: false, error: "Project no longer exists." };
  for (const candidate of Object.values(db.projects)) {
    if (candidate.plan?.parent === id) candidate.plan.parent = project.plan?.parent ?? null;
  }
  delete db.projects[id];
  _save(db);
  if (_active === id) setActiveProject(null);
  return { ok: true, removed: project };
}

// --- local folder attachment ------------------------------------------------

export async function attachFolderToProject(projectId) {
  const { pickLocalFolder, storeFolderHandle, listFolderContents, isFolderApiAvailable } = await import("./folderSource.js");
  if (!isFolderApiAvailable()) {
    return { ok: false, error: "No folder backend available — open Medantir Desktop, or a Chromium browser." };
  }
  // The desktop backend keys its workspace mapping by project id, so both the id
  // and a readable name are needed to open the native directory dialog.
  const handle = await pickLocalFolder(projectId, getProject(projectId)?.name);
  if (!handle) return { ok: false, error: null }; // user cancelled
  const entries = await listFolderContents(handle);
  const fileCount = entries.filter((e) => e.kind === "file").length;
  await storeFolderHandle(projectId, handle);
  updateProject(projectId, { localFolder: { name: handle.name, fileCount, attachedAt: Date.now() } });
  return { ok: true, name: handle.name, fileCount, entries };
}

export async function detachFolderFromProject(projectId) {
  const { removeFolderHandle } = await import("./folderSource.js");
  await removeFolderHandle(projectId);
  updateProject(projectId, { localFolder: null });
  return { ok: true };
}

export async function refreshFolderListing(projectId) {
  const { getFolderHandle, listFolderContents, storeFolderHandle } = await import("./folderSource.js");
  const handle = await getFolderHandle(projectId);
  if (!handle) return { ok: false, error: "Folder not available — re-attach it." };
  const entries = await listFolderContents(handle);
  const fileCount = entries.filter((e) => e.kind === "file").length;
  await storeFolderHandle(projectId, handle);
  updateProject(projectId, { localFolder: { name: handle.name, fileCount, attachedAt: Date.now() } });
  return { ok: true, name: handle.name, fileCount, entries };
}

// --- GitHub repository linking ----------------------------------------------

const GITHUB_URL_RE = /^https:\/\/github\.com\/([a-zA-Z0-9_.-]+)\/([a-zA-Z0-9_.-]+)(?:\/.*)?$/;

export function linkGitHubToProject(projectId, url) {
  const trimmed = String(url || "").trim();
  if (!trimmed) return { ok: false, error: "Enter a GitHub repository URL." };
  const match = trimmed.match(GITHUB_URL_RE);
  if (!match) return { ok: false, error: "Enter a valid GitHub URL: https://github.com/owner/repo" };
  const [, owner, repo] = match;
  updateProject(projectId, { githubRepo: { url: `https://github.com/${owner}/${repo}`, owner, repo, linkedAt: Date.now() } });
  return { ok: true, owner, repo, url: `https://github.com/${owner}/${repo}` };
}

export function unlinkGitHubFromProject(projectId) {
  updateProject(projectId, { githubRepo: null });
  return { ok: true };
}
