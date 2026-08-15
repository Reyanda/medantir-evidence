import React, { useState, useMemo } from "react";
import {
  BookOpen, CheckCircle, Shield, Layers, HelpCircle, ArrowRight,
  Sparkles, FileText, Check, Award, AlertCircle, RefreshCw
} from "lucide-react";
import { REVIEW_TYPES, FRAMEWORKS, ROB_TOOLS, SYNTHESIS, getReviewType, recommendReviewType } from "../engine/reviewtypes.js";
import { saveReview, loadReview } from "../engine/reviewengine.js";

export default function ReviewTypePanel({
  projectId,
  review,
  onUpdateReview,
  onNote,
  onNavigateNext
}) {
  const currentTypeId = review?.methodology?.typeId || "systematic";
  const [selectedTypeId, setSelectedTypeId] = useState(currentTypeId);
  const [searchQuery, setSearchQuery] = useState("");
  const [customRobTool, setCustomRobTool] = useState(review?.methodology?.robTool || "");
  const [customFramework, setCustomFramework] = useState(review?.methodology?.framework || "");
  const [customSynthesis, setCustomSynthesis] = useState(review?.methodology?.synthesisMethod || "");
  const [includeTriangulation, setIncludeTriangulation] = useState(review?.methodology?.embeddedTriangulation ?? true);

  const selectedType = useMemo(() => getReviewType(selectedTypeId), [selectedTypeId]);

  const filteredTypes = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    if (!q) return REVIEW_TYPES;
    return REVIEW_TYPES.filter((t) =>
      t.name.toLowerCase().includes(q) ||
      t.desc.toLowerCase().includes(q) ||
      t.id.toLowerCase().includes(q)
    );
  }, [searchQuery]);

  const applyMethodology = (typeId) => {
    const target = getReviewType(typeId);
    setSelectedTypeId(typeId);
    const fw = FRAMEWORKS[target.framework] || "PRISMA 2020";
    const rob = ROB_TOOLS[target.rob] || "RoB 2";
    const syn = SYNTHESIS[target.synthesis] || "Pairwise meta-analysis";

    setCustomFramework(fw);
    setCustomRobTool(rob);
    setCustomSynthesis(syn);

    if (review && projectId) {
      const updatedReview = {
        ...review,
        methodology: {
          typeId: target.id,
          typeName: target.name,
          framework: fw,
          robTool: rob,
          synthesisMethod: syn,
          embeddedTriangulation: includeTriangulation,
          desc: target.desc
        }
      };
      saveReview(projectId, updatedReview);
      onUpdateReview?.(updatedReview);
      onNote?.(`Review methodology updated to "${target.name}" (${fw}, ${rob}).`, "ok");
    }
  };

  const saveConfiguration = () => {
    if (!review || !projectId) return;
    const updatedReview = {
      ...review,
      methodology: {
        typeId: selectedType.id,
        typeName: selectedType.name,
        framework: customFramework || FRAMEWORKS[selectedType.framework],
        robTool: customRobTool || ROB_TOOLS[selectedType.rob],
        synthesisMethod: customSynthesis || SYNTHESIS[selectedType.synthesis],
        embeddedTriangulation: includeTriangulation,
        desc: selectedType.desc
      }
    };
    saveReview(projectId, updatedReview);
    onUpdateReview?.(updatedReview);
    onNote?.(`Methodology configuration saved: ${selectedType.name}`, "ok");
  };

  return (
    <div className="flex-1 flex flex-col h-full bg-[#090D15] text-slate-200 overflow-hidden font-mono select-none">
      {/* Module Title Banner */}
      <div className="h-12 bg-[#0D131F] border-b border-slate-800 px-4 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-7 h-7 rounded-sm bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-center text-cyan-400">
            <BookOpen className="w-4 h-4" />
          </div>
          <div>
            <div className="text-xs font-bold text-slate-100 flex items-center gap-2">
              STEP 1: REVIEW METHODOLOGY & SCOPE
              <span className="text-[9px] px-1.5 py-0.2 rounded-sm bg-cyan-950 text-cyan-400 border border-cyan-800">
                FIRST STEP
              </span>
            </div>
            <div className="text-[10px] text-slate-500">
              Select the evidence synthesis design before formulating research questions
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={saveConfiguration}
            className="px-3 py-1 bg-cyan-500 hover:bg-cyan-400 text-slate-950 text-xs font-bold rounded-sm shadow-sm transition-colors flex items-center gap-1.5"
          >
            <Check className="w-3 h-3" /> Save Methodology
          </button>
          {onNavigateNext && (
            <button
              onClick={onNavigateNext}
              className="px-3 py-1 bg-[#162236] hover:bg-[#1E2E48] text-cyan-300 border border-cyan-500/30 text-xs font-semibold rounded-sm transition-colors flex items-center gap-1.5"
            >
              Next: Question <ArrowRight className="w-3 h-3" />
            </button>
          )}
        </div>
      </div>

      {/* 2-Column Methodology Selection & Configuration */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left Column: Catalogue of Review Types */}
        <div className="w-80 bg-[#0C121D] border-r border-slate-800 flex flex-col shrink-0">
          <div className="p-3 border-b border-slate-800">
            <input
              type="text"
              placeholder="Filter review types..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-[#131B2B] border border-slate-800 rounded-sm px-2.5 py-1 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-cyan-500/60 font-mono"
            />
          </div>

          <div className="flex-1 overflow-y-auto p-2 space-y-1">
            {filteredTypes.map((t) => {
              const isSelected = selectedTypeId === t.id;
              const isCurrent = (review?.methodology?.typeId || "systematic") === t.id;
              return (
                <button
                  key={t.id}
                  onClick={() => applyMethodology(t.id)}
                  className={`w-full text-left p-2.5 rounded-sm transition-all border ${
                    isSelected
                      ? "bg-[#162236] border-cyan-500/50 shadow-sm"
                      : "bg-[#0E1522] border-slate-800/80 hover:bg-slate-800/40 text-slate-300"
                  }`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className={`text-xs font-bold ${isSelected ? "text-cyan-300" : "text-slate-200"}`}>
                      {t.name}
                    </span>
                    {isCurrent && (
                      <span className="text-[9px] px-1 py-0.2 bg-emerald-950/80 text-emerald-400 border border-emerald-800/60 rounded-sm font-mono">
                        ACTIVE
                      </span>
                    )}
                  </div>
                  <p className="text-[10px] text-slate-400 line-clamp-2 leading-relaxed font-sans">
                    {t.desc}
                  </p>
                  <div className="mt-2 flex items-center gap-2 text-[9px] font-mono text-slate-500">
                    <span className="bg-[#090D14] px-1 py-0.5 border border-slate-800 rounded-sm">
                      {FRAMEWORKS[t.framework] || t.framework}
                    </span>
                    <span className="bg-[#090D14] px-1 py-0.5 border border-slate-800 rounded-sm">
                      {ROB_TOOLS[t.rob] || t.rob}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Right Column: Active Methodology Architecture & Rigour Specs */}
        <div className="flex-1 bg-[#090D15] p-6 overflow-y-auto space-y-6">
          <div className="bg-[#0D131F] border border-slate-800 rounded-sm p-5 space-y-4">
            <div className="flex items-start justify-between">
              <div>
                <span className="text-[10px] font-mono text-cyan-400 font-bold uppercase tracking-wider block">
                  SELECTED METHODOLOGY SPECIFICATION
                </span>
                <h2 className="text-lg font-bold text-white mt-0.5">
                  {selectedType.name}
                </h2>
              </div>
              <span className="text-xs px-2 py-0.5 rounded-sm bg-slate-800 text-slate-300 border border-slate-700 font-mono">
                ID: {selectedType.id}
              </span>
            </div>

            <p className="text-xs text-slate-300 font-sans leading-relaxed">
              {selectedType.desc}
            </p>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 pt-2">
              <div className="bg-[#131B2B] border border-slate-800 rounded-sm p-3 space-y-1">
                <span className="text-[10px] text-slate-500 font-bold uppercase block">
                  Reporting Framework
                </span>
                <div className="text-xs font-bold text-cyan-300">
                  {customFramework || FRAMEWORKS[selectedType.framework]}
                </div>
                <span className="text-[9px] text-slate-500 block">
                  PRISMA-compliant checklist & statement
                </span>
              </div>

              <div className="bg-[#131B2B] border border-slate-800 rounded-sm p-3 space-y-1">
                <span className="text-[10px] text-slate-500 font-bold uppercase block">
                  Risk of Bias Tool
                </span>
                <div className="text-xs font-bold text-amber-300">
                  {customRobTool || ROB_TOOLS[selectedType.rob]}
                </div>
                <span className="text-[9px] text-slate-500 block">
                  Methodology-matched critical appraisal
                </span>
              </div>

              <div className="bg-[#131B2B] border border-slate-800 rounded-sm p-3 space-y-1">
                <span className="text-[10px] text-slate-500 font-bold uppercase block">
                  Default Synthesis Model
                </span>
                <div className="text-xs font-bold text-emerald-300">
                  {customSynthesis || SYNTHESIS[selectedType.synthesis]}
                </div>
                <span className="text-[9px] text-slate-500 block">
                  Quantitative or qualitative synthesis rule
                </span>
              </div>
            </div>
          </div>

          {/* Triangulation & Advanced Architecture */}
          <div className="bg-[#0D131F] border border-slate-800 rounded-sm p-5 space-y-4">
            <h3 className="text-xs font-bold text-white uppercase tracking-wider flex items-center gap-2">
              <Shield className="w-3.5 h-3.5 text-cyan-400" />
              Advanced Methodological Modules
            </h3>

            <div className="space-y-3 text-xs">
              <label className="flex items-start gap-3 p-3 bg-[#131B2B] border border-slate-800/80 rounded-sm cursor-pointer hover:border-slate-700">
                <input
                  type="checkbox"
                  checked={includeTriangulation}
                  onChange={(e) => setIncludeTriangulation(e.target.checked)}
                  className="mt-0.5 rounded-sm accent-cyan-400 bg-slate-900 border-slate-700"
                />
                <div>
                  <div className="font-bold text-slate-200 flex items-center gap-2">
                    Enable Embedded Causal Triangulation Studio
                    <span className="text-[9px] bg-purple-950 text-purple-300 border border-purple-800 px-1 py-0.2 rounded-sm">
                      Lawlor / Davey Smith
                    </span>
                  </div>
                  <div className="text-[11px] text-slate-400 font-sans mt-0.5 leading-relaxed">
                    Integrate triangulation across complementary study designs (RCTs, Mendelian Randomisation, prospective cohorts, negative controls) with orthogonal bias profiles to assess causal certainty.
                  </div>
                </div>
              </label>
            </div>
          </div>

          {/* Pipeline Implications */}
          <div className="bg-[#0D131F] border border-slate-800 rounded-sm p-4 space-y-2">
            <div className="text-[10px] font-bold uppercase text-slate-400">
              Downstream Pipeline Routing
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-[10px] text-slate-400">
              <div className="bg-[#090D14] p-2 border border-slate-800 rounded-sm">
                <span className="text-slate-500 block">Step 2: Questions</span>
                <span className="text-slate-200 font-semibold">Multi-Question PRISM</span>
              </div>
              <div className="bg-[#090D14] p-2 border border-slate-800 rounded-sm">
                <span className="text-slate-500 block">Step 3: Strategy</span>
                <span className="text-slate-200 font-semibold">PRISMA-S Multi-DB</span>
              </div>
              <div className="bg-[#090D14] p-2 border border-slate-800 rounded-sm">
                <span className="text-slate-500 block">Step 7: Appraisal</span>
                <span className="text-amber-400 font-semibold">{customRobTool || ROB_TOOLS[selectedType.rob]}</span>
              </div>
              <div className="bg-[#090D14] p-2 border border-slate-800 rounded-sm">
                <span className="text-slate-500 block">Step 8: Synthesis</span>
                <span className="text-emerald-400 font-semibold">Meta-Analysis / Triangulation</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
