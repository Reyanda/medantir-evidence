import React, { useState, useMemo } from "react";

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
    <div style={{ display: "grid", gridTemplateColumns: "320px 1fr", height: "100%", minHeight: 0 }}>
      {/* Left Column: Streams */}
      <div style={{ borderRight: "1px solid var(--line)", display: "flex", flexDirection: "column", background: "var(--bg-panel)" }}>
        <div className="wb-insp-title">
          Evidence Streams
          <span className="wb-spacer" />
          <span className="wb-count" style={{ color: "var(--ok)", borderColor: "var(--ok)" }}>5 CONCORDANT</span>
        </div>
        <div style={{ flex: 1, overflow: "auto" }}>
          {streams.map((s) => {
            const isSel = selectedStreamId === s.id;
            return (
              <div
                key={s.id}
                className={`wb-row ${isSel ? "sel" : ""}`}
                style={{ height: "auto", minHeight: 44, padding: "6px 8px", flexDirection: "column", alignItems: "flex-start", gap: 2 }}
                onClick={() => setSelectedStreamId(s.id)}
              >
                <div style={{ display: "flex", width: "100%", alignItems: "center", justifyContent: "space-between" }}>
                  <span className="lbl" style={{ fontWeight: 600, color: isSel ? "var(--fg-bright)" : "var(--fg)" }}>{s.name}</span>
                  <span className="n">{s.certainty}</span>
                </div>
                <div style={{ fontFamily: "var(--mono)", fontSize: 10.5, color: "var(--accent)" }}>
                  {s.estimate}
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", width: "100%", fontSize: 10, color: "var(--fg-dim)" }}>
                  <span>{s.defaultDirection}</span>
                  <span style={{ color: "var(--ok)" }}>● {s.concordance}</span>
                </div>
              </div>
            );
          })}
        </div>

        <div style={{ padding: 8, borderTop: "1px solid var(--line)", fontSize: 10.5, color: "var(--fg-dim)", lineHeight: 1.4 }}>
          <div style={{ fontWeight: 600, color: "var(--fg)", marginBottom: 4, textTransform: "uppercase", fontSize: 10, letterSpacing: 0.3 }}>
            Triangulation Rule
          </div>
          Evidence streams must feature orthogonal, unrelated sources of bias to demonstrate causality.
        </div>
      </div>

      {/* Right Column: Inspector & Narrative */}
      <div style={{ padding: 16, overflow: "auto", display: "flex", flexDirection: "column", gap: 14 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", borderBottom: "1px solid var(--line)", paddingBottom: 8 }}>
          <div>
            <div style={{ fontSize: 10, fontFamily: "var(--mono)", color: "var(--accent)", textTransform: "uppercase", letterSpacing: 0.5 }}>
              Step 8: Causal Triangulation Studio
            </div>
            <div style={{ fontSize: 15, fontWeight: 700, color: "var(--fg-bright)", marginTop: 2 }}>
              {selectedStream.name}
            </div>
          </div>
          <button className="wb-btn" onClick={exportTriangulationSummary}>
            Export Summary (.md)
          </button>
        </div>

        <div style={{ fontSize: 12, color: "var(--fg)", lineHeight: 1.5, background: "var(--bg-panel)", padding: "10px 12px", border: "1px solid var(--line)", borderRadius: 2 }}>
          {selectedStream.description}
        </div>

        <div className="wb-insp-title">Stream Parameters</div>
        <table className="wb-grid wb-grid-soft">
          <thead>
            <tr>
              <th style={{ width: 140 }}>Parameter</th>
              <th>Value</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td style={{ fontWeight: 600 }}>Effect Estimate</td>
              <td>
                <input
                  type="text"
                  className="wb-input wb-mono"
                  style={{ width: "100%" }}
                  value={selectedStream.estimate}
                  onChange={(e) => updateStream(selectedStream.id, "estimate", e.target.value)}
                />
              </td>
            </tr>
            <tr>
              <td style={{ fontWeight: 600 }}>Directionality</td>
              <td>
                <select
                  className="wb-select"
                  style={{ width: "100%" }}
                  value={selectedStream.defaultDirection}
                  onChange={(e) => updateStream(selectedStream.id, "defaultDirection", e.target.value)}
                >
                  <option value="Favours Intervention">Favours Intervention</option>
                  <option value="Favours Control">Favours Control</option>
                  <option value="Null (No Effect Detected)">Null (No Effect Detected)</option>
                  <option value="Inconclusive">Inconclusive</option>
                </select>
              </td>
            </tr>
            <tr>
              <td style={{ fontWeight: 600 }}>Concordance</td>
              <td>
                <select
                  className="wb-select"
                  style={{ width: "100%" }}
                  value={selectedStream.concordance}
                  onChange={(e) => updateStream(selectedStream.id, "concordance", e.target.value)}
                >
                  <option value="Concordant">Concordant</option>
                  <option value="Discordant">Discordant</option>
                  <option value="Qualifying">Qualifying</option>
                </select>
              </td>
            </tr>
            <tr>
              <td style={{ fontWeight: 600 }}>Key Biases</td>
              <td>
                <input
                  type="text"
                  className="wb-input"
                  style={{ width: "100%" }}
                  value={selectedStream.biasRisk}
                  onChange={(e) => updateStream(selectedStream.id, "biasRisk", e.target.value)}
                />
              </td>
            </tr>
          </tbody>
        </table>

        <div className="wb-insp-title">Causal Synthesis & Triangulation Narrative</div>
        <textarea
          className="wb-textarea"
          rows={5}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          style={{ width: "100%", fontSize: 11.5 }}
        />
      </div>
    </div>
  );
}
