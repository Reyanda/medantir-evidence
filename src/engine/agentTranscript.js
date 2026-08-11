import { getProject, updateProject } from "./projectstore.js";

let liveSteps = [];
const liveListeners = new Set();
const transcriptListeners = new Set();
let sequence = 0;

const uid = () => `transcript_${Date.now()}_${++sequence}`;

export function pushAgentStep(step, projectId = null) {
  const safeArgs = sanitiseArgs(step.args);
  const entry = { ...step, args: safeArgs, projectId: projectId || null, ts: Date.now() };
  liveSteps = [...liveSteps.slice(-99), entry];
  for (const listener of liveListeners) listener([...liveSteps]);
  if (projectId) appendProjectTranscript(projectId, {
    role: "tool",
    content: step.tool ? `${step.tool}${safeArgs ? ` ${JSON.stringify(safeArgs).slice(0, 500)}` : ""}` : (step.status || "Agent activity"),
    tool: step.tool || null,
  });
  return entry;
}

function sanitiseArgs(args) {
  if (!args || typeof args !== "object") return args || null;
  return Object.fromEntries(Object.entries(args).map(([key, value]) => {
    if (/password|token|secret|credential|cookie|authorization|api.?key/i.test(key)) return [key, "[redacted]"];
    if (/content|body|text|html/i.test(key) && typeof value === "string") return [key, `[${value.length} characters]`];
    if (value && typeof value === "object") return [key, sanitiseArgs(value)];
    return [key, value];
  }));
}

export function clearAgentStream() {
  liveSteps = [];
  for (const listener of liveListeners) listener([]);
}

export function getAgentStream() {
  return [...liveSteps];
}

export function onAgentStream(listener) {
  liveListeners.add(listener);
  return () => liveListeners.delete(listener);
}

export function appendProjectTranscript(projectId, entry) {
  const project = getProject(projectId);
  if (!project || !entry?.role) return null;
  const record = {
    id: entry.id || uid(),
    role: entry.role,
    content: String(entry.content || "").slice(0, 12000),
    tool: entry.tool || null,
    provider: entry.provider || null,
    attachments: Array.isArray(entry.attachments) ? entry.attachments.slice(0, 8).map((item) => ({ ...item, dataUrl: undefined, text: undefined })) : [],
    at: Number(entry.at) || Date.now(),
  };
  updateProject(projectId, { transcripts: [...(project.transcripts || []), record].slice(-300) });
  for (const listener of transcriptListeners) listener(projectId, getProjectTranscript(projectId));
  return record;
}

export function getProjectTranscript(projectId) {
  return getProject(projectId)?.transcripts || [];
}

export function onProjectTranscript(listener) {
  transcriptListeners.add(listener);
  return () => transcriptListeners.delete(listener);
}
