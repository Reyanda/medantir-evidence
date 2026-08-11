import React from "react";
import EvidenceTab from "./components/EvidenceTab.jsx";

export default function App() {
  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 font-sans flex flex-col">
      <header className="h-14 border-b border-zinc-800/80 px-6 flex items-center justify-between bg-zinc-900/60 backdrop-blur">
        <div className="flex items-center gap-3">
          <div className="h-8 w-8 rounded-lg bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center font-bold text-white shadow-lg shadow-indigo-500/20">
            E
          </div>
          <div>
            <span className="font-semibold tracking-tight text-white">Medantir Evidence</span>
            <span className="ml-2 text-xs px-2 py-0.5 rounded-full bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 font-mono">
              v1.0 Standalone
            </span>
          </div>
        </div>
        <div className="flex items-center gap-4 text-xs text-zinc-400">
          <a
            href="https://github.com/Reyanda/medantir-evidence"
            target="_blank"
            rel="noreferrer"
            className="hover:text-zinc-200 transition-colors"
          >
            GitHub Repository
          </a>
        </div>
      </header>

      <main className="flex-1 p-6 max-w-7xl mx-auto w-full">
        <EvidenceTab />
      </main>
    </div>
  );
}
