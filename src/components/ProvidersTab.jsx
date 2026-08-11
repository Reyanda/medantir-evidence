import React, { useState } from "react";
import {
  DeepSeek,
  OpenRouter,
  Claude,
  OpenAI,
  Gemini,
  Mistral,
  Groq,
  Grok,
  Perplexity,
  Ollama,
  Qwen,
  Moonshot,
} from "@lobehub/icons";
import { CheckCircle2, XCircle, Loader2, KeyRound, Zap, Layers, Circle, ListRestart, ChevronDown, Search, LogIn } from "lucide-react";
import { PROVIDERS, providerStatus, setProviderConfig, testProvider, getAIMode, setAIMode, enabledProviders, discoverModels, discoveredModels, beginOpenRouterSignIn } from "../engine/providers.js";
import { MCP_CATALOG } from "../engine/mcp.js";
import { vaultStatus } from "../engine/secureVault.js";
import useClickOutside from "../hooks/useClickOutside.js";

// Real brand marks for each provider (from @lobehub/icons). Colored logo variants.
const BRAND = {
  OpenRouter,
  DeepSeek,
  Claude,
  OpenAI,
  Gemini,
  Mistral,
  Groq,
  Grok,
  Perplexity,
  Ollama,
  Qwen,
  Moonshot,
};

function Brand({ name, size = 26 }) {
  const C = BRAND[name];
  if (!C) return <KeyRound className="text-zinc-400" style={{ width: size, height: size }} />;
  const Colored = C.Color || C;
  return <Colored size={size} />;
}

function modelCatalog(status, discovered = []) {
  return [...new Set([...(status.routingModels || []), ...(discovered || [])])];
}

function ProviderCard({ id, onChange }) {
  const s = providerStatus(id);
  const [key, setKey] = useState("");
  const [model, setModel] = useState(s.model || s.defaultModel || "");
  const [enabled, setEnabled] = useState(!!s.enabled);
  const [test, setTest] = useState(null);
  const [testing, setTesting] = useState(false);
  const [models, setModels] = useState(modelCatalog(s, discoveredModels(id)));
  const [discovering, setDiscovering] = useState(false);
  const [modelOpen, setModelOpen] = useState(false);
  const modelRef = useClickOutside(modelOpen, setModelOpen);
  const [modelFilter, setModelFilter] = useState("");

  const persist = async (patch) => {
    const result = await setProviderConfig(id, patch);
    // A successfully encrypted secret must not remain in React state or the DOM.
    // Subsequent updates omit the key and reuse the vault copy.
    if (result.ok && patch?.key) setKey("");
    onChange?.();
    return result;
  };

  const discover = async () => {
    const stored = await persist({ key, model, enabled });
    if (!stored.ok) { setTest({ ok: false, error: stored.error }); return; }
    setDiscovering(true);
    const r = await discoverModels(id);
    setDiscovering(false);
    if (r.ok) setModels(modelCatalog(s, r.models));
    else setTest({ ok: false, error: r.error });
  };

  const runTest = async () => {
    const stored = await persist({ key, model, enabled });
    if (!stored.ok) { setTest({ ok: false, error: stored.error }); return; }
    setTesting(true);
    setTest(null);
    const r = await testProvider(id);
    setTest(r);
    setTesting(false);
  };

  return (
    <div className={`rounded-xl border p-4 bg-white dark:bg-[#0c0c0f] transition-colors ${
      enabled && s.hasKey ? "border-emerald-500/40" : "border-zinc-200 dark:border-zinc-800"
    }`}>
      <div className="flex items-center gap-3 mb-3">
        <div className="p-2 rounded-lg bg-zinc-50 dark:bg-zinc-900 border border-zinc-100 dark:border-zinc-800">
          <Brand name={s.icon} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 flex items-center gap-2">
            {s.label}
            {s.seeded && <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-[var(--color-brand-primary)]/10 text-[var(--color-brand-primary)]">seeded</span>}
          </div>
          <div className="text-[10px] text-zinc-500 line-clamp-1">{s.note}</div>
        </div>
        {/* enable toggle */}
        <button
          onClick={() => {
            const v = !enabled;
            setEnabled(v);
            persist({ key, model, enabled: v });
          }}
          className={`relative h-5 w-9 rounded-full transition-colors shrink-0 ${
            enabled ? "bg-emerald-500" : "bg-zinc-300 dark:bg-zinc-700"
          }`}
        >
          <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all ${enabled ? "left-4" : "left-0.5"}`} />
        </button>
      </div>

      {!s.keyless && (
        <div className="space-y-2">
          <input
            type="password"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            onBlur={() => persist({ key, model, enabled })}
            placeholder={s.hasKey ? "stored in encrypted user vault ••••" : "API key (unlock Vault first)"}
            className="w-full text-xs font-mono px-3 py-2 rounded-lg bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 focus:border-sky-500 outline-none"
          />
          {id === "openrouter" && (
            <button
              type="button"
              onClick={() => beginOpenRouterSignIn()}
              className="w-full flex items-center justify-center gap-1.5 text-xs font-medium px-3 py-2 rounded-lg border border-sky-500/40 text-sky-600 dark:text-sky-400 hover:bg-sky-500/10"
            >
              <LogIn className="h-3.5 w-3.5" /> Sign in with OpenRouter instead — no key paste
            </button>
          )}
        </div>
      )}
      <div className="flex items-center gap-2 mt-2">
        {/* browsable model dropdown — shows all discovered models, filterable */}
        <div className="relative flex-1">
          <button
            type="button"
            onClick={() => setModelOpen((o) => !o)}
            className="w-full flex items-center justify-between gap-2 text-xs font-mono px-3 py-2 rounded-lg bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 hover:border-sky-500 outline-none"
          >
            <span className={model ? "" : "text-zinc-400"}>{model || "select model…"}</span>
            <ChevronDown className="h-3.5 w-3.5 text-zinc-400 shrink-0" />
          </button>
          {modelOpen && (
            <div ref={modelRef} className="absolute left-0 right-0 top-10 z-40 bg-white dark:bg-[#0c0c0f] border border-zinc-200 dark:border-zinc-800 rounded-lg shadow-lg">
              <div className="p-1.5 border-b border-zinc-100 dark:border-zinc-800 flex items-center gap-1.5">
                <Search className="h-3.5 w-3.5 text-zinc-400" />
                <input autoFocus value={modelFilter} onChange={(e) => setModelFilter(e.target.value)} placeholder={`filter ${models.length} models…`} className="flex-1 text-xs bg-transparent outline-none" />
                <button onClick={discover} disabled={discovering} title="Discover models from provider" className="text-zinc-400 hover:text-sky-500">{discovering ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ListRestart className="h-3.5 w-3.5" />}</button>
              </div>
              <div className="max-h-64 overflow-y-auto">
                {models.length === 0 && <div className="px-3 py-2 text-[11px] text-zinc-400">No models yet — click refresh to discover.</div>}
                {models.filter((m) => m.toLowerCase().includes(modelFilter.toLowerCase())).slice(0, 200).map((m) => (
                  <button key={m} onClick={() => { setModel(m); persist({ key, model: m, enabled }); setModelOpen(false); setModelFilter(""); }} className={`w-full text-left px-3 py-1.5 text-[11px] font-mono hover:bg-sky-500/10 ${m === model ? "text-sky-500" : "text-zinc-600 dark:text-zinc-300"}`}>
                    {m}
                  </button>
                ))}
              </div>
              <div className="px-3 py-1.5 border-t border-zinc-100 dark:border-zinc-800 text-[9px] font-mono text-zinc-400">{models.length} discovered · showing ≤200 matches</div>
            </div>
          )}
        </div>
        <button
          onClick={runTest}
          disabled={testing || (!s.keyless && !key && !s.hasKey)}
          className="flex items-center gap-1.5 text-xs font-medium px-3 py-2 rounded-lg border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-800 disabled:opacity-50 transition-colors"
        >
          {testing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Zap className="h-3.5 w-3.5" />}
          Test
        </button>
      </div>

      {test && (
        <div className={`mt-2 text-[10px] font-mono flex items-center gap-1.5 ${test.ok ? "text-emerald-500" : "text-rose-500"}`}>
          {test.ok ? <CheckCircle2 className="h-3.5 w-3.5" /> : <XCircle className="h-3.5 w-3.5" />}
          {test.ok ? `connected · "${test.sample}"` : test.error}
        </div>
      )}
    </div>
  );
}

export default function ProvidersTab() {
  const [, force] = useState(0);
  const bump = () => force((n) => n + 1);
  const activeCount = enabledProviders().length;
  const mode = getAIMode();
  const secure = vaultStatus();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <KeyRound className="h-6 w-6 text-violet-500" />
          AI Providers
        </h1>
      </div>

      {/* AI engine mode: single vs multi-model (not a dropdown — a mode) */}
      <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#0c0c0f] p-4">
        <div className="text-[10px] font-mono font-bold uppercase tracking-wider text-zinc-400 mb-3">AI engine mode</div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {[
            { id: "single", icon: Circle, title: "Single model", desc: "One enabled model answers. Fast, cheap, deterministic path." },
            { id: "multi", icon: Layers, title: "Multi-model engine", desc: "Every enabled model sees the same input and gives its own answer → cross-model uncertainty." },
          ].map((m) => {
            const Icon = m.icon;
            const on = mode === m.id;
            return (
              <button
                key={m.id}
                onClick={() => { setAIMode(m.id); bump(); }}
                className={`text-left rounded-lg border p-3 transition-colors ${on ? "border-violet-500/50 bg-violet-500/10" : "border-zinc-200 dark:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-800/50"}`}
              >
                <div className={`flex items-center gap-2 text-sm font-semibold ${on ? "text-violet-500" : "text-zinc-700 dark:text-zinc-200"}`}>
                  <Icon className="h-4 w-4" /> {m.title} {on && <CheckCircle2 className="h-3.5 w-3.5 ml-auto" />}
                </div>
                <div className="text-[11px] text-zinc-500 mt-1">{m.desc}</div>
              </button>
            );
          })}
        </div>
        {mode === "multi" && activeCount < 2 && (
          <div className="mt-2 text-[11px] font-mono text-amber-500">Enable ≥2 providers below to get real cross-model uncertainty.</div>
        )}
      </div>

      <div className={`rounded-lg border p-3 text-[11px] font-mono ${secure.unlocked ? "border-emerald-500/30 bg-emerald-500/5 text-emerald-600 dark:text-emerald-400" : "border-amber-500/30 bg-amber-500/5 text-amber-600 dark:text-amber-400"}`}>
        User vault: {secure.unlocked ? `unlocked · ${secure.count} encrypted secret${secure.count === 1 ? "" : "s"}` : "locked — open Security & Vault before adding or using provider keys"}. Keys exist in memory while unlocked and are sent only to the selected provider.
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {PROVIDERS.map((p) => (
          <ProviderCard key={p.id} id={p.id} onChange={bump} />
        ))}
      </div>

      <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 p-3 text-[11px] text-zinc-500">
        <span className="font-semibold text-zinc-700 dark:text-zinc-300">Account sign-ins (OAuth, no keys):</span>{" "}
        {MCP_CATALOG.filter((c) => c.auth === "oauth").map((c) => c.name).join(" · ")}
        {" "}— connect these with your normal account login in the <span className="font-medium text-zinc-700 dark:text-zinc-300">Connectors</span> tab. AI providers above are key-based by vendor design; only OpenRouter offers account sign-in.
      </div>
    </div>
  );
}
