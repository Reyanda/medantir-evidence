// store.js — The system of record.
//
// A Map-backed typed object store. Every object is created here, every mutation
// flows through here, every value carries provenance, and every change emits an
// event so the UI is a pure view of engine state (not the other way around).
//
// This is deliberately NOT a database engine — it is the smallest honest store
// that gives us the four things prose files never can: typed objects, typed links,
// per-value lineage, and an observable single source of truth.

import { OBJECT_TYPES, LINK_TYPES } from "./ontology.js";

const PERSIST_KEY = "medantir.ontology.v2"; // v2: real media-derived claims (no mock seeds)

let _seq = 0;
function nextId(kind) {
  _seq += 1;
  return `${kind}-${String(_seq).padStart(5, "0")}`;
}

export class OntologyStore {
  constructor() {
    /** @type {Map<string, object>} id -> object */
    this.objects = new Map();
    /** @type {Array<{from,to,type,ts}>} */
    this.links = [];
    /** immutable audit trail of every applied action */
    this.audit = [];
    this._subs = new Set();
  }

  // -- reactivity ----------------------------------------------------------
  subscribe(fn) {
    this._subs.add(fn);
    return () => this._subs.delete(fn);
  }
  _emit(event) {
    for (const fn of this._subs) fn(event);
  }

  // -- provenance ----------------------------------------------------------
  // Every value written through the store can carry a lineage record answering
  // "where did this come from and how confident are we". `_prov` is a parallel
  // map: prop -> { origin, transform, confidence, ts, refs }.
  _stampProv(obj, prop, prov) {
    if (!prov) return;
    obj._prov = obj._prov || {};
    obj._prov[prop] = { ts: this._now(), ...prov };
  }

  _now() {
    // Deterministic-ish monotonic clock; avoids Date.now for testability but
    // still gives ordered timestamps within a session.
    return ++OntologyStore._clock;
  }

  // -- create --------------------------------------------------------------
  create(kind, props = {}, options = {}) {
    const id = options.id;
    const provenance = options.provenance || (options.origin ? options : undefined);
    const schema = OBJECT_TYPES[kind];
    if (!schema) throw new Error(`Unknown object type: ${kind}`);

    const obj = { id: id || nextId(kind), kind, _prov: {}, _created: this._now() };

    // Apply schema defaults, then supplied props.
    for (const [name, def] of Object.entries(schema.props)) {
      if (def.default !== undefined) obj[name] = def.default;
    }
    for (const [name, value] of Object.entries(props)) {
      obj[name] = value;
      this._stampProv(obj, name, provenance);
    }

    this.objects.set(obj.id, obj);
    this._emit({ type: "create", id: obj.id, kind });
    return obj;
  }

  removeMany(ids) {
    const selected = new Set(ids);
    for (const id of selected) this.objects.delete(id);
    this.links = this.links.filter((link) => !selected.has(link.from) && !selected.has(link.to));
    this.audit = this.audit.filter((entry) => !selected.has(entry.targetId));
    if (selected.size) this._emit({ type: "remove", ids: [...selected] });
    return selected.size;
  }

  // -- read ----------------------------------------------------------------
  get(id) {
    return this.objects.get(id) || null;
  }

  all(kind) {
    const out = [];
    for (const o of this.objects.values()) {
      if (!kind || o.kind === kind) out.push(o);
    }
    return out;
  }

  counts() {
    const c = {};
    for (const o of this.objects.values()) c[o.kind] = (c[o.kind] || 0) + 1;
    return c;
  }

  query(kind, predicate) {
    return this.all(kind).filter(predicate);
  }

  // -- update --------------------------------------------------------------
  // The only sanctioned mutation path. Records provenance and emits.
  set(id, patch, provenance) {
    const obj = this.objects.get(id);
    if (!obj) throw new Error(`No object ${id}`);
    for (const [name, value] of Object.entries(patch)) {
      obj[name] = value;
      this._stampProv(obj, name, provenance);
    }
    this._emit({ type: "update", id, keys: Object.keys(patch) });
    return obj;
  }

  // -- links ---------------------------------------------------------------
  link(fromId, type, toId, provenance) {
    const def = LINK_TYPES[type];
    if (!def) throw new Error(`Unknown link type: ${type}`);
    this.links.push({ from: fromId, to: toId, type, ts: this._now(), provenance });
    this._emit({ type: "link", from: fromId, to: toId, linkType: type });
  }

  // outgoing neighbours of `id` along link type
  linked(id, type) {
    return this.links
      .filter((l) => l.from === id && (!type || l.type === type))
      .map((l) => this.objects.get(l.to))
      .filter(Boolean);
  }

  // incoming neighbours (walk inverse)
  linkedInverse(id, type) {
    return this.links
      .filter((l) => l.to === id && (!type || l.type === type))
      .map((l) => this.objects.get(l.from))
      .filter(Boolean);
  }

  linksOf(id) {
    return this.links.filter((l) => l.from === id || l.to === id);
  }

  // -- audit ---------------------------------------------------------------
  record(entry) {
    const rec = { seq: this._now(), ...entry };
    this.audit.push(rec);
    this._emit({ type: "audit", record: rec });
    return rec;
  }

  // -- persistence ---------------------------------------------------------
  snapshot() {
    return JSON.stringify({
      objects: [...this.objects.values()],
      links: this.links,
      audit: this.audit,
      seq: _seq,
      clock: OntologyStore._clock,
    });
  }

  persist() {
    try {
      localStorage.setItem(PERSIST_KEY, this.snapshot());
    } catch {
      /* storage unavailable (SSR / private mode) — engine still works in-memory */
    }
  }

  restore() {
    try {
      const raw = localStorage.getItem(PERSIST_KEY);
      if (!raw) return false;
      const data = JSON.parse(raw);
      this.objects = new Map(data.objects.map((o) => [o.id, o]));
      this.links = data.links || [];
      this.audit = data.audit || [];
      _seq = data.seq || 0;
      OntologyStore._clock = data.clock || 0;
      return true;
    } catch {
      return false;
    }
  }

  reset() {
    this.objects.clear();
    this.links = [];
    this.audit = [];
    _seq = 0;
    OntologyStore._clock = 0;
    try {
      localStorage.removeItem(PERSIST_KEY);
    } catch {
      /* ignore */
    }
    this._emit({ type: "reset" });
  }
}

OntologyStore._clock = 0;
