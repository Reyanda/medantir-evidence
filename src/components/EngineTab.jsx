import React, { useState } from "react";
// Curated icon set (only the icons the ontology object types reference) instead
// of `import * as Icons` — a namespace import pulls the ENTIRE lucide library
// into this chunk (~600KB) and defeats tree-shaking. Extend ICON_MAP if a type
// adds a new icon; unknown names fall back to Circle.
import {
  GitMerge, Database, Activity, Bug, MapPin, Users, Server, BarChart3,
  Siren, ShieldAlert, Network, Newspaper, Boxes, ArrowRight, Circle,
} from "lucide-react";
import { useEngine } from "../engine/index.js";
import { OBJECT_TYPE_LIST, OBJECT_TYPES, titleFor } from "../engine/ontology.js";

// The Ontology Explorer: browse the typed object store, inspect any object's
// properties WITH per-value provenance (the answer to "where did this come from"),
// walk its typed links, and see the engine's recommended actions for it. This is
// the "system of record" made visible — the opposite of source_agent:"unknown".

const ICON_MAP = {
  GitMerge, Database, Activity, Bug, MapPin, Users, Server, BarChart3,
  Siren, ShieldAlert, Network, Newspaper, Boxes, ArrowRight, Circle,
};

function Ico({ name, className }) {
  const C = ICON_MAP[name] || Circle;
  return <C className={className} />;
}

const PROV_LABEL = {
  "feed:pandemicPACT": "ingest · Pandemic PACT",
  "feed:policySimulator": "ingest · Policy Simulator",
  "feed:interop": "ingest · Interop",
};

function provText(p) {
  if (!p) return "—";
  const origin = PROV_LABEL[p.origin] || p.origin;
  const conf = p.confidence != null ? ` · ${Math.round(p.confidence * 100)}%` : "";
  return `${origin}${conf}`;
}

export default function EngineTab() {
  const api = useEngine();
  const counts = api.store.counts();
  const [activeKind, setActiveKind] = useState("Claim");
  const [selectedId, setSelectedId] = useState(null);

  const objects = api.store.all(activeKind);
  const selected = selectedId ? api.store.get(selectedId) : objects[0] || null;
  const schema = selected ? OBJECT_TYPES[selected.kind] : null;
  const links = selected ? api.store.linksOf(selected.id) : [];
  const recs = selected ? api.recommendForTarget(selected.id) : [];

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Boxes className="h-6 w-6 text-violet-500" />
            Ontology Explorer
          </h1>
        </div>
      </div>

      {/* Object-type ribbon */}
      <div className="flex flex-wrap gap-2">
        {OBJECT_TYPE_LIST.map((t) => {
          const n = counts[t.key] || 0;
          const active = activeKind === t.key;
          return (
            <button
              key={t.key}
              onClick={() => {
                setActiveKind(t.key);
                setSelectedId(null);
              }}
              className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-xs font-medium transition-colors ${
                active
                  ? "border-violet-500/40 bg-violet-500/10 text-violet-500"
                  : "border-zinc-200 dark:border-zinc-800 text-zinc-500 hover:bg-zinc-50 dark:hover:bg-zinc-800/50"
              }`}
            >
              <Ico name={t.icon} className="h-3.5 w-3.5" style={{ color: t.color }} />
              {t.plural}
              <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800">{n}</span>
            </button>
          );
        })}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Object list */}
        <div className="space-y-2">
          <h3 className="text-[10px] font-mono font-bold uppercase tracking-wider text-zinc-400">
            {OBJECT_TYPES[activeKind]?.plural}
          </h3>
          <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#0c0c0f] max-h-[60vh] overflow-y-auto divide-y divide-zinc-100 dark:divide-zinc-800">
            {objects.map((o) => {
              const isSel = selected && o.id === selected.id;
              return (
                <button
                  key={o.id}
                  onClick={() => setSelectedId(o.id)}
                  className={`w-full text-left px-3 py-2.5 transition-colors ${
                    isSel ? "bg-violet-500/10" : "hover:bg-zinc-50 dark:hover:bg-zinc-800/50"
                  }`}
                >
                  <div className="text-xs font-medium text-zinc-800 dark:text-zinc-200 line-clamp-2">
                    {titleFor(o)}
                  </div>
                  <div className="text-[10px] font-mono text-zinc-400 mt-0.5">{o.id}</div>
                </button>
              );
            })}
            {objects.length === 0 && <div className="p-4 text-xs text-zinc-500">No objects.</div>}
          </div>
        </div>

        {/* Object inspector */}
        <div className="lg:col-span-2 space-y-4">
          {selected ? (
            <>
              <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#0c0c0f] p-4">
                <div className="flex items-center gap-2 mb-3">
                  <Ico name={schema?.icon} className="h-4 w-4" style={{ color: schema?.color }} />
                  <span className="text-[10px] font-mono uppercase text-zinc-400">{selected.kind}</span>
                  <span className="text-[10px] font-mono text-zinc-400 ml-auto">{selected.id}</span>
                </div>
                <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 mb-4">
                  {titleFor(selected)}
                </div>

                {/* Properties with provenance */}
                <table className="w-full text-xs">
                  <tbody>
                    {Object.entries(schema?.props || {}).map(([name, def]) => {
                      if (selected[name] === undefined) return null;
                      const prov = selected._prov?.[name];
                      return (
                        <tr key={name} className="border-t border-zinc-100 dark:border-zinc-800">
                          <td className="py-1.5 pr-3 font-mono text-zinc-400 align-top w-32">
                            {name}
                            {def.derived && (
                              <span className="ml-1 text-[9px] px-1 rounded bg-[var(--color-brand-primary)]/10 text-[var(--color-brand-primary)]">derived</span>
                            )}
                          </td>
                          <td className="py-1.5 pr-3 text-zinc-800 dark:text-zinc-200 align-top">
                            {String(selected[name])}
                          </td>
                          <td className="py-1.5 text-[10px] font-mono text-zinc-400 align-top text-right whitespace-nowrap">
                            {provText(prov)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Typed links */}
              {links.length > 0 && (
                <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#0c0c0f] p-4">
                  <h4 className="text-[10px] font-mono font-bold uppercase tracking-wider text-zinc-400 mb-2">
                    Links ({links.length})
                  </h4>
                  <div className="space-y-1">
                    {links.slice(0, 20).map((l, i) => {
                      const other = l.from === selected.id ? api.store.get(l.to) : api.store.get(l.from);
                      const outgoing = l.from === selected.id;
                      return (
                        <div key={i} className="flex items-center gap-2 text-[11px] font-mono">
                          <ArrowRight
                            className={`h-3 w-3 ${outgoing ? "text-emerald-500" : "text-[var(--color-brand-primary)] rotate-180"}`}
                          />
                          <span className="text-zinc-400">{l.type}</span>
                          <span className="text-zinc-700 dark:text-zinc-300 truncate">
                            {other ? titleFor(other).slice(0, 50) : l.to}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Engine recommendations for this object */}
              {recs.length > 0 && (
                <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#0c0c0f] p-4">
                  <h4 className="text-[10px] font-mono font-bold uppercase tracking-wider text-zinc-400 mb-2">
                    Applicable actions
                  </h4>
                  <div className="space-y-2">
                    {recs.map((r) => (
                      <div key={r.actionId} className="flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <div className="text-xs font-medium text-zinc-800 dark:text-zinc-200">{r.label}</div>
                          <div className="text-[10px] font-mono text-zinc-400">
                            {r.applicable ? `EV ${r.ev >= 0 ? "+" : ""}${r.ev.toFixed(2)}` : r.blockedReason}
                          </div>
                        </div>
                        <button
                          disabled={!r.applicable}
                          onClick={() => api.execute(r.actionId, r.targetId, {}, "operator")}
                          className={`text-xs font-medium px-3 py-1.5 rounded-md border transition-colors ${
                            r.applicable
                              ? "border-zinc-200 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-800"
                              : "border-zinc-100 dark:border-zinc-800 text-zinc-300 dark:text-zinc-600 cursor-not-allowed"
                          }`}
                        >
                          {r.applicable ? "Run" : "Blocked"}
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          ) : (
            <div className="rounded-lg border border-dashed border-zinc-300 dark:border-zinc-700 p-8 text-center text-sm text-zinc-500">
              Select an object to inspect.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
