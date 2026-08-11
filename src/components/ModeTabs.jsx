import React, { useRef } from "react";

export default function ModeTabs({ modes, activeMode, onChange }) {
  const refs = useRef([]);
  const move = (index, delta) => {
    const next = (index + delta + modes.length) % modes.length;
    onChange(modes[next].id);
    refs.current[next]?.focus();
  };

  return (
    <div className="mb-3 border-b border-zinc-200 dark:border-zinc-800 overflow-x-auto" aria-label="All-source mode results">
      <div role="tablist" aria-label="Results by operating mode" className="flex min-w-max gap-1">
        {modes.map((mode, index) => {
          const selected = mode.id === activeMode;
          return (
            <button
              key={mode.id}
              ref={(node) => { refs.current[index] = node; }}
              type="button"
              role="tab"
              id={`mode-tab-${mode.id}`}
              aria-selected={selected}
              aria-controls="mode-tab-panel"
              tabIndex={selected ? 0 : -1}
              onClick={() => onChange(mode.id)}
              onKeyDown={(event) => {
                if (event.key === "ArrowRight") { event.preventDefault(); move(index, 1); }
                if (event.key === "ArrowLeft") { event.preventDefault(); move(index, -1); }
                if (event.key === "Home") { event.preventDefault(); onChange(modes[0].id); refs.current[0]?.focus(); }
                if (event.key === "End") { event.preventDefault(); const last = modes.length - 1; onChange(modes[last].id); refs.current[last]?.focus(); }
              }}
              className={`relative px-4 py-2.5 text-xs font-semibold whitespace-nowrap transition-colors ${selected ? "text-zinc-900 dark:text-zinc-100" : "text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"}`}
            >
              <span className="inline-flex items-center gap-2">
                <span className="h-2 w-2 rounded-full" style={{ backgroundColor: mode.color }} />
                {mode.name}
              </span>
              {selected && <span className="absolute inset-x-2 bottom-0 h-0.5 rounded-full" style={{ backgroundColor: mode.color }} />}
            </button>
          );
        })}
      </div>
    </div>
  );
}
