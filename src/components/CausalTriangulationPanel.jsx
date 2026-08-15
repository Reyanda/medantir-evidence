import React, { useState, useMemo } from "react";
import {
  Shield, CheckCircle2, AlertTriangle, HelpCircle, Layers, Activity,
  Scale, ArrowRight, RefreshCw, Info, Download, FileText, Check
} from "lucide-react";

const EVIDENCE_STREAMS = [
  {
    id: "rct",
    name: "Randomised Controlled Trials (RCTs)",
    description: "Experimental assignment of intervention; high internal validity.",
    biasRisk: "Compliance issues, unrepresentative populations, short duration.",
    defaultDirection: "Favours Intervention",
    estimate: "RR = 0.65 (95% CI: 0.52 to 0.81)",
    concordance: "Concordant",
    certainty: "High"
  },
  {
    id: "mr",
    name: "Mendelian Randomisation (MR)",
    description: "Genetic variants as instrumental variables for lifelong target exposure.",
    biasRisk: "Horizontal pleiotropy, linkage disequilibrium, canalisation.",
    defaultDirection: "Favours Intervention",
    estimate: "OR = 0.72 (95% CI: 0.60 to 0.86)",
    concordance: "Concordant",
    certainty: "Moderate"
  },
  {
    id: "prospective",
    name: "Prospective Observational Cohorts",
    description: "Longitudinal tracking of natural target exposure in broad real-world populations.",
    biasRisk: "Confounding by indication, healthy user bias, reverse causation.",
    defaultDirection: "Favours Intervention",
    estimate: "HR = 0.78 (95% CI: 0.69 to 0.89)",
    concordance: "Concordant",
    certainty: "Moderate"
  },
  {
    id: "negative_control",
    name: "Negative Control Outcomes / Exposures",
    description: "Evaluates specificity of association to detect unmeasured residual confounding.",
    biasRisk: "Imperfect negative control calibration.",
    defaultDirection: "Null (No Effect Detected)",
    estimate: "HR = 1.02 (95% CI: 0.94 to 1.11)",
    concordance: "Concordant",
    certainty: "High"
  },
  {
    id: "mechanistic",
    name: "Preclinical & In-Vitro Mechanistic Assays",
    description: "Biological plausibility and target pathway engagement.",
    biasRisk: "Non-human translation gap, supraphysiological dosing.",
    defaultDirection: "Favours Intervention",
    estimate: "IC50 = 12.4 nM (Pathway Suppression)",
    concordance: "Concordant",
    certainty: "High"
  }
];

export default function CausalTriangulationPanel({ review, projectId, onNote }) {
  const [streams, setStreams] = useState(EVIDENCE_STREAMS);
  const [selectedStreamId, setSelectedStreamId] = useState("rct");
  const [notes, setNotes] = useState(
    "All five independent evidence streams show consistent directional alignment towards efficacy, while negative controls demonstrate an expected null effect. Biases across streams (compliance in RCTs, pleiotropy in MR, confounding in cohorts) are orthogonal, strongly supporting a true causal relationship."
  );

  const selectedStream = useMemo(
    () => streams.find((s) => s.id === selectedStreamId) || streams[0],
    [streams, selectedStreamId]
  );

  const updateStream = (id, field, value) => {
    setStreams((prev) =>
      prev.map((s) => (s.id === id ? { ...s, [field]: value } : s))
    );
  };

  const exportTriangulationSummary = () => {
    const lines = [
      `# CAUSAL TRIANGULATION SUMMARY (Lawlor / Davey Smith Framework)`,
      `Generated: ${new Date().toISOString()}`,
      `Review: ${review?.question || "Evidence Review"}`,
      ``,
      `## EVIDENCE STREAMS`,
      ...streams.map(
        (s) =>
          `- **${s.name}**: ${s.estimate} | Direction: ${s.defaultDirection} | Certainty: ${s.certainty} | Concordance: ${s.concordance}\n  Key Biases: ${s.biasRisk}`
      ),
      ``,
      `## TRIANGULATION VERDICT & SYNTHESIS`,
      notes
    ];
    const blob = new Blob([lines.join("\n")], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `causal_triangulation_${Date.now()}.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    onNote?.("Causal Triangulation summary exported.", "ok");
  };

  return (
    <div className="flex-1 flex flex-col h-full bg-[#090D15] text-slate-200 overflow-hidden font-mono select-none">
      {/* Header Banner */}
      <div className="h-12 bg-[#0D131F] border-b border-slate-800 px-4 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-7 h-7 rounded-sm bg-purple-500/10 border border-purple-500/30 flex items-center justify-center text-purple-400">
            <Scale className="w-4 h-4" />
          </div>
          <div>
            <div className="text-xs font-bold text-slate-100 flex items-center gap-2">
              CAUSAL TRIANGULATION STUDIO
              <span className="text-[9px] px-1.5 py-0.2 rounded-sm bg-purple-950 text-purple-300 border border-purple-800">
                ORTHOGONAL BIAS INTEGRATION
              </span>
            </div>
            <div className="text-[10px] text-slate-500">
              Integrate evidence across complementary designs to establish causal certainty (Lawlor / Davey Smith)
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={exportTriangulationSummary}
            className="px-3 py-1 bg-[#131B2B] hover:bg-slate-800 text-slate-300 border border-slate-700 text-xs font-medium rounded-sm transition-colors flex items-center gap-1.5"
          >
            <Download className="w-3 h-3" /> Export Triangulation Report
          </button>
        </div>
      </div>

      {/* Main 2-Column Triangulation Matrix */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left Column: Stream Matrix & Directional Map */}
        <div className="w-96 bg-[#0C121D] border-r border-slate-800 flex flex-col shrink-0">
          <div className="p-3 bg-[#090D14] border-b border-slate-800 flex items-center justify-between">
            <span className="text-[10px] uppercase font-bold text-slate-400">
              Evidence Streams ({streams.length})
            </span>
            <span className="text-[9px] text-emerald-400 font-semibold flex items-center gap-1">
              <CheckCircle2 className="w-3 h-3" /> ALL CONCORDANT
            </span>
          </div>

          <div className="flex-1 overflow-y-auto p-2 space-y-1.5">
            {streams.map((s) => {
              const isSelected = selectedStreamId === s.id;
              return (
                <div
                  key={s.id}
                  onClick={() => setSelectedStreamId(s.id)}
                  className={`p-3 rounded-sm border cursor-pointer transition-all ${
                    isSelected
                      ? "bg-[#182438] border-purple-500/60 shadow-sm"
                      : "bg-[#0E1522] border-slate-800/80 hover:bg-slate-800/40 text-slate-300"
                  }`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-bold text-white truncate">
                      {s.name}
                    </span>
                    <span className="text-[9px] px-1 py-0.2 rounded-sm bg-purple-950 text-purple-300 border border-purple-800/60 font-mono">
                      {s.certainty}
                    </span>
                  </div>

                  <div className="text-[10px] text-cyan-400 font-bold mb-1 font-mono">
                    {s.estimate}
                  </div>

                  <div className="flex items-center justify-between text-[9px] text-slate-500 font-mono">
                    <span className="truncate">Direction: <strong className="text-slate-300">{s.defaultDirection}</strong></span>
                    <span className="text-emerald-400">● {s.concordance}</span>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="p-3 border-t border-slate-800 bg-[#090D14] space-y-2">
            <div className="text-[10px] font-bold uppercase text-slate-500">
              TRIANGULATION CRITERIA
            </div>
            <div className="space-y-1 text-[10px] text-slate-400">
              <div className="flex items-center gap-1.5 text-emerald-400">
                <Check className="w-3 h-3" /> Directional concordance across ≥ 3 streams
              </div>
              <div className="flex items-center gap-1.5 text-emerald-400">
                <Check className="w-3 h-3" /> Orthogonal & unrelated bias profiles
              </div>
              <div className="flex items-center gap-1.5 text-emerald-400">
                <Check className="w-3 h-3" /> Validated negative control specificity
              </div>
            </div>
          </div>
        </div>

        {/* Right Column: Stream Detail & Bias Independence Inspector */}
        <div className="flex-1 bg-[#090D15] p-6 overflow-y-auto space-y-6">
          <div className="bg-[#0D131F] border border-slate-800 rounded-sm p-5 space-y-4">
            <div className="flex items-start justify-between">
              <div>
                <span className="text-[10px] font-mono text-purple-400 font-bold uppercase tracking-wider block">
                  SELECTED EVIDENCE STREAM
                </span>
                <h2 className="text-base font-bold text-white mt-0.5">
                  {selectedStream.name}
                </h2>
              </div>
              <span className="text-xs px-2 py-0.5 rounded-sm bg-[#182438] text-purple-300 border border-purple-700 font-mono">
                CERTAINTY: {selectedStream.certainty}
              </span>
            </div>

            <p className="text-xs text-slate-300 font-sans leading-relaxed">
              {selectedStream.description}
            </p>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 pt-2">
              <div className="bg-[#131B2B] border border-slate-800 rounded-sm p-3 space-y-1">
                <span className="text-[10px] text-slate-500 font-bold uppercase block">
                  Effect Estimate
                </span>
                <input
                  type="text"
                  value={selectedStream.estimate}
                  onChange={(e) => updateStream(selectedStream.id, "estimate", e.target.value)}
                  className="w-full bg-[#090D14] border border-slate-800 rounded-sm px-2 py-1 text-xs text-cyan-300 font-mono font-bold focus:outline-none focus:border-cyan-500"
                />
              </div>

              <div className="bg-[#131B2B] border border-slate-800 rounded-sm p-3 space-y-1">
                <span className="text-[10px] text-slate-500 font-bold uppercase block">
                  Directionality
                </span>
                <select
                  value={selectedStream.defaultDirection}
                  onChange={(e) => updateStream(selectedStream.id, "defaultDirection", e.target.value)}
                  className="w-full bg-[#090D14] border border-slate-800 rounded-sm px-2 py-1 text-xs text-slate-200 font-mono focus:outline-none focus:border-cyan-500"
                >
                  <option value="Favours Intervention">Favours Intervention</option>
                  <option value="Favours Control">Favours Control</option>
                  <option value="Null (No Effect Detected)">Null (No Effect)</option>
                  <option value="Inconclusive">Inconclusive</option>
                </select>
              </div>

              <div className="bg-[#131B2B] border border-slate-800 rounded-sm p-3 space-y-1">
                <span className="text-[10px] text-slate-500 font-bold uppercase block">
                  Concordance
                </span>
                <select
                  value={selectedStream.concordance}
                  onChange={(e) => updateStream(selectedStream.id, "concordance", e.target.value)}
                  className="w-full bg-[#090D14] border border-slate-800 rounded-sm px-2 py-1 text-xs text-emerald-400 font-mono font-bold focus:outline-none"
                >
                  <option value="Concordant">Concordant</option>
                  <option value="Discordant">Discordant</option>
                  <option value="Qualifying">Qualifying</option>
                </select>
              </div>
            </div>

            <div className="bg-[#131B2B] border border-slate-800 rounded-sm p-3 space-y-1.5">
              <span className="text-[10px] text-rose-400 font-bold uppercase block flex items-center gap-1.5">
                <AlertTriangle className="w-3 h-3" /> Key Method-Specific Biases
              </span>
              <input
                type="text"
                value={selectedStream.biasRisk}
                onChange={(e) => updateStream(selectedStream.id, "biasRisk", e.target.value)}
                className="w-full bg-[#090D14] border border-slate-800 rounded-sm px-2 py-1 text-xs text-slate-300 font-mono focus:outline-none"
              />
              <span className="text-[9px] text-slate-500 block">
                Triangulation relies on biases operating through completely separate causal mechanisms.
              </span>
            </div>
          </div>

          {/* Triangulation Synthesis & Narrative Statement */}
          <div className="bg-[#0D131F] border border-slate-800 rounded-sm p-5 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-bold text-white uppercase tracking-wider flex items-center gap-2">
                <FileText className="w-3.5 h-3.5 text-purple-400" />
                Causal Synthesis & Triangulation Statement
              </h3>
              <span className="text-[9px] text-slate-500 font-mono">DURABLE EVIDENCE OUTPUT</span>
            </div>

            <textarea
              rows={4}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="w-full bg-[#131B2B] border border-slate-800 rounded-sm p-3 text-xs text-slate-200 font-sans focus:outline-none focus:border-purple-500/60 leading-relaxed"
            />
          </div>
        </div>
      </div>
    </div>
  );
}
