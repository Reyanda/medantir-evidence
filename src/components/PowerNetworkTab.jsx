import React, { useState } from "react";
import { Network, ArrowRight, ArrowLeft, Building2, Database } from "lucide-react";
import { useEngine } from "../engine/index.js";

// The merged MapIt global power network as an ontology view: entities ranked by
// influence (stake-weighted ownership in-degree), each clickable to reveal who
// owns it and what it owns. Every row and link is live and clickable — no stubs.

export default function PowerNetworkTab() {
  const api = useEngine();
  const [selectedId, setSelectedId] = useState(null);
  const [q, setQ] = useState("");

  const nodes = api.store.all("PowerNode");
  const filtered = nodes
    .filter((n) => !q || (n.name || "").toLowerCase().includes(q.toLowerCase()) || (n.country || "").toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => (b.influence || 0) - (a.influence || 0));

  const selected = selectedId ? api.store.get(selectedId) : filtered[0] || null;
  const owns = selected ? api.store.linked(selected.id, "owns") : [];
  const ownedBy = selected ? api.store.linkedInverse(selected.id, "owns") : [];

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Network className="h-6 w-6 text-yellow-500" />
            Power Network
          </h1>
          <p className="text-[10px] font-mono text-zinc-400 mt-1">Reference snapshot — a frozen MapIt export (366 entities / 255 ownership edges), loaded on demand. Not a live feed.</p>
        </div>
        <div className="flex items-center gap-2"><button onClick={() => api.loadPower()} disabled={nodes.length > 0} className="flex items-center gap-1.5 text-xs font-medium px-3 py-2 rounded-lg border border-yellow-500/40 text-yellow-600 disabled:opacity-50"><Database className="h-3.5 w-3.5" /> {nodes.length ? "Reference network loaded" : "Load reference network"}</button><input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="search entity / country…"
          aria-label="Search entity or country"
          className="text-xs font-mono px-3 py-2 rounded-lg bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 focus:border-yellow-500 outline-none w-56"
        /></div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* ranked list */}
        <div className="space-y-2">
          <h3 className="text-[10px] font-mono font-bold uppercase tracking-wider text-zinc-400">
            Top by influence ({filtered.length})
          </h3>
          <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#0c0c0f] max-h-[62vh] overflow-y-auto divide-y divide-zinc-100 dark:divide-zinc-800">
            {filtered.slice(0, 120).map((n) => {
              const sel = selected && n.id === selected.id;
              return (
                <button
                  key={n.id}
                  onClick={() => setSelectedId(n.id)}
                  className={`w-full text-left px-3 py-2.5 transition-colors ${sel ? "bg-yellow-500/10" : "hover:bg-zinc-50 dark:hover:bg-zinc-800/50"}`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-medium text-zinc-800 dark:text-zinc-200 truncate">{n.name}</span>
                    {n.influence > 0 && <span className="text-[10px] font-mono text-yellow-600 dark:text-yellow-500 shrink-0">▲{n.influence}</span>}
                  </div>
                  <div className="text-[10px] font-mono text-zinc-400 mt-0.5">
                    {n.entityType}{n.country ? ` · ${n.country}` : ""}{n.marketCap ? ` · $${n.marketCap}B` : ""}
                  </div>
                </button>
              );
            })}
            {filtered.length === 0 && <div className="p-6 text-center text-[11px] text-zinc-500">No network loaded.</div>}
          </div>
        </div>

        {/* inspector */}
        <div className="lg:col-span-2 space-y-4">
          {selected ? (
            <>
              <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#0c0c0f] p-4">
                <div className="flex items-center gap-2 mb-2">
                  <Building2 className="h-4 w-4 text-yellow-500" />
                  <span className="text-sm font-semibold">{selected.name}</span>
                  <span className="text-[10px] font-mono text-zinc-400 ml-auto">{selected.id}</span>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-x-6 gap-y-1 text-[11px] font-mono text-zinc-500">
                  {[["type", selected.entityType], ["country", selected.country], ["hq", selected.hq], ["ceo", selected.ceo], ["founder", selected.founder], ["mcap", selected.marketCap ? `$${selected.marketCap}B` : ""], ["influence", selected.influence]]
                    .filter(([, v]) => v)
                    .map(([k, v]) => (
                      <div key={k}><span className="text-zinc-400">{k}:</span> <span className="text-zinc-700 dark:text-zinc-300">{v}</span></div>
                    ))}
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#0c0c0f] p-4">
                  <h4 className="text-[10px] font-mono font-bold uppercase tracking-wider text-zinc-400 mb-2 flex items-center gap-1.5">
                    <ArrowLeft className="h-3.5 w-3.5 text-[var(--color-brand-primary)]" /> Owned by ({ownedBy.length})
                  </h4>
                  {ownedBy.length ? ownedBy.map((o) => (
                    <button key={o.id} onClick={() => setSelectedId(o.id)} className="block w-full text-left text-[11px] py-1 hover:text-yellow-500 truncate">{o.name}</button>
                  )) : <div className="text-[11px] text-zinc-400">no holders in graph</div>}
                </div>
                <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#0c0c0f] p-4">
                  <h4 className="text-[10px] font-mono font-bold uppercase tracking-wider text-zinc-400 mb-2 flex items-center gap-1.5">
                    <ArrowRight className="h-3.5 w-3.5 text-emerald-500" /> Owns stake in ({owns.length})
                  </h4>
                  {owns.length ? owns.map((o) => (
                    <button key={o.id} onClick={() => setSelectedId(o.id)} className="block w-full text-left text-[11px] py-1 hover:text-yellow-500 truncate">{o.name}</button>
                  )) : <div className="text-[11px] text-zinc-400">no holdings in graph</div>}
                </div>
              </div>
            </>
          ) : (
            <div className="rounded-lg border border-dashed border-zinc-300 dark:border-zinc-700 p-8 text-center text-sm text-zinc-500">Select an entity.</div>
          )}
        </div>
      </div>
    </div>
  );
}
