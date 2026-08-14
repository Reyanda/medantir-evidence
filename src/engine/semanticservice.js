import { activeProject } from "./projectstore.js";
import { reviewApi } from "./reviewApiClient.js";

const runPath = (runId, suffix) => `/runs/${encodeURIComponent(String(runId || "").trim())}/${suffix}`;

export function storedProductionRun(projectId = activeProject()) {
  if (!projectId) return "";
  try {
    const marker = JSON.parse(localStorage.getItem(`medantir.review.productionRun.v1:${projectId}`) || "null");
    return String(marker?.runId || "");
  } catch {
    return "";
  }
}

export async function getSemanticCapabilities(projectId = activeProject()) {
  return reviewApi("/evidence-os/semantic-capabilities", { projectId });
}

export async function getSemanticIndexManifest(runId, projectId = activeProject()) {
  return reviewApi(runPath(runId, "semantic-index-manifest"), { projectId });
}

export async function listSemanticUnits(runId, { offset = 0, limit = 100, projectId = activeProject() } = {}) {
  return reviewApi(`${runPath(runId, "semantic-units")}?offset=${encodeURIComponent(offset)}&limit=${encodeURIComponent(limit)}`, { projectId });
}

export async function getSemanticUnit(runId, unitId, projectId = activeProject()) {
  return reviewApi(runPath(runId, `semantic-units/${encodeURIComponent(unitId)}`), { projectId });
}

export async function listSemanticClusters(runId, projectId = activeProject()) {
  return reviewApi(runPath(runId, "semantic-clusters"), { projectId });
}

export async function getSemanticCluster(runId, clusterId, projectId = activeProject()) {
  return reviewApi(runPath(runId, `semantic-clusters/${encodeURIComponent(clusterId)}`), { projectId });
}

export async function semanticSearch(runId, request, projectId = activeProject()) {
  return reviewApi(runPath(runId, "semantic-search"), { method: "POST", body: request, projectId });
}

export async function rebuildSemanticIndex(runId, projectId = activeProject()) {
  return reviewApi(runPath(runId, "semantic-index/rebuild"), { method: "POST", body: {}, projectId });
}
