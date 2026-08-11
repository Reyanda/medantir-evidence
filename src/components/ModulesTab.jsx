import React, { useEffect, useMemo, useState } from "react";
import { Boxes, ExternalLink, Plug, CheckCircle2, XCircle, Loader2, Link2 } from "lucide-react";
import { modulesForMode, probeModule } from "../engine/modules.js";
import { getOperatingMode } from "../engine/operatingModes.js";

const STATUS = {
  merged: { text: "text-emerald-500", bg: "bg-emerald-500/10", label: "native" },
  connector: { text: "text-[var(--color-brand-primary)]", bg: "bg-[var(--color-brand-primary)]/10", label: "connector" },
  live: { text: "text-emerald-500", bg: "bg-emerald-500/10", label: "live" },
  code: { text: "text-violet-500", bg: "bg-violet-500/10", label: "private" },
  link: { text: "text-zinc-500", bg: "bg-zinc-500/10", label: "repo" },
};

function openUrl(module) {
  if (module.url?.startsWith("http")) return module.url;
  if (module.repo?.startsWith("http")) return module.repo;
  if (module.repo?.startsWith("Reyanda/")) return `https://github.com/${module.repo}`;
  return null;
}

export default function ModulesTab({ effectiveMode }) {
  const [domain, setDomain] = useState("all");
  const [tests, setTests] = useState({});
  const mode = getOperatingMode(effectiveMode);
  const modules = useMemo(() => modulesForMode(effectiveMode), [effectiveMode]);
  const domains = useMemo(() => [...new Set(modules.map((module) => module.domain))], [modules]);
  const shown = modules.filter((module) => domain === "all" || module.domain === domain);

  useEffect(() => { setDomain("all"); setTests({}); }, [effectiveMode]);

  // Auto-probe all API connectors on mount so the dashboard immediately
  // shows system health for government/demo presentation.
  useEffect(() => {
    const connectors = modules.filter((m) => m.api);
    let cancelled = false;
    (async () => {
      for (const m of connectors) {
        if (cancelled) break;
        setTests((c) => ({ ...c, [m.id]: { loading: true } }));
        const result = await probeModule(m.id);
        if (!cancelled) setTests((c) => ({ ...c, [m.id]: { loading: false, ...result } }));
      }
    })();
    return () => { cancelled = true; };
  }, [effectiveMode, modules.map((m) => m.id).join(",")]); // eslint-disable-line react-hooks/exhaustive-deps

  const test = async (id) => {
    setTests((current) => ({ ...current, [id]: { loading: true } }));
    const result = await probeModule(id);
    setTests((current) => ({ ...current, [id]: { loading: false, ...result } }));
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2"><Boxes className="h-6 w-6" style={{ color: mode.color }} /> {mode.name} modules</h1>
      </div>

      <div className="flex flex-wrap gap-2">
        {["all", ...domains].map((item) => (
          <button key={item} onClick={() => setDomain(item)} className={`px-3 py-1.5 rounded-lg border text-xs font-medium capitalize transition-colors ${domain === item ? "border-[var(--color-brand-primary)]/40 bg-[var(--color-brand-primary)]/10 text-[var(--color-brand-primary)]" : "border-zinc-200 dark:border-zinc-800 text-zinc-500 hover:bg-zinc-50 dark:hover:bg-zinc-800/50"}`}>{item}</button>
        ))}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {shown.map((module) => {
          const status = STATUS[module.status] || STATUS.link;
          const result = tests[module.id];
          const link = openUrl(module);
          return (
            <div key={module.id} className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#0c0c0f] p-4 flex flex-col">
              <div className="flex items-center justify-between gap-2 mb-1">
                <span className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{module.name}</span>
                <span className={`text-[9px] font-mono font-bold uppercase px-1.5 py-0.5 rounded ${status.bg} ${status.text}`}>{status.label}</span>
              </div>
              <div className="text-[10px] font-mono text-zinc-400 mb-2 capitalize">{module.domain} · primary {module.primaryMode}</div>
              {module.note && <div className="text-[11px] text-zinc-500 mb-2 flex-1">{module.note}</div>}
              <div className="flex flex-wrap gap-1 mb-3">
                {(module.capabilities || []).map((capability) => <span key={capability} className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800 text-zinc-500">{capability}</span>)}
              </div>
              <div className="flex items-center gap-2 mt-auto">
                {module.api && (
                  <button onClick={() => test(module.id)} disabled={result?.loading} className="flex items-center gap-1.5 text-[11px] font-medium px-2.5 py-1.5 rounded-md border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-800 disabled:opacity-50">
                    {result?.loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plug className="h-3.5 w-3.5" />} Test health
                  </button>
                )}
                {link && <a href={link} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 text-[11px] font-medium px-2.5 py-1.5 rounded-md border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-800 text-zinc-500">{module.status === "live" ? <ExternalLink className="h-3.5 w-3.5" /> : <Link2 className="h-3.5 w-3.5" />} {module.status === "live" ? "Open live" : "Open source"}</a>}
              </div>
              {result && !result.loading && (
                <div className={`mt-2 text-[10px] font-mono flex items-center gap-1.5 ${result.ok ? "text-emerald-500" : result.state === "authentication-required" ? "text-amber-500" : "text-rose-500"}`}>
                  {result.ok ? <CheckCircle2 className="h-3.5 w-3.5" /> : <XCircle className="h-3.5 w-3.5" />}
                  {result.ok ? `${result.status} · ready` : `${result.state || "unavailable"} · ${result.error || "health check failed"}`}
                </div>
              )}
            </div>
          );
        })}
        {!shown.length && <div className="col-span-full rounded-xl border border-dashed border-zinc-300 dark:border-zinc-700 p-8 text-center text-sm text-zinc-500">No modules are assigned to this mode and domain.</div>}
      </div>
    </div>
  );
}
