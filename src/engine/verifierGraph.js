import { getRunVerifierBundle } from "./reviewservice.js";

/**
 * Fetch only the body-free verifier graph projection from the constrained
 * verifier bundle. This deliberately does not fall back to GET /runs/:id.
 */
export async function getRunVerifierGraph(runId) {
  const result = await getRunVerifierBundle(runId);
  if (!result.ok) return result;
  const graph = result.verifier?.graph;
  if (!graph || graph.schemaVersion !== "medantir-verifier-graph/1") {
    return { ok: false, error: "Verifier graph is not available for this run", status: 404 };
  }
  return { ok: true, graph };
}
