import React, { useEffect, useMemo, useRef, useState } from "react";
import { listReviewProjects } from "../engine/forestRuntime.js";
import { createReview, saveReview, loadReview, progress, STAGES } from "../engine/reviewengine.js";
import { createProject } from "../engine/projectstore.js";
import { importSandbox } from "../engine/reviewSandbox.js";
import { databaseName } from "../engine/searchStrategy.js";
import { PRISM_FACETS, routeDatabases } from "./QuestionBuilder.jsx";
import {
  TEMPLATES, getTemplate, applyTemplate, stageApplicability, templateMethodology,
  templateChildren, eligibilityScaffold,
} from "../engine/reviewTemplates.js";

// The launcher: the surface a first contact with the workbench lands on. It
// offers the three honest routes — resume something already here, start from a
// method template, or start fresh — and nothing else. It is a launcher, not a
// landing page: same chrome, same density, no hero.
//
// The detail pane states what the choice will write AND what it will not, so
// the operator can see that no question, no term and no study is being invented
// on their behalf.

const NOT_SET = "the question, any search term, population, intervention or outcome, any record, study or effect estimate";

export default function LaunchPanel({ onOpenProject, onNote }) {
  const [projects, setProjects] = useState(() => listReviewProjects());
  const [templateId, setTemplateId] = useState("fresh");
  const [name, setName] = useState("");
  const [databases, setDatabases] = useState(() => routeDatabases(getTemplate("fresh").realm));
  const fileInput = useRef(null);

  const template = getTemplate(templateId);

  // The realm routes the databases; the operator can change them here, and what
  // they leave selected is what the review is created with.
  useEffect(() => { setDatabases(routeDatabases(getTemplate(templateId).realm)); }, [templateId]);

  const resumable = useMemo(() => projects.map((project) => {
    const review = loadReview(project.id);
    return {
      id: project.id,
      name: project.name,
      updated: project.updated || project.created || 0,
      question: review?.question || "",
      records: (review?.objects?.records || []).length,
      stages: review ? progress(review) : { done: 0, total: STAGES.length, pct: 0 },
      hasReview: !!review,
    };
  }).sort((a, b) => b.updated - a.updated), [projects]);

  const methodology = useMemo(() => templateMethodology(template), [template]);
  const stages = useMemo(() => stageApplicability(template), [template]);
  const facetLabels = useMemo(
    () => PRISM_FACETS.filter((facet) => template.facets.includes(facet.key)),
    [template]
  );

  const toggleDatabase = (id) => setDatabases((current) => (
    current.includes(id) ? current.filter((db) => db !== id) : [...current, id]
  ));

  const create = () => {
    const spec = applyTemplate(template, { name, databases });
    const project = createProject(spec.project.name, {
      projectType: spec.project.projectType,
      mode: spec.project.mode,
    });
    // createReview seeds the twelve-stage machine; the template supplies the
    // method structure over the top of it. The question stays empty: it is
    // written on the Question tab, and everything downstream compiles from it.
    const base = createReview("");
    const review = {
      ...base,
      ...spec.review,
      createdAt: Date.now(),
      objects: { ...base.objects },
      stages: base.stages,
    };
    saveReview(project.id, review);
    setProjects(listReviewProjects());
    setName("");
    onNote?.(`"${project.name}" created from the ${template.label.toLowerCase()} template — ${methodology.typeName}, ${methodology.robTool}. Write the question next.`, "ok");
    onOpenProject?.(project.id);
  };

  const importFile = async (file) => {
    if (!file) return;
    try {
      const text = await file.text();
      const result = importSandbox(text, { name: name.trim() });
      if (!result.ok) { onNote?.(`Import failed: ${result.reason}`, "err"); return; }
      setProjects(listReviewProjects());
      const counts = result.review.objects.searches.length;
      onNote?.(`Imported "${result.project.name}" from ${file.name} — ${counts} database search(es), ${result.review.objects.studies.length} study record(s). The record library and eligibility criteria are not in review.yaml; import them from the sandbox folder.`, "ok");
      onOpenProject?.(result.projectId);
    } catch (cause) {
      onNote?.(`Import failed: ${cause?.message || cause}`, "err");
    }
  };

  return (
    <div style={{ display: "grid", gridTemplateColumns: "minmax(170px, 1fr) minmax(150px, .8fr) minmax(240px, 1.4fr)", height: "100%", minHeight: 0 }}>
      {/* RESUME — real projects with real progress. Absent when there are none. */}
      <div style={{ borderRight: "1px solid var(--line)", overflow: "auto", minWidth: 0 }}>
        <div className="wb-insp-title">
          Resume
          <span className="wb-spacer" />
          <span className="wb-count">{resumable.length}</span>
        </div>
        {resumable.length === 0 && (
          <div style={{ padding: "8px", fontSize: 11, color: "var(--fg-faint)", lineHeight: 1.6 }}>
            No reviews in this workspace yet. Start one on the right, or import a
            <span className="wb-mono"> review.yaml</span> a sandbox already produced.
          </div>
        )}
        {resumable.map((item) => (
          <div key={item.id} style={{ borderBottom: "1px solid var(--line)" }}>
            <div className="wb-row" title={item.question || "no question written yet"}>
              <span className="lbl">{item.name}</span>
              <span className="n">{item.stages.done}/{item.stages.total}</span>
              <button className="wb-btn" style={{ height: 16, padding: "0 5px", fontSize: 10 }} onClick={() => onOpenProject?.(item.id)}>Open</button>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "0 8px 4px 8px" }}>
              <span className="wb-meter" style={{ flex: 1 }}><i style={{ width: `${item.stages.pct}%` }} /></span>
              <span className="wb-mono" style={{ fontSize: 10, color: "var(--fg-faint)" }}>{item.records} records</span>
              <span className="wb-mono" style={{ fontSize: 10, color: "var(--fg-faint)" }}>{item.updated ? new Date(item.updated).toLocaleDateString() : "—"}</span>
            </div>
          </div>
        ))}
        <div style={{ padding: "6px 8px" }}>
          <button className="wb-btn" onClick={() => fileInput.current?.click()} title="Rebuild a review from a sandbox manifest">Import review.yaml</button>
          <input
            ref={fileInput} type="file" accept=".yaml,.yml,text/yaml" style={{ display: "none" }}
            onChange={(e) => { const file = e.target.files?.[0]; e.target.value = ""; importFile(file); }}
          />
        </div>
      </div>

      {/* START — one choice list, "Start fresh" first. */}
      <div style={{ borderRight: "1px solid var(--line)", overflow: "auto", minWidth: 0 }}>
        <div className="wb-insp-title">Start</div>
        {TEMPLATES.map((item) => (
          <div
            key={item.id}
            className={`wb-row ${templateId === item.id ? "sel" : ""}`}
            onClick={() => setTemplateId(item.id)}
            title={item.note}
          >
            <span className="dot" style={{ background: templateId === item.id ? "var(--accent)" : "var(--line-strong)" }} />
            <span className="lbl">{item.label}</span>
            {templateChildren(item) && <span className="n">children</span>}
          </div>
        ))}
      </div>

      {/* TEMPLATE DETAIL — exactly what the choice writes, and what it does not. */}
      <div style={{ overflow: "hidden", minWidth: 0, display: "flex", flexDirection: "column" }}>
        <div className="wb-insp-title">
          {template.label}
          <span className="wb-spacer" />
          <span className="wb-count">{template.typeId}</span>
        </div>
        <div style={{ flex: "1 1 auto", overflow: "auto", minHeight: 0 }}>
          <div style={{ padding: "6px 8px", fontSize: 11, color: "var(--fg-dim)", lineHeight: 1.6 }}>{template.note}</div>

          <div className="wb-prop"><span className="k">Review type</span><span className="v">{methodology.typeName}</span></div>
          <div className="wb-prop"><span className="k">Kind</span><span className="v">{template.kind}{templateChildren(template) ? " · reviews as units, each with its own primaries" : ""}</span></div>
          <div className="wb-prop"><span className="k">Framework</span><span className="v">{methodology.framework}</span></div>
          <div className="wb-prop"><span className="k">RoB tool</span><span className="v">{methodology.robTool}</span></div>
          <div className="wb-prop"><span className="k">Synthesis</span><span className="v">{methodology.synthesis}</span></div>

          <div className="wb-insp-title">Stages that apply</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 4, padding: "4px 8px" }}>
            {STAGES.map((stage) => (
              <span
                key={stage.id}
                className="wb-tag"
                style={stages[stage.id] === "n/a" ? { color: "var(--fg-faint)", textDecoration: "line-through" } : undefined}
                title={stages[stage.id] === "n/a" ? `${stage.name} — not applicable to this design` : stage.name}
              >
                {stage.id}
              </span>
            ))}
          </div>

          <div className="wb-insp-title">PRISM facets that matter</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 4, padding: "4px 8px" }}>
            {facetLabels.map((facet) => <span key={facet.key} className="wb-tag" title={facet.label}>{facet.code} {facet.label}</span>)}
          </div>

          <div className="wb-insp-title">Eligibility scaffold — headings only</div>
          <div className="wb-mono" style={{ padding: "4px 8px", fontSize: 10.5, color: "var(--fg-faint)", whiteSpace: "pre-wrap", lineHeight: 1.5 }}>
            {eligibilityScaffold(template)}
          </div>

          {template.deviations && (
            <>
              <div className="wb-insp-title">Deviations to record</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 4, padding: "4px 8px" }}>
                {template.deviations.map((heading) => <span key={heading} className="wb-tag">{heading}</span>)}
              </div>
            </>
          )}

          <div className="wb-insp-title">
            Databases routed from the realm
            <span className="wb-spacer" />
            <span className="wb-count">{template.realm}</span>
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 4, padding: "4px 8px" }}>
            {routeDatabases(template.realm).map((id) => (
              <button key={id} className={`wb-tag ${databases.includes(id) ? "on" : ""}`} onClick={() => toggleDatabase(id)}>
                {databaseName(id) || id}
              </button>
            ))}
          </div>
          <div style={{ padding: "0 8px 6px", fontSize: 10.5, color: "var(--fg-faint)" }}>
            Click to change. The realm is a routing default, not a protocol decision — the review's databases stay editable afterwards.
          </div>

          <div className="wb-insp-title">What this template does not set</div>
          <div style={{ padding: "4px 8px 10px", fontSize: 11, color: "var(--fg-dim)", lineHeight: 1.6 }}>
            It does not set {NOT_SET}. Those are yours to write, starting with the
            question on the next tab.
          </div>
        </div>

        <div className="wb-decide" style={{ gap: 6 }}>
          <input
            className="wb-input"
            style={{ flex: 1 }}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Review name"
            onKeyDown={(e) => { if (e.key === "Enter") create(); }}
          />
          <button className="wb-btn on" onClick={create}>Create</button>
        </div>
      </div>
    </div>
  );
}
