import React, { useState, useEffect } from "react";
import { Wallet, CalendarDays, Loader2, RefreshCw, ShieldCheck, HeartPulse, GraduationCap, Shirt } from "lucide-react";
import { callModule } from "../engine/modules.js";
import { isAuthed } from "../engine/auth.js";

// Personal engine — surfaces the operator's Ascent personal OS (finance-first).
// Read-first + advisory-only, honouring Ascent's security boundary: it never mutates
// financial records. Pulls live from ascent.actiora.com via the module connector.

const DOMAIN_ICON = { health: HeartPulse, scholar: GraduationCap, wardrobe: Shirt };

export default function PersonalTab() {
  const [finance, setFinance] = useState(null);
  const [calendar, setCalendar] = useState(null);
  const [loading, setLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    const [f, c] = await Promise.all([
      callModule("ascent", "/finance/summary", { token: undefined }),
      callModule("ascent", "/calendar/upcoming", { token: undefined }),
    ]);
    setFinance(f); setCalendar(c); setLoading(false);
  };
  useEffect(() => { load(); }, []);

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2"><Wallet className="h-6 w-6 text-emerald-500" /> Personal — Ascent</h1>
        </div>
        <button onClick={load} disabled={loading} className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 text-white text-sm font-medium px-4 py-2 rounded-lg">
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Sync
        </button>
      </div>

      <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-[11px] font-mono text-amber-600 dark:text-amber-400 flex items-center gap-1.5">
        <ShieldCheck className="h-3.5 w-3.5" /> Advisory-only: the platform reads Ascent but never mutates financial records. {isAuthed() ? "Signed in." : "Sign in (Khwelero) to authorize private reads."}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#0c0c0f] p-4">
          <div className="text-[10px] font-mono font-bold uppercase tracking-wider text-zinc-400 mb-2 flex items-center gap-1.5"><Wallet className="h-3.5 w-3.5" /> Finance</div>
          {loading ? <Loader2 className="h-4 w-4 animate-spin text-zinc-400" /> : finance?.ok ? (
            <pre className="text-[11px] font-mono text-zinc-600 dark:text-zinc-300 whitespace-pre-wrap">{JSON.stringify(finance.data, null, 1).slice(0, 500)}</pre>
          ) : <div className="text-[11px] font-mono text-zinc-400">Ascent finance API offline — {finance?.error?.slice(0, 80) || "connect at ascent.actiora.com"}.</div>}
        </div>
        <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#0c0c0f] p-4">
          <div className="text-[10px] font-mono font-bold uppercase tracking-wider text-zinc-400 mb-2 flex items-center gap-1.5"><CalendarDays className="h-3.5 w-3.5" /> Upcoming</div>
          {loading ? <Loader2 className="h-4 w-4 animate-spin text-zinc-400" /> : calendar?.ok ? (
            <pre className="text-[11px] font-mono text-zinc-600 dark:text-zinc-300 whitespace-pre-wrap">{JSON.stringify(calendar.data, null, 1).slice(0, 500)}</pre>
          ) : <div className="text-[11px] font-mono text-zinc-400">Ascent calendar offline. Scheduling from Projects still records locally.</div>}
        </div>
      </div>

      <div>
        <div className="text-[10px] font-mono font-bold uppercase tracking-wider text-zinc-400 mb-2">Life domains</div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {["health", "scholar", "wardrobe", "culture"].map((d) => {
            const Icon = DOMAIN_ICON[d] || HeartPulse;
            return (
              <div key={d} className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#0c0c0f] p-4">
                <Icon className="h-5 w-5 text-emerald-500 mb-2" />
                <div className="text-sm font-semibold capitalize">{d}</div>
                <div className="text-[10px] font-mono text-zinc-400 mt-1">Ascent domain</div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
