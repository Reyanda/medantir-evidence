import React, { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { CONFIG } from "../engine/config.js";
import { newerReleaseAvailable } from "../engine/appUpdate.js";

export default function UpdateBanner() {
  const [available, setAvailable] = useState(false);

  useEffect(() => {
    if (!import.meta.env.PROD) return undefined;
    let active = true;
    const check = () => newerReleaseAvailable().then((result) => { if (active && result) setAvailable(true); }).catch(() => {});
    check();
    const timer = window.setInterval(check, CONFIG.app.updateCheckMs);
    return () => { active = false; window.clearInterval(timer); };
  }, []);

  if (!available) return null;
  return (
    <div role="status" className="fixed top-3 left-1/2 -translate-x-1/2 z-[120] flex items-center gap-3 rounded-lg border border-cyan-500/40 bg-zinc-950 px-3 py-2 text-xs text-white shadow-xl">
      <span>A newer Medantir release is available.</span>
      <button type="button" onClick={() => window.location.reload()} className="flex items-center gap-1 rounded bg-cyan-500 px-2 py-1 font-semibold text-zinc-950">
        <RefreshCw className="h-3 w-3" /> Reload
      </button>
    </div>
  );
}
