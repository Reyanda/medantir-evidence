import type {
  EvidenceGraphSnapshot,
  EvidenceObject,
  WorkflowJobSnapshot,
} from './types.js';

/** Replaceable durable object store. Production baseline reconstructs objects from hash-chained run checkpoints. */
export interface EvidenceObjectRepositoryPort {
  putObject(object: EvidenceObject): Promise<{ stored: boolean; objectId: string }>;
  getObject(objectId: string): Promise<EvidenceObject | null>;
  putGraph(runId: string, graph: EvidenceGraphSnapshot): Promise<{ stored: boolean; graphHash: string }>;
  getGraph(runId: string, graphHash?: string): Promise<EvidenceGraphSnapshot | null>;
}

/** Workflow SPI for replacing the single-process runtime without changing scientific stages. */
export interface DistributedWorkflowBackendPort {
  readonly backend: 'Temporal' | 'Dagster' | 'Prefect' | 'Airflow';
  submit(input: { runId: string; workflowHash: string; payloadReference: string }): Promise<WorkflowJobSnapshot>;
  status(jobId: string): Promise<WorkflowJobSnapshot | null>;
  cancel(jobId: string, reason: string): Promise<WorkflowJobSnapshot>;
}

/** Queue SPI for durable workers. No implementation is claimed in the single-replica baseline. */
export interface EvidenceMessageQueuePort {
  readonly backend: 'Kafka' | 'RabbitMQ' | 'Redis Streams';
  publish(input: { topic: string; key: string; payloadReference: string; idempotencyKey: string }): Promise<{ messageId: string }>;
  consume(input: { topic: string; consumerGroup: string; maxMessages: number }): Promise<Array<{ messageId: string; key: string; payloadReference: string }>>;
  acknowledge(messageId: string): Promise<void>;
  reject(messageId: string, reason: string, retryable: boolean): Promise<void>;
}

/** Immutable large-object storage for PDFs, exports, model bundles, figures, and supplements. */
export interface EvidenceArtifactStorePort {
  put(input: { sha256: string; mediaType: string; bytes: Uint8Array; metadata: Record<string, string> }): Promise<{ objectId: string; stored: boolean }>;
  get(objectId: string): Promise<{ sha256: string; mediaType: string; bytes: Uint8Array; metadata: Record<string, string> } | null>;
}
