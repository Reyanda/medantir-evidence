import { getHarness, routeHarness, runHarness } from "./harness.js";
import { agentTools } from "./agent.js";
import { filterToolsForMode, getOperatingMode } from "./operatingModes.js";
import { addProjectRun, getProject, getProjectRun, retrieve, updateProjectRun } from "./projectstore.js";

export const RUN_STATES = ["planned", "approved", "running", "qc", "complete", "failed", "cancelled"];

const stamp = (type, detail = {}) => ({ type, at: Date.now(), ...detail });
const runId = () => `run_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;

function rolePlan(harness, mode, allowedTools) {
  return [
    {
      id: "lead",
      name: "Lead orchestrator",
      responsibility: `Own scope, ordering, project boundaries, and ${mode.name} mode constraints.`,
      harnessId: "general",
      tools: ["project_read", "project_retrieve", "project_write"],
    },
    {
      id: "specialist",
      name: `${harness.name} specialist`,
      responsibility: "Produce the task output using only the routed capability and its declared tools.",
      harnessId: harness.id,
      tools: allowedTools,
    },
    {
      id: "reviewer",
      name: "Independent QC reviewer",
      responsibility: "Check grounding, scope compliance, completeness, uncertainty, and consequential-action boundaries.",
      harnessId: "general",
      tools: [],
    },
  ];
}

export function proposeOrchestration(projectId, task, { harnessId } = {}) {
  const project = getProject(projectId);
  if (!project) throw new Error("Project not found");
  if (!String(task || "").trim()) throw new Error("Task is required");
  const routed = routeHarness(task);
  const harness = harnessId ? getHarness(harnessId) : routed.harness;
  const mode = getOperatingMode(project.mode);
  const allowedTools = filterToolsForMode(mode.id, harness.tools || agentTools());
  const run = {
    id: runId(),
    task: String(task).trim(),
    state: "planned",
    mode: mode.id,
    harnessId: harness.id,
    route: { selected: harness.id, score: routed.score, alternatives: routed.alternatives },
    roles: rolePlan(harness, mode, allowedTools),
    approval: null,
    result: null,
    qc: null,
    trace: [stamp("planned", { harnessId: harness.id, mode: mode.id })],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  addProjectRun(projectId, run);
  return run;
}

export function approveOrchestration(projectId, id, { actor = "current-user" } = {}) {
  const run = getProjectRun(projectId, id);
  if (!run || run.state !== "planned") return { ok: false, reason: "Only a planned run can be approved." };
  const approval = { actor, at: Date.now(), scope: "this run only" };
  const updated = updateProjectRun(projectId, id, { state: "approved", approval, trace: [...run.trace, stamp("approved", { actor })] });
  return { ok: true, run: updated };
}

export function cancelOrchestration(projectId, id, { actor = "current-user" } = {}) {
  const run = getProjectRun(projectId, id);
  if (!run || !["planned", "approved"].includes(run.state)) return { ok: false, reason: "Only a planned or approved run can be cancelled." };
  const updated = updateProjectRun(projectId, id, {
    state: "cancelled",
    trace: [...run.trace, stamp("cancelled", { actor })],
  });
  return { ok: true, run: updated };
}

export async function executeOrchestration(projectId, id, { runner = runHarness } = {}) {
  let run = getProjectRun(projectId, id);
  const project = getProject(projectId);
  if (!project || !run) return { ok: false, reason: "Run not found." };
  if (run.state !== "approved") return { ok: false, reason: "Human approval is required before execution." };

  const hits = retrieve(projectId, run.task, 5);
  const context = hits.map((hit) => `[${hit.name}] ${hit.snippet}`).join("\n");
  const harness = getHarness(run.harnessId);
  const plannedTools = run.roles?.find((role) => role.id === "specialist")?.tools;
  const allowedTools = filterToolsForMode(run.mode, plannedTools || harness.tools || agentTools());
  const framed = [
    `Project: ${project.name}`,
    `Operating mode: ${getOperatingMode(run.mode).name}`,
    `Task: ${run.task}`,
    context ? `Project evidence:\n${context}` : "Project evidence: no matching files retrieved.",
    "Stay within the approved task. Do not perform consequential external actions.",
  ].join("\n\n");

  run = updateProjectRun(projectId, id, { state: "running", trace: [...run.trace, stamp("execution-started", { retrievedFiles: hits.map((hit) => hit.path), allowedTools })] });
  const result = await runner(run.harnessId, framed, { maxSteps: 8, toolFilter: allowedTools });
  if (!result?.ok) {
    const failed = updateProjectRun(projectId, id, { state: "failed", result, trace: [...run.trace, stamp("execution-failed", { reason: result?.reason || "unknown" })] });
    return { ok: false, reason: result?.reason || "Execution failed.", run: failed };
  }

  run = updateProjectRun(projectId, id, { state: "qc", result, trace: [...run.trace, stamp("execution-complete"), stamp("qc-started")] });
  const qcPrompt = `Independently quality-check the following output against the approved task. Identify unsupported claims, missing evidence, scope breaches, and unsafe or consequential actions. Return a concise verdict and required corrections.\n\nTASK:\n${run.task}\n\nOUTPUT:\n${String(result.answer || result.reason || "").slice(0, 12000)}`;
  const qc = await runner("general", qcPrompt, { maxSteps: 2, toolFilter: [] });
  const finalState = qc?.ok ? "complete" : "failed";
  const completed = updateProjectRun(projectId, id, { state: finalState, qc, trace: [...run.trace, stamp(qc?.ok ? "qc-complete" : "qc-failed"), stamp(finalState)] });
  return { ok: finalState === "complete", run: completed, result, qc, reason: qc?.ok ? undefined : qc?.reason || "QC failed." };
}

export function listOrchestrations(projectId) {
  return [...(getProject(projectId)?.runs || [])].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
}
