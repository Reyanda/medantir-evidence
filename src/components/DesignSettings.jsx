import React, { useState } from "react";
import { Focus, LayoutPanelLeft, Monitor, Moon, Palette, PanelTop, Sun } from "lucide-react";
import { BACKGROUNDS, DESIGN_LANGUAGES, MOTIONS, PALETTES, TRANSPARENCIES, TYPOGRAPHIES, UI_THEMES, WORKSPACE_PRESETS } from "../engine/designSystem.js";
import useClickOutside from "../hooks/useClickOutside.js";
import ArtworkPicker from "./ArtworkPicker.jsx";
import { groupedVellumBrands } from "../engine/vellumBrands.js";

const PRESET_ICONS = {
  "studio-dark": LayoutPanelLeft,
  "clinical-light": PanelTop,
  "focus-canvas": Focus,
};

function WorkspacePresets({ settings, onChange, compact = false }) {
  return (
    <section className="space-y-2" aria-label="Workspace presets">
      <div>
        <div className="text-[10px] font-mono font-bold uppercase tracking-wider text-zinc-500">Workspace preset</div>
        {!compact && <div className="text-[10px] text-zinc-500">One MEDANTIR capability model, three disciplined workspace compositions.</div>}
      </div>
      <div className={compact ? "grid grid-cols-3 gap-1" : "grid grid-cols-1 gap-1.5"}>
        {WORKSPACE_PRESETS.map((preset) => {
          const Icon = PRESET_ICONS[preset.id] || PanelTop;
          const active = settings.workspacePreset === preset.id;
          return (
            <button
              key={preset.id}
              type="button"
              onClick={() => onChange({ workspacePreset: preset.id })}
              aria-pressed={active}
              title={preset.description}
              className={`rounded-lg border transition-colors ${compact ? "px-2 py-2 text-center" : "px-3 py-2.5 text-left"}`}
              style={{
                borderColor: active ? "var(--color-brand-primary)" : "var(--color-border-subtle)",
                background: active ? "color-mix(in srgb, var(--color-brand-primary) 7%, var(--color-bg-surface))" : "var(--color-bg-surface)",
              }}
            >
              <div className={`flex items-center ${compact ? "justify-center" : "gap-2"}`}>
                <Icon className="h-3.5 w-3.5 shrink-0" style={{ color: active ? "var(--color-brand-primary)" : "var(--color-text-secondary)" }} />
                {!compact && <span className="text-[11px] font-semibold text-[var(--color-text-primary)]">{preset.name}</span>}
              </div>
              {!compact && <div className="mt-1 text-[9px] leading-relaxed text-[var(--color-text-secondary)]">{preset.description}</div>}
            </button>
          );
        })}
      </div>
      {settings.workspacePreset === "custom" && <div className="text-[9px] font-mono text-amber-600 dark:text-amber-400">Custom workspace · advanced appearance differs from a preset</div>}
    </section>
  );
}

const FIELDS = [
  ["language", "Design language", DESIGN_LANGUAGES],
  ["transparency", "Transparency", TRANSPARENCIES],
  ["theme", "Mood", UI_THEMES],
  ["palette", "Palette", PALETTES],
  ["background", "Background", BACKGROUNDS],
  ["typography", "Typography", TYPOGRAPHIES],
  ["motion", "Motion", MOTIONS],
];

/**
 * Options for one design axis. The palette axis additionally offers Vellum's
 * institutional identities, grouped by cohort, so the app can wear a university's
 * brand without any of those colours being hardcoded in a component.
 */
function FieldOptions({ id, options }) {
  return (
    <>
      {options.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}
      {id === "palette"
        ? groupedVellumBrands().map((group) => (
          <optgroup key={group.label} label={group.label}>
            {group.brands.map((brand) => <option key={brand.id} value={brand.id}>{brand.name}</option>)}
          </optgroup>
        ))
        : null}
    </>
  );
}

export default function DesignSettings({ settings, onChange, inline = false }) {
  const [open, setOpen] = useState(false);
  const ref = useClickOutside(open, setOpen);

  const appearances = [
    { id: "light", label: "Light", Icon: Sun },
    { id: "dark", label: "Dark", Icon: Moon },
    { id: "system", label: "System", Icon: Monitor },
  ];

  if (inline) return (
    <div className="space-y-3">
      <WorkspacePresets settings={settings} onChange={onChange} compact />
      <details>
        <summary className="cursor-pointer text-[9px] font-mono font-bold uppercase tracking-wider text-zinc-500">Advanced appearance</summary>
        <div className="mt-2 space-y-2">
          <p className="text-[9px] leading-relaxed text-zinc-500">Fine tuning creates a Custom workspace; scientific capability and data behavior never change.</p>
          <div className="flex rounded-lg bg-zinc-100/70 dark:bg-zinc-900/70 p-0.5 border border-zinc-200/50 dark:border-zinc-800">
            {appearances.map(({ id, label, Icon }) => {
              const active = settings.appearance === id;
              return <button key={id} onClick={() => onChange({ appearance: id })} className={`flex-1 flex items-center justify-center gap-1 py-1.5 rounded-md text-[10px] ${active ? "bg-white/80 dark:bg-zinc-800/80 font-semibold shadow-sm" : "text-zinc-500"}`}><Icon className="h-3 w-3" />{label}</button>;
            })}
          </div>
          <div className="grid grid-cols-2 gap-1.5">
            {FIELDS.map(([id, label, options]) => (
              <label key={id} className="text-[9px] font-mono text-zinc-500">
                {label}
                <select value={settings[id]} onChange={(event) => onChange({ [id]: event.target.value })} className="mt-0.5 w-full text-[10px] px-1.5 py-1 rounded bg-transparent border outline-none" style={{ borderColor: "var(--color-border-subtle)" }}>
                  <FieldOptions id={id} options={options} />
                </select>
              </label>
            ))}
          </div>
          <ArtworkPicker settings={settings} onChange={onChange} />
        </div>
      </details>
    </div>
  );

  return (
    <div className="relative">
      <button onClick={() => setOpen(!open)} aria-label="Open design settings" aria-expanded={open} className="p-2 rounded-lg bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-300 transition-colors">
        <Palette className="h-5 w-5" />
      </button>
      {open && (
        <div ref={ref} className="chrome-surface absolute right-0 top-11 w-72 rounded-xl shadow-xl z-50 p-3 space-y-3">
          <div>
            <div className="text-[10px] font-mono font-bold uppercase tracking-wider text-zinc-500">Workspace appearance</div>
            <div className="text-[10px] text-zinc-500">Choose a MEDANTIR workspace preset, then refine only if needed.</div>
          </div>
          <WorkspacePresets settings={settings} onChange={onChange} />
          <details className="border-t pt-3" style={{ borderColor: "var(--color-border-subtle)" }}>
            <summary className="cursor-pointer text-[10px] font-mono font-bold uppercase tracking-wider text-zinc-500">Advanced appearance</summary>
            <div className="mt-3 space-y-3">
              <div className="flex rounded-lg bg-zinc-100 dark:bg-zinc-900 p-0.5 border border-zinc-200/50 dark:border-zinc-800">
                {appearances.map(({ id, label, Icon }) => {
                  const active = settings.appearance === id;
                  return (
                    <button key={id} onClick={() => onChange({ appearance: id })} className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-md text-[10px] font-mono transition-all ${active ? "bg-white dark:bg-[#18181b] text-zinc-950 dark:text-zinc-50 shadow-sm font-semibold" : "text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300"}`}>
                      <Icon className="h-3.5 w-3.5" />{label}
                    </button>
                  );
                })}
              </div>
              <div className="grid grid-cols-2 gap-2">
                {FIELDS.map(([id, label, options]) => (
                  <label key={id} className="text-[10px] font-mono text-zinc-500">
                    {label}
                    <select value={settings[id]} onChange={(event) => onChange({ [id]: event.target.value })} className="mt-1 w-full text-xs px-2 py-1.5 rounded-md bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 outline-none focus:border-[var(--color-brand-primary)]">
                      <FieldOptions id={id} options={options} />
                    </select>
                  </label>
                ))}
              </div>
              <ArtworkPicker settings={settings} onChange={onChange} />
            </div>
          </details>
        </div>
      )}
    </div>
  );
}
