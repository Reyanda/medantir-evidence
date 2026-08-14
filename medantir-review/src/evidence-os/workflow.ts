import { scientificContentHash } from '../core/canonical-hash.js';
import type { PipelineState, ReviewType, StageName } from '../core/types.js';
import { createReviewProtocol } from '../protocols/review-protocol.js';
import type { EvidenceWorkflowNode, EvidenceWorkflowPlan, WorkflowExecutionClass } from './types.js';

function executionClass(stage: StageName, humanGate: EvidenceWorkflowNode['humanGate']): WorkflowExecutionClass {
  if (stage === 'human-verify') return 'human-gated';
  if (['search-execute', 'fulltext-retrieve', 'register-protocol', 'identity'].includes(stage)) {
    return humanGate === 'never' ? 'external-io' : 'mixed';
  }
  if (['question', 'risk-of-bias', 'grade', 'fulltext-screen', 'protocol-finalise'].includes(stage)) return 'mixed';
  if (humanGate !== 'never') return 'human-gated';
  return 'deterministic';
}

function topologicalOrder(nodes: EvidenceWorkflowNode[]): string[] {
  const byId = new Map(nodes.map((node) => [node.nodeId, node]));
  const indegree = new Map(nodes.map((node) => [node.nodeId, 0]));
  const outgoing = new Map(nodes.map((node) => [node.nodeId, [] as string[]]));
  for (const node of nodes) {
    for (const dependency of node.dependsOn) {
      if (!byId.has(dependency)) throw new Error(`Workflow node ${node.nodeId} depends on unknown node ${dependency}.`);
      indegree.set(node.nodeId, (indegree.get(node.nodeId) ?? 0) + 1);
      outgoing.get(dependency)!.push(node.nodeId);
    }
  }
  const ready = nodes
    .filter((node) => (indegree.get(node.nodeId) ?? 0) === 0)
    .sort((a, b) => a.position - b.position)
    .map((node) => node.nodeId);
  const ordered: string[] = [];
  while (ready.length > 0) {
    const id = ready.shift()!;
    ordered.push(id);
    for (const target of outgoing.get(id) ?? []) {
      const next = (indegree.get(target) ?? 0) - 1;
      indegree.set(target, next);
      if (next === 0) {
        ready.push(target);
        ready.sort((left, right) => (byId.get(left)?.position ?? 0) - (byId.get(right)?.position ?? 0));
      }
    }
  }
  if (ordered.length !== nodes.length) throw new Error('Evidence workflow contains a cycle.');
  return ordered;
}

export function buildEvidenceWorkflowPlan(
  reviewType: ReviewType,
  state?: PipelineState,
  generatedAt = new Date().toISOString(),
): EvidenceWorkflowPlan {
  if (!Number.isFinite(Date.parse(generatedAt))) throw new Error('Evidence workflow generatedAt must be a valid timestamp.');
  if (state && state.request.reviewType !== reviewType) throw new Error('Workflow state review type does not match requested review type.');
  const protocol = createReviewProtocol(reviewType);
  const artifactProducer = new Map<string, string>();
  const nodes: EvidenceWorkflowNode[] = protocol.stages.map((stage, position) => {
    const nodeId = `stage:${stage.stage}`;
    const dependsOn = [...new Set(stage.requiredArtifacts.flatMap((artifact) => {
      const producer = artifactProducer.get(artifact);
      return producer ? [producer] : [];
    }))].sort();
    const node: EvidenceWorkflowNode = {
      nodeId,
      stage: stage.stage,
      position,
      dependsOn,
      requiredArtifacts: [...stage.requiredArtifacts],
      producedArtifacts: [...stage.producedArtifacts],
      maxRetries: stage.maxRetries,
      humanGate: stage.humanGate,
      executionClass: executionClass(stage.stage, stage.humanGate),
      ...(state ? { status: state.stages[stage.stage].status } : {}),
    };
    for (const artifact of stage.producedArtifacts) artifactProducer.set(artifact, nodeId);
    return node;
  });
  const ordered = topologicalOrder(nodes);
  const content = {
    schemaVersion: 'medantir-evidence-workflow/1' as const,
    reviewType,
    generatedAt,
    acyclic: true as const,
    topologicalOrder: ordered,
    nodes,
    backend: {
      current: 'in-process-durable' as const,
      resumable: true as const,
      checkpointed: true as const,
      externalActionReconciliation: true as const,
      distributedExecution: false as const,
      supportedFutureBackends: ['Temporal', 'Dagster', 'Prefect', 'Airflow'] as Array<'Temporal' | 'Dagster' | 'Prefect' | 'Airflow'>,
    },
  };
  return {
    ...content,
    workflowHash: scientificContentHash(content),
  };
}
