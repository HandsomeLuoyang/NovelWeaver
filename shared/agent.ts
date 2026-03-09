export type AgentToolScope =
  | 'project.read'
  | 'project.write.content'
  | 'project.write.structure'
  | 'project.write.metadata'
  | 'ai.run'
  | 'review.apply'
  | 'export.run'
  | 'ops.rollback'
  | 'models.read'
  | 'models.admin';

export interface AgentToolDefinition {
  name: string;
  description: string;
  scopes: AgentToolScope[];
  sideEffect: boolean;
  inputSchema: Record<string, unknown>;
  outputSchema: Record<string, unknown>;
}

export interface AgentToolInvokeRequest {
  args?: Record<string, unknown>;
  dryRun?: boolean;
  idempotencyKey?: string;
  sessionId?: string;
  checkpointPolicy?: 'auto' | 'skip' | 'force';
  returnMode?: 'summary' | 'full';
}

export interface AgentRunStep {
  id: string;
  toolName: string;
  status: 'running' | 'completed' | 'failed';
  summary: string;
  startedAt: number;
  finishedAt?: number;
  error?: string;
}

export interface AgentRun {
  id: string;
  goal: string;
  caller: 'openclaw' | 'claude-code' | 'ui' | 'manual';
  status: 'running' | 'completed' | 'failed';
  steps: AgentRunStep[];
  createdAt: number;
  updatedAt: number;
  error?: string;
}

export interface OperationJournalEntry {
  id: string;
  actorType: 'agent' | 'ui' | 'system';
  actorId: string;
  toolName: string;
  entityChanges: Array<{
    entityType: string;
    entityId: string;
    bookId?: string;
    beforeVersion?: number | null;
    afterVersion?: number | null;
    summary: string;
  }>;
  checkpointId?: string;
  isAI: boolean;
  createdAt: number;
}
