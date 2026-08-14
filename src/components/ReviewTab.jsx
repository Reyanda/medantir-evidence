import React, { useState } from "react";
import { CloudCog, Laptop } from "lucide-react";
import ReviewControlRoom from "./ReviewControlRoom.jsx";
import { activeProject } from "../engine/projectstore.js";
import LegacyReviewTab from "./LegacyReviewTab.jsx";

/**
 * The production server pipeline is the default review surface. The former
 * browser-local/manual workbench remains available as an explicitly labelled
 * fallback so existing projects and offline workflows are not broken while the
 * durable service path is certified.
 */
export default function ReviewTab({ embedded = false }) {
  const [mode, setMode] = useState("server");
  return (
    <div className={embedded ? "" : "ui-page"}>
      <div className="flex items-center gap-1 mb-3 border-b border-zinc-200 dark:border-zinc-800">
        <button onClick={() => setMode("server")} className={`flex items-center gap-1.5 px-3 py-2 text-xs font-medium border-b-2 ${mode === "server" ? "border-[var(--color-brand-primary)] text-[var(--color-brand-primary)]" : "border-transparent text-zinc-500"}`}>
          <CloudCog className="h-3.5 w-3.5" /> Durable server pipeline
        </button>
        <button onClick={() => setMode("local")} className={`flex items-center gap-1.5 px-3 py-2 text-xs font-medium border-b-2 ${mode === "local" ? "border-[var(--color-brand-primary)] text-[var(--color-brand-primary)]" : "border-transparent text-zinc-500"}`}>
          <Laptop className="h-3.5 w-3.5" /> Local/manual fallback
        </button>
      </div>
      {mode === "server" ? <ReviewControlRoom key={activeProject() || "none"} /> : <LegacyReviewTab embedded={embedded} />}
    </div>
  );
}
