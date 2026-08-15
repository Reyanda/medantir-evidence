import React, { useState, useMemo } from "react";
import { REVIEW_TYPES, FRAMEWORKS, ROB_TOOLS, SYNTHESIS, getReviewType } from "../engine/reviewtypes.js";
import { saveReview } from "../engine/reviewengine.js";

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
      onNote?.(`Methodology applied: ${target.name} (${fw}, ${rob}).`, "ok");
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
    onNote?.(`Methodology saved: ${selectedType.name}`, "ok");
  };

  return (
    <div style={{ display: "grid", gridTemplateColumns: "280px 1fr", height: "100%", minHeight: 0 }}>
      {/* Left Column: Catalogue */}
      <div style={{ borderRight: "1px solid var(--line)", display: "flex", flexDirection: "column", background: "var(--bg-panel)" }}>
        <div className="wb-insp-title">
          Methodology catalogue
          <span className="wb-spacer" />
          <span className="wb-count">{filteredTypes.length}</span>
        </div>
        <div style={{ padding: "4px 8px", borderBottom: "1px solid var(--line)" }}>
          <input
            type="text"
            className="wb-input"
            style={{ width: "100%", height: 22 }}
            placeholder="Filter review designs…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
        <div style={{ flex: 1, overflow: "auto" }}>
          {filteredTypes.map((t) => {
            const isSel = selectedTypeId === t.id;
            const isCur = (review?.methodology?.typeId || "systematic") === t.id;
            return (
              <div
                key={t.id}
                className={`wb-row ${isSel ? "sel" : ""}`}
                style={{ height: "auto", minHeight: 38, padding: "5px 8px", flexDirection: "column", alignItems: "flex-start", gap: 2 }}
                onClick={() => applyMethodology(t.id)}
              >
                <div style={{ display: "flex", width: "100%", alignItems: "center", justifyContent: "space-between" }}>
                  <span className="lbl" style={{ fontWeight: 600, color: isSel ? "var(--fg-bright)" : "var(--fg)" }}>{t.name}</span>
                  {isCur && <span className="n" style={{ color: "var(--ok)", borderColor: "var(--ok)" }}>ACTIVE</span>}
                </div>
                <div style={{ fontSize: 10.5, color: "var(--fg-dim)", lineHeight: 1.3, whiteSpace: "normal" }}>
                  {t.desc}
                </div>
                <div style={{ display: "flex", gap: 4, marginTop: 2, fontFamily: "var(--mono)", fontSize: 9.5, color: "var(--fg-faint)" }}>
                  <span>{FRAMEWORKS[t.framework] || t.framework}</span>
                  <span>·</span>
                  <span>{ROB_TOOLS[t.rob] || t.rob}</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Right Column: Specification & Architecture */}
      <div style={{ padding: 16, overflow: "auto", display: "flex", flexDirection: "column", gap: 14 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", borderBottom: "1px solid var(--line)", paddingBottom: 8 }}>
          <div>
            <div style={{ fontSize: 10, fontFamily: "var(--mono)", color: "var(--accent)", textTransform: "uppercase", letterSpacing: 0.5 }}>
              Step 1: Review Methodology & Architecture
            </div>
            <div style={{ fontSize: 15, fontWeight: 700, color: "var(--fg-bright)", marginTop: 2 }}>
              {selectedType.name}
            </div>
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            <button className="wb-btn on" onClick={saveConfiguration}>
              Apply & Save
            </button>
            {onNavigateNext && (
              <button className="wb-btn" onClick={onNavigateNext}>
                Next: Questions →
              </button>
            )}
          </div>
        </div>

        <div style={{ fontSize: 12, color: "var(--fg)", lineHeight: 1.5, background: "var(--bg-panel)", padding: "10px 12px", border: "1px solid var(--line)", borderRadius: 2 }}>
          {selectedType.desc}
        </div>

        <div className="wb-insp-title">Governance & Methodological Standards</div>
        <table className="wb-grid wb-grid-soft">
          <thead>
            <tr>
              <th style={{ width: 180 }}>Component</th>
              <th>Standard / Tool</th>
              <th style={{ width: 220 }}>Specification</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td style={{ fontWeight: 600 }}>Reporting Framework</td>
              <td>
                <select
                  className="wb-select"
                  style={{ width: "100%" }}
                  value={customFramework || FRAMEWORKS[selectedType.framework]}
                  onChange={(e) => setCustomFramework(e.target.value)}
                >
                  {Object.values(FRAMEWORKS).map((f) => (
                    <option key={f} value={f}>{f}</option>
                  ))}
                </select>
              </td>
              <td style={{ color: "var(--fg-dim)", fontFamily: "var(--mono)", fontSize: 10.5 }}>PRISMA statement & checklist</td>
            </tr>
            <tr>
              <td style={{ fontWeight: 600 }}>Risk of Bias (Appraisal)</td>
              <td>
                <select
                  className="wb-select"
                  style={{ width: "100%" }}
                  value={customRobTool || ROB_TOOLS[selectedType.rob]}
                  onChange={(e) => setCustomRobTool(e.target.value)}
                >
                  {Object.values(ROB_TOOLS).map((r) => (
                    <option key={r} value={r}>{r}</option>
                  ))}
                </select>
              </td>
              <td style={{ color: "var(--fg-dim)", fontFamily: "var(--mono)", fontSize: 10.5 }}>Domain-based critical appraisal</td>
            </tr>
            <tr>
              <td style={{ fontWeight: 600 }}>Synthesis Model</td>
              <td>
                <select
                  className="wb-select"
                  style={{ width: "100%" }}
                  value={customSynthesis || SYNTHESIS[selectedType.synthesis]}
                  onChange={(e) => setCustomSynthesis(e.target.value)}
                >
                  {Object.values(SYNTHESIS).map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              </td>
              <td style={{ color: "var(--fg-dim)", fontFamily: "var(--mono)", fontSize: 10.5 }}>Quantitative/Qualitative synthesis rule</td>
            </tr>
          </tbody>
        </table>

        <div className="wb-insp-title">Advanced Synthesis Modules</div>
        <div style={{ background: "var(--bg-panel)", border: "1px solid var(--line)", padding: "8px 12px", borderRadius: 2 }}>
          <label style={{ display: "flex", alignItems: "flex-start", gap: 8, cursor: "default" }}>
            <input
              type="checkbox"
              checked={includeTriangulation}
              onChange={(e) => setIncludeTriangulation(e.target.checked)}
              style={{ marginTop: 2 }}
            />
            <div>
              <div style={{ fontWeight: 600, color: "var(--fg-bright)" }}>
                Enable Embedded Causal Triangulation (Lawlor / Davey Smith)
              </div>
              <div style={{ fontSize: 11, color: "var(--fg-dim)", lineHeight: 1.4, marginTop: 2 }}>
                Synthesise evidence across complementary designs (RCTs, Mendelian Randomisation, prospective cohorts, negative controls) with orthogonal bias profiles to determine causal certainty.
              </div>
            </div>
          </label>
        </div>
      </div>
    </div>
  );
}
