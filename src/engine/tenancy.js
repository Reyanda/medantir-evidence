// tenancy.js — tenant and membership model shared by roadmap and project surfaces.
//
// A tenant is an organisational boundary: a personal workspace, a client
// engagement, a consortium. Work is scoped to exactly one tenant, and each
// account holds a role within it.
//
// SCOPE OF ENFORCEMENT — this is an organisational boundary, not a security
// boundary. Records live in this browser's localStorage, so anyone with access
// to the device can read or edit them regardless of role. Roles keep collaborators
// out of each other's work and make intent explicit; they do not defend against a
// hostile local user. Enforcing that requires the server-side tenant checks that
// belong with a hosted deployment.

import { currentUser } from "./accounts.js";

const KEY = "medantir.tenancy.v1";
const ACTIVE_KEY = "medantir.tenancy.active";
const VERSION = 1;

export const ROLES = [
  { id: "owner", name: "Owner", description: "Full control, including permanent deletion and membership." },
  { id: "editor", name: "Editor", description: "Create and edit work; cannot delete or manage members." },
  { id: "viewer", name: "Viewer", description: "Read-only access." },
];

const ROLE_RANK = { owner: 3, editor: 2, viewer: 1 };

// Neutral defaults. Headings are tenant data, not product copy, so a shipped
// build never displays the previous owner's naming.
export const DEFAULT_ROADMAP_TITLE = "Enterprise roadmap";
export const DEFAULT_ROADMAP_SUBTITLE = "Strategy, delivery, and operations in one work breakdown.";

export function roadmapLabels(tenantId = activeTenantId()) {
  const tenant = getTenant(tenantId);
  return {
    title: tenant?.roadmapTitle?.trim() || DEFAULT_ROADMAP_TITLE,
    subtitle: tenant?.roadmapSubtitle?.trim() || DEFAULT_ROADMAP_SUBTITLE,
  };
}

/** Editable tenant fields. Only an owner may change them. */
export function updateTenant(id, patch = {}) {
  const db = _load();
  const tenant = db.tenants[id];
  if (!tenant) return { ok: false, error: "Tenant not found." };
  if (!canManageMembers(id)) return { ok: false, error: "Only an owner can change tenant settings." };
  for (const field of ["name", "description", "roadmapTitle", "roadmapSubtitle"]) {
    if (patch[field] !== undefined) tenant[field] = String(patch[field]).slice(0, 200);
  }
  _save(db);
  return { ok: true, tenant };
}

let _mem = null;
let _active = null;
const _listeners = new Set();
let _changeScheduled = false;

const uid = (prefix) => `${prefix}_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;

function parse(raw, fallback) {
  try {
    const value = JSON.parse(raw);
    return value && typeof value === "object" ? value : fallback;
  } catch {
    return fallback;
  }
}

function seedDb() {
  const owner = currentUser()?.email || "";
  const id = "tenant_personal";
  return {
    version: VERSION,
    tenants: {
      [id]: {
        id,
        name: "My workspace",
        description: "Default tenant for solo work. Add tenants for clients and consortia.",
        roadmapTitle: "",
        roadmapSubtitle: "",
        members: owner ? [{ email: owner, role: "owner", addedAt: Date.now() }] : [],
        created: Date.now(),
      },
    },
  };
}

function _load() {
  if (typeof localStorage === "undefined") return (_mem ||= seedDb());
  const current = parse(localStorage.getItem(KEY), null);
  if (current?.tenants) return current;
  const seeded = seedDb();
  _save(seeded);
  return seeded;
}

function _save(db) {
  if (typeof localStorage === "undefined") { _mem = db; return; }
  try { localStorage.setItem(KEY, JSON.stringify(db)); } catch { /* quota — in-memory copy stays authoritative */ }
  if (!_changeScheduled && _listeners.size) {
    _changeScheduled = true;
    queueMicrotask(() => {
      _changeScheduled = false;
      for (const listener of _listeners) listener();
    });
  }
}

export function onTenancyChanged(listener) {
  _listeners.add(listener);
  return () => _listeners.delete(listener);
}

// --- reads -------------------------------------------------------------------

export function listTenants() {
  return Object.values(_load().tenants).sort((a, b) => a.created - b.created);
}

export function getTenant(id) {
  return _load().tenants[id] || null;
}

export function activeTenantId() {
  if (_active && getTenant(_active)) return _active;
  if (typeof localStorage !== "undefined") {
    const stored = localStorage.getItem(ACTIVE_KEY);
    if (stored && getTenant(stored)) { _active = stored; return _active; }
  }
  _active = listTenants()[0]?.id || null;
  return _active;
}

export function activeTenant() {
  return getTenant(activeTenantId());
}

export function setActiveTenant(id) {
  if (!getTenant(id)) return null;
  _active = id;
  if (typeof localStorage !== "undefined") {
    try { localStorage.setItem(ACTIVE_KEY, id); } catch { /* ignore */ }
  }
  for (const listener of _listeners) listener();
  return getTenant(id);
}

export function listMembers(tenantId = activeTenantId()) {
  return getTenant(tenantId)?.members || [];
}

/**
 * Role of an account within a tenant.
 *
 * A tenant with no members at all is treated as unclaimed and grants owner, so a
 * fresh install before sign-up is usable. Once anyone is a member, a non-member
 * gets no role.
 */
export function memberRole(tenantId = activeTenantId(), email = currentUser()?.email) {
  const tenant = getTenant(tenantId);
  if (!tenant) return null;
  if (!tenant.members.length) return "owner";
  const address = String(email || "").trim().toLowerCase();
  if (!address) return null;
  return tenant.members.find((member) => member.email.trim().toLowerCase() === address)?.role || null;
}

function atLeast(role, minimum) {
  return (ROLE_RANK[role] || 0) >= ROLE_RANK[minimum];
}

export function canView(tenantId = activeTenantId(), email) { return atLeast(memberRole(tenantId, email), "viewer"); }
export function canEdit(tenantId = activeTenantId(), email) { return atLeast(memberRole(tenantId, email), "editor"); }
export function canDelete(tenantId = activeTenantId(), email) { return atLeast(memberRole(tenantId, email), "owner"); }
export function canManageMembers(tenantId = activeTenantId(), email) { return atLeast(memberRole(tenantId, email), "owner"); }

// --- writes ------------------------------------------------------------------

export function createTenant(name, description = "") {
  const db = _load();
  const id = uid("tenant");
  const owner = currentUser()?.email || "";
  db.tenants[id] = {
    id,
    name: String(name || "Untitled tenant").slice(0, 120),
    description: String(description || "").slice(0, 400),
    members: owner ? [{ email: owner, role: "owner", addedAt: Date.now() }] : [],
    created: Date.now(),
  };
  _save(db);
  return db.tenants[id];
}

export function renameTenant(id, name) {
  const db = _load();
  const tenant = db.tenants[id];
  if (!tenant) return null;
  if (!canManageMembers(id)) return null;
  tenant.name = String(name || tenant.name).slice(0, 120);
  _save(db);
  return tenant;
}

export function addMember(tenantId, email, role = "viewer") {
  const db = _load();
  const tenant = db.tenants[tenantId];
  if (!tenant) return { ok: false, error: "Tenant not found." };
  if (!canManageMembers(tenantId)) return { ok: false, error: "Only an owner can manage members." };
  const address = String(email || "").trim().toLowerCase();
  if (!address.includes("@")) return { ok: false, error: "Enter a valid email address." };
  if (!ROLE_RANK[role]) return { ok: false, error: "Unknown role." };
  if (tenant.members.some((member) => member.email.trim().toLowerCase() === address)) {
    return { ok: false, error: "That account is already a member." };
  }
  tenant.members.push({ email: address, role, addedAt: Date.now() });
  _save(db);
  return { ok: true, member: { email: address, role } };
}

export function setMemberRole(tenantId, email, role) {
  const db = _load();
  const tenant = db.tenants[tenantId];
  if (!tenant) return { ok: false, error: "Tenant not found." };
  if (!canManageMembers(tenantId)) return { ok: false, error: "Only an owner can manage members." };
  if (!ROLE_RANK[role]) return { ok: false, error: "Unknown role." };
  const address = String(email || "").trim().toLowerCase();
  const member = tenant.members.find((entry) => entry.email.trim().toLowerCase() === address);
  if (!member) return { ok: false, error: "That account is not a member." };
  // Refuse to remove the last owner — a tenant nobody can administer is unrecoverable.
  if (member.role === "owner" && role !== "owner" && tenant.members.filter((entry) => entry.role === "owner").length === 1) {
    return { ok: false, error: "A tenant must keep at least one owner." };
  }
  member.role = role;
  _save(db);
  return { ok: true, member };
}

/**
 * Remove a member. Membership removal revokes access rather than destroying
 * work, so it does not route through the deletion guard.
 */
export function removeMember(tenantId, email) {
  const db = _load();
  const tenant = db.tenants[tenantId];
  if (!tenant) return { ok: false, error: "Tenant not found." };
  if (!canManageMembers(tenantId)) return { ok: false, error: "Only an owner can manage members." };
  const address = String(email || "").trim().toLowerCase();
  const member = tenant.members.find((entry) => entry.email.trim().toLowerCase() === address);
  if (!member) return { ok: false, error: "That account is not a member." };
  if (member.role === "owner" && tenant.members.filter((entry) => entry.role === "owner").length === 1) {
    return { ok: false, error: "A tenant must keep at least one owner." };
  }
  tenant.members = tenant.members.filter((entry) => entry.email.trim().toLowerCase() !== address);
  _save(db);
  return { ok: true };
}

/**
 * Delete a tenant. Requires an authorisation from destructiveGuard, matching the
 * rule that anything irreversible needs credentials plus the typed phrase.
 */
export function removeTenant(id, authorisation) {
  if (!authorisation?.ok) return { ok: false, error: "Deletion requires confirmed credentials." };
  const db = _load();
  const tenant = db.tenants[id];
  if (!tenant) return { ok: false, error: "Tenant no longer exists." };
  if (!canDelete(id)) return { ok: false, error: "Only an owner can delete a tenant." };
  if (Object.keys(db.tenants).length === 1) return { ok: false, error: "The last tenant cannot be deleted." };
  delete db.tenants[id];
  _save(db);
  if (_active === id) setActiveTenant(listTenants()[0]?.id);
  return { ok: true, removed: tenant };
}
