// roadmap.js — the plan view over projectstore.
//
// A work package and a project are ONE object. This module owns no storage: it
// reads and writes projectstore, which already carried the folder, files, runs
// and review state. Keeping two stores meant two status vocabularies and a
// foreign key between halves of the same thing; now a roadmap row *is* the
// project, so scheduling a line item and attaching its folder are the same act.
//
// Status uses projectstore's STATUSES. Only the display labels live here.

import {
  PLAN_PRIORITIES, PLAN_TYPES, STATUSES,
  archiveProject, createProject, getProject, listProjectsByTenant, onProjectsChanged,
  removeProject, updateProject, updateProjectPlan,
} from "./projectstore.js";
import { activeTenantId } from "./tenancy.js";

export { PLAN_PRIORITIES as WORK_PRIORITIES, PLAN_TYPES as WORK_TYPES, STATUSES as WORK_STATUSES };

/** Human labels for the single stored status vocabulary. */
export const STATUS_LABELS = {
  backlog: "Backlog",
  scoping: "Scoping",
  active: "In progress",
  blocked: "Blocked",
  done: "Done",
};

export const onRoadmapChanged = onProjectsChanged;

// Generic pillar vocabulary. A tenant renames these freely; nothing here names a
// real organisation, so a shipped build carries no previous owner's identity.
export const PILLARS = [
  { id: "Portfolio", kind: "portfolio", description: "Top-level plan spanning every pillar." },
  { id: "Product", kind: "product", description: "Products and the platform they share." },
  { id: "Research", kind: "research", description: "Studies, credentials, and published output." },
  { id: "Advisory", kind: "advisory", description: "Consulting and advisory engagements." },
  { id: "Ventures", kind: "ventures", description: "New lines incubated on the existing platform." },
];

// Starting structures, not anyone's plan.
//
// PRODUCT RULE: nothing shipped here may name a real person, employer, client,
// institution, or product. A tenant starts empty and the operator chooses a
// template, so an installation sold or handed to someone else contains none of
// the previous owner's strategy. Quarters are relative offsets from the tenant's
// chosen start quarter, so a template applied in 2029 is not dated 2026.
export const ROADMAP_TEMPLATES = [
  {
    id: "three-pillar",
    name: "Three-pillar venture",
    description: "A knowledge business balancing research credibility, advisory cashflow, and a product line.",
    packages: [
      { key: 1, pillar: "Portfolio", subject: "Portfolio roadmap", type: "Phase", priority: "High", parent: null, from: 0, to: 40, description: "Top-level plan spanning every pillar." },
      { key: 2, pillar: "Product", subject: "First commercial product", type: "Phase", priority: "Immediate", parent: 1, from: 0, to: 6, description: "The offering with the shortest path to revenue." },
      { key: 3, pillar: "Product", subject: "Core engine build", type: "Task", priority: "High", parent: 2, from: 0, to: 2, description: "The capability the product is actually sold on." },
      { key: 4, pillar: "Product", subject: "Flagship differentiating feature", type: "Feature", priority: "Immediate", parent: 2, from: 0, to: 3, description: "The one thing competitors cannot copy quickly." },
      { key: 5, pillar: "Product", subject: "Third-party integrations", type: "Task", priority: "High", parent: 2, from: 1, to: 4, description: "Connectors to the systems customers already run." },
      { key: 6, pillar: "Product", subject: "Security and compliance review", type: "Task", priority: "Medium", parent: 2, from: 2, to: 5, description: "Access control, data handling, and the audit an enterprise buyer asks for." },
      { key: 7, pillar: "Product", subject: "Go-to-market collateral", type: "Task", priority: "Immediate", parent: 2, from: 0, to: 2, description: "Positioning, pricing, and the pitch." },
      { key: 8, pillar: "Research", subject: "Primary research credential", type: "Milestone", priority: "High", parent: 1, from: 0, to: 4, description: "The qualification or result the practice's authority rests on." },
      { key: 9, pillar: "Research", subject: "Publication pipeline", type: "Phase", priority: "High", parent: 1, from: 0, to: 10, description: "Sustained output that keeps the authority current." },
      { key: 10, pillar: "Advisory", subject: "Advisory engagement engine", type: "Phase", priority: "High", parent: 1, from: 0, to: 14, description: "Rate progression and pipeline that fund development without dilution." },
      { key: 11, pillar: "Ventures", subject: "Second product line", type: "Phase", priority: "Medium", parent: 1, from: 4, to: 14, description: "Built on the core once the first product is self-sustaining." },
      { key: 12, pillar: "Ventures", subject: "Third product line", type: "Phase", priority: "Low", parent: 1, from: 6, to: 16, description: "Reuses the same platform for a different market." },
    ],
  },
  {
    id: "product-launch",
    name: "Product launch",
    description: "Discovery through general availability for a single product.",
    packages: [
      { key: 1, pillar: "Product", subject: "Launch programme", type: "Phase", priority: "High", parent: null, from: 0, to: 8, description: "End-to-end plan from discovery to general availability." },
      { key: 2, pillar: "Product", subject: "Discovery and problem validation", type: "Task", priority: "Immediate", parent: 1, from: 0, to: 1, description: "Evidence that the problem is worth paying to solve." },
      { key: 3, pillar: "Product", subject: "Prototype", type: "Task", priority: "High", parent: 1, from: 1, to: 3, description: "Narrow build that tests the core assumption." },
      { key: 4, pillar: "Product", subject: "Private beta", type: "Milestone", priority: "High", parent: 1, from: 3, to: 5, description: "Real users, instrumented, with a feedback loop." },
      { key: 5, pillar: "Product", subject: "Pricing and packaging", type: "Task", priority: "Medium", parent: 1, from: 4, to: 6, description: "Tiers, limits, and what upgrades demand." },
      { key: 6, pillar: "Product", subject: "General availability", type: "Milestone", priority: "Immediate", parent: 1, from: 6, to: 8, description: "Public launch with support and onboarding in place." },
    ],
  },
  {
    id: "research-programme",
    name: "Research programme",
    description: "A multi-year programme from protocol through dissemination.",
    packages: [
      { key: 1, pillar: "Research", subject: "Research programme", type: "Phase", priority: "High", parent: null, from: 0, to: 16, description: "Full arc from question to dissemination." },
      { key: 2, pillar: "Research", subject: "Protocol and registration", type: "Task", priority: "Immediate", parent: 1, from: 0, to: 2, description: "Question, design, analysis plan, and pre-registration." },
      { key: 3, pillar: "Research", subject: "Funding application", type: "Task", priority: "High", parent: 1, from: 0, to: 3, description: "Costed proposal and submission." },
      { key: 4, pillar: "Research", subject: "Data collection", type: "Phase", priority: "High", parent: 1, from: 3, to: 10, description: "Fieldwork, extraction, or acquisition." },
      { key: 5, pillar: "Research", subject: "Analysis", type: "Task", priority: "High", parent: 1, from: 9, to: 13, description: "Pre-specified analysis and sensitivity checks." },
      { key: 6, pillar: "Research", subject: "Dissemination", type: "Phase", priority: "Medium", parent: 1, from: 12, to: 16, description: "Manuscripts, presentations, and the policy audience." },
    ],
  },
];

// --- quarter arithmetic ------------------------------------------------------

const QUARTER_RE = /^(\d{4})-Q([1-4])$/;

/** Convert "2026-Q3" to a sortable integer; null when unparseable. */
export function quarterIndex(quarter) {
  const match = QUARTER_RE.exec(String(quarter || "").trim());
  return match ? Number(match[1]) * 4 + (Number(match[2]) - 1) : null;
}

export function formatQuarter(index) {
  if (!Number.isFinite(index)) return "";
  return `${Math.floor(index / 4)}-Q${(index % 4) + 1}`;
}

export function isValidQuarter(quarter) {
  return quarterIndex(quarter) !== null;
}

/** Today's quarter, so nothing defaults to a hardcoded year. */
export function currentQuarter() {
  const now = new Date();
  return formatQuarter(now.getFullYear() * 4 + Math.floor(now.getMonth() / 3));
}

// --- reads -------------------------------------------------------------------

/** Flatten a project into the shape the roadmap renders. */
function toWorkPackage(project) {
  return {
    id: project.id,
    subject: project.name,
    description: project.note,
    status: project.status,
    tenantId: project.tenantId,
    localFolder: project.localFolder,
    githubRepo: project.githubRepo,
    ...project.plan,
  };
}

function bySchedule(a, b) {
  const left = quarterIndex(a.start) ?? Number.MAX_SAFE_INTEGER;
  const right = quarterIndex(b.start) ?? Number.MAX_SAFE_INTEGER;
  return left - right || String(a.subject).localeCompare(String(b.subject));
}

export function listWorkPackages(tenantId = activeTenantId()) {
  return listProjectsByTenant(tenantId).map(toWorkPackage).sort(bySchedule);
}

export function getWorkPackage(id) {
  const project = getProject(id);
  return project ? toWorkPackage(project) : null;
}

/** Depth-first order with a depth marker, so the table can indent the hierarchy. */
export function workPackageTree(tenantId = activeTenantId()) {
  const all = listWorkPackages(tenantId);
  const byParent = new Map();
  for (const item of all) {
    const key = item.parent ?? null;
    if (!byParent.has(key)) byParent.set(key, []);
    byParent.get(key).push(item);
  }
  const seen = new Set();
  const output = [];
  const walk = (parent, depth) => {
    for (const item of byParent.get(parent) || []) {
      if (seen.has(item.id)) continue; // a corrupted parent cycle must not hang the view
      seen.add(item.id);
      output.push({ ...item, depth });
      walk(item.id, depth + 1);
    }
  };
  walk(null, 0);
  // Surface orphans (parent archived or missing) rather than hiding them.
  for (const item of all) if (!seen.has(item.id)) output.push({ ...item, depth: 0, orphaned: true });
  return output;
}

export function roadmapStats(items = listWorkPackages()) {
  const hours = items.reduce((total, item) => total + (Number(item.hours) || 0), 0);
  const counts = Object.fromEntries(STATUSES.map((status) => [status, 0]));
  for (const item of items) if (counts[item.status] !== undefined) counts[item.status] += 1;
  const withFolder = items.filter((item) => item.localFolder).length;
  const done = counts.done;
  return { total: items.length, hours, counts, withFolder, done, completion: items.length ? Math.round((done / items.length) * 100) : 0 };
}

/** Inclusive quarter span covering every scheduled package, for the Gantt axis. */
export function roadmapSpan(items = listWorkPackages()) {
  const starts = items.map((item) => quarterIndex(item.start)).filter((value) => value !== null);
  const ends = items.map((item) => quarterIndex(item.end)).filter((value) => value !== null);
  if (!starts.length || !ends.length) return null;
  const from = Math.min(...starts);
  const to = Math.max(...ends);
  return { from, to, quarters: to - from + 1 };
}

// --- writes ------------------------------------------------------------------

const PLAN_FIELDS = new Set(["parent", "pillar", "type", "priority", "start", "end", "hours", "assignee"]);

export function createWorkPackage(input = {}) {
  const project = createProject(input.subject || "New work package", {
    note: input.description || "",
    status: STATUSES.includes(input.status) ? input.status : "backlog",
    tenantId: input.tenantId || activeTenantId(),
    plan: {
      parent: input.parent ?? null,
      pillar: input.pillar || PILLARS[0].id,
      type: input.type,
      priority: input.priority,
      start: input.start || "",
      end: input.end || "",
      hours: input.hours,
      assignee: input.assignee || "",
    },
  });
  return toWorkPackage(project);
}

/** Route each field to the right half of the record: identity, or plan. */
export function updateWorkPackage(id, patch = {}) {
  const record = {};
  const plan = {};
  for (const [field, value] of Object.entries(patch)) {
    if (PLAN_FIELDS.has(field)) { plan[field] = value; continue; }
    if (field === "subject") { record.name = value; continue; }
    if (field === "description") { record.note = value; continue; }
    if (field === "status" && STATUSES.includes(value)) { record.status = value; continue; }
    if (field === "tenantId") record.tenantId = value;
  }
  if (Object.keys(record).length) updateProject(id, record);
  if (Object.keys(plan).length) updateProjectPlan(id, plan);
  return getWorkPackage(id);
}

/** Reversible alternative to deletion — deliberately ungated. */
export function archiveWorkPackage(id) {
  archiveProject(id);
  return { ok: true };
}

/**
 * Permanently delete. Requires an authorisation from destructiveGuard; children
 * are re-parented rather than destroyed. Deleting a work package now also
 * deletes the workspace it owns, which is why the gate matters more than before.
 */
export function removeWorkPackage(id, authorisation) {
  const result = removeProject(id, authorisation);
  return result.ok ? { ok: true, removed: toWorkPackage(result.removed) } : result;
}

export function getTemplate(templateId) {
  return ROADMAP_TEMPLATES.find((template) => template.id === templateId) || null;
}

/**
 * Apply a template into a tenant.
 *
 * Additive — existing work is never replaced. Template quarters are offsets from
 * `startQuarter`, so applying the same template later produces a plan dated from
 * then rather than from whenever the template was authored.
 */
export function applyTemplate(templateId, { tenantId = activeTenantId(), startQuarter = currentQuarter() } = {}) {
  const template = getTemplate(templateId);
  if (!template) return { ok: false, error: "Unknown template." };
  const origin = quarterIndex(startQuarter);
  if (origin === null) return { ok: false, error: "Choose a valid start quarter, for example 2026-Q3." };

  const idByKey = new Map();
  for (const item of template.packages) {
    const created = createWorkPackage({
      subject: item.subject,
      description: item.description,
      pillar: item.pillar,
      type: item.type,
      priority: item.priority,
      tenantId,
      start: formatQuarter(origin + item.from),
      end: formatQuarter(origin + item.to),
    });
    idByKey.set(item.key, created.id);
  }
  // Parents are resolved afterwards, once every key has a real project id.
  for (const item of template.packages) {
    if (item.parent === null || item.parent === undefined) continue;
    updateProjectPlan(idByKey.get(item.key), { parent: idByKey.get(item.parent) ?? null });
  }
  return { ok: true, added: template.packages.length, template: template.name };
}

// --- migration ---------------------------------------------------------------

const LEGACY_KEY = "medantir.roadmap.v1";
const LEGACY_STATUS = { New: "backlog", "In Progress": "active", Blocked: "blocked", Done: "done" };

/**
 * Import work packages written by the standalone roadmap store into projectstore.
 *
 * Runs once and leaves the legacy key in place for rollback. Idempotent: a second
 * run is a no-op because the marker records that the import already happened.
 */
export function migrateLegacyRoadmap() {
  if (typeof localStorage === "undefined") return { ok: true, imported: 0 };
  const marker = `${LEGACY_KEY}.imported`;
  if (localStorage.getItem(marker)) return { ok: true, imported: 0, alreadyDone: true };

  let legacy = null;
  try { legacy = JSON.parse(localStorage.getItem(LEGACY_KEY) || "null"); } catch { legacy = null; }
  const packages = legacy?.packages && typeof legacy.packages === "object" ? Object.values(legacy.packages) : [];
  if (!packages.length) {
    try { localStorage.setItem(marker, String(Date.now())); } catch { /* ignore */ }
    return { ok: true, imported: 0 };
  }

  const idByLegacy = new Map();
  for (const item of packages) {
    const created = createWorkPackage({
      subject: item.subject,
      description: item.description,
      status: LEGACY_STATUS[item.status] || "backlog",
      pillar: item.pillar,
      type: item.type,
      priority: item.priority,
      hours: item.hours,
      assignee: item.assignee,
      tenantId: item.tenantId,
      start: item.start,
      end: item.end,
    });
    idByLegacy.set(item.id, created.id);
  }
  for (const item of packages) {
    if (item.parent === null || item.parent === undefined) continue;
    updateProjectPlan(idByLegacy.get(item.id), { parent: idByLegacy.get(item.parent) ?? null });
  }

  try { localStorage.setItem(marker, String(Date.now())); } catch { /* ignore */ }
  return { ok: true, imported: packages.length };
}
