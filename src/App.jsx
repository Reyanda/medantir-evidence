import React, { useState } from "react";
import ForestPlotStudio from "./components/ForestPlotStudio.jsx";
import EvidenceTab from "./components/EvidenceTab.jsx";

export default function App() {
  const [activeView, setActiveView] = useState("Figures");
  const [activeTab, setActiveTab] = useState("VISUALIZE");

  return (
    <div className="h-screen w-screen bg-[#0E1B28] text-slate-100 font-sans overflow-hidden flex flex-col">
      {activeView === "Figures" || activeTab === "VISUALIZE" ? (
        <ForestPlotStudio
          activeView={activeView}
          setActiveView={setActiveView}
          activeTab={activeTab}
          setActiveTab={setActiveTab}
        />
      ) : (
        <div className="flex-1 flex flex-col h-full bg-[#0A1622] overflow-hidden">
          {/* Shared Top Navigation Bar */}
          <header className="h-14 bg-[#0A1622] border-b border-slate-800 flex items-center justify-between px-4 z-20 shrink-0">
            <div className="flex items-center gap-3">
              <div className="h-8 w-8 rounded bg-cyan-500/20 border border-cyan-400/40 flex items-center justify-center text-cyan-400 font-black text-sm tracking-wider shadow-[0_0_12px_rgba(0,242,254,0.15)]">
                ◆
              </div>
              <div className="flex flex-col leading-none">
                <span className="font-extrabold tracking-widest text-white text-base">MEDANTIR</span>
                <span className="text-[10px] text-cyan-400/80 font-medium tracking-wide">Evidence. Engineered.</span>
              </div>
            </div>

            <div className="flex items-center gap-1 bg-[#0E1B28] p-1 rounded-lg border border-slate-800">
              {["BUILD", "ANALYZE", "SYNTHESIZE", "VISUALIZE", "PUBLISH"].map((tab) => {
                const isActive = activeTab === tab;
                return (
                  <button
                    key={tab}
                    onClick={() => {
                      setActiveTab(tab);
                      if (tab === "VISUALIZE") setActiveView("Figures");
                    }}
                    className={`px-3 py-1 text-xs font-semibold rounded tracking-wider transition-all relative ${
                      isActive
                        ? "text-white bg-[#121F2C] shadow-sm border border-slate-700/60"
                        : "text-slate-400 hover:text-slate-200 hover:bg-slate-800/40"
                    }`}
                  >
                    {tab}
                  </button>
                );
              })}
            </div>

            <div className="flex items-center gap-3 text-xs text-slate-400">
              <button
                onClick={() => {
                  setActiveView("Figures");
                  setActiveTab("VISUALIZE");
                }}
                className="px-3 py-1 bg-cyan-500/20 border border-cyan-500/40 text-cyan-300 rounded font-medium hover:bg-cyan-500/30 transition-colors"
              >
                Open Studio Canvas
              </button>
            </div>
          </header>

          <main className="flex-1 p-6 overflow-auto">
            <EvidenceTab activeSubView={activeView} setActiveSubView={setActiveView} />
          </main>
        </div>
      )}
    </div>
  );
}
