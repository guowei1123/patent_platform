import { randomUUID } from "node:crypto";
import { ensureMastraStore, mastraStore } from "../storage";
import type { ReportSuspendPayload, ReportWorkflowContext } from "./contracts";

export interface ReportTaskRecord {
  id: string;
  conversationId: string;
  resourceId: string;
  workflowRunId: string;
  status: string;
  currentStage: string;
  state: ReportWorkflowContext | null;
  pendingApproval: ReportSuspendPayload | null;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
}

let tablesReady: Promise<void> | undefined;

async function ensureTables() {
  await ensureMastraStore();
  if (!tablesReady) {
    tablesReady = mastraStore.db
      .none(
        `
      CREATE TABLE IF NOT EXISTS mastra_agent.report_tasks (
        id UUID PRIMARY KEY,
        conversation_id UUID NOT NULL REFERENCES mastra_agent.agent_conversations(id) ON DELETE CASCADE,
        resource_id TEXT NOT NULL,
        workflow_run_id TEXT NOT NULL UNIQUE,
        status TEXT NOT NULL DEFAULT 'active',
        current_stage TEXT NOT NULL DEFAULT 'initializing',
        state JSONB,
        pending_approval JSONB,
        error_message TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        expires_at TIMESTAMPTZ NOT NULL
      );
      CREATE INDEX IF NOT EXISTS report_tasks_resource_updated_idx
        ON mastra_agent.report_tasks(resource_id, updated_at DESC);
      ALTER TABLE mastra_agent.report_tasks
        ADD COLUMN IF NOT EXISTS error_message TEXT;
    `,
      )
      .then(() => undefined);
  }
  await tablesReady;
}

function toRecord(row: Record<string, unknown>): ReportTaskRecord {
  return {
    id: String(row.id),
    conversationId: String(row.conversation_id),
    resourceId: String(row.resource_id),
    workflowRunId: String(row.workflow_run_id),
    status: String(row.status),
    currentStage: String(row.current_stage),
    state: (row.state as ReportWorkflowContext | null) || null,
    pendingApproval:
      (row.pending_approval as ReportSuspendPayload | null) || null,
    errorMessage: row.error_message ? String(row.error_message) : null,
    createdAt: new Date(String(row.created_at)).toISOString(),
    updatedAt: new Date(String(row.updated_at)).toISOString(),
  };
}

export async function createReportTask(
  resourceId: string,
  conversationId: string,
) {
  await ensureTables();
  const id = randomUUID();
  const workflowRunId = randomUUID();
  const row = await mastraStore.db.one<Record<string, unknown>>(
    `INSERT INTO mastra_agent.report_tasks
      (id, conversation_id, resource_id, workflow_run_id, expires_at)
     VALUES ($1, $2, $3, $4, NOW() + INTERVAL '30 days') RETURNING *`,
    [id, conversationId, resourceId, workflowRunId],
  );
  return toRecord(row);
}

export async function getReportTask(resourceId: string, id: string) {
  await ensureTables();
  const row = await mastraStore.db.oneOrNone<Record<string, unknown>>(
    `SELECT * FROM mastra_agent.report_tasks
     WHERE id = $1 AND resource_id = $2 AND expires_at >= NOW()`,
    [id, resourceId],
  );
  return row ? toRecord(row) : null;
}

export async function getReportTaskByConversation(
  resourceId: string,
  conversationId: string,
) {
  await ensureTables();
  const row = await mastraStore.db.oneOrNone<Record<string, unknown>>(
    `SELECT * FROM mastra_agent.report_tasks
     WHERE conversation_id = $1 AND resource_id = $2 AND expires_at >= NOW()
     ORDER BY updated_at DESC LIMIT 1`,
    [conversationId, resourceId],
  );
  return row ? toRecord(row) : null;
}

export async function updateReportTask(
  resourceId: string,
  id: string,
  patch: {
    status: string;
    currentStage: string;
    state?: ReportWorkflowContext | null;
    pendingApproval?: ReportSuspendPayload | null;
    errorMessage?: string | null;
  },
) {
  await ensureTables();
  const row = await mastraStore.db.oneOrNone<Record<string, unknown>>(
    `UPDATE mastra_agent.report_tasks SET
       status = $3,
       current_stage = $4,
       state = CASE WHEN $5 THEN $6::jsonb ELSE state END,
       pending_approval = $7::jsonb,
       error_message = CASE WHEN $8 THEN $9 ELSE error_message END,
       updated_at = NOW(),
       expires_at = NOW() + INTERVAL '30 days'
     WHERE id = $1 AND resource_id = $2 RETURNING *`,
    [
      id,
      resourceId,
      patch.status,
      patch.currentStage,
      patch.state !== undefined,
      patch.state === undefined ? null : JSON.stringify(patch.state),
      JSON.stringify(patch.pendingApproval ?? null),
      patch.errorMessage !== undefined,
      patch.errorMessage ?? null,
    ],
  );
  return row ? toRecord(row) : null;
}

export async function restartReportTask(
  resourceId: string,
  id: string,
  state: ReportWorkflowContext,
) {
  await ensureTables();
  const row = await mastraStore.db.oneOrNone<Record<string, unknown>>(
    `UPDATE mastra_agent.report_tasks SET
       workflow_run_id = $3, status = 'active', current_stage = 'returning',
       state = $4::jsonb, pending_approval = NULL, error_message = NULL,
       updated_at = NOW(), expires_at = NOW() + INTERVAL '30 days'
     WHERE id = $1 AND resource_id = $2 RETURNING *`,
    [id, resourceId, randomUUID(), JSON.stringify(state)],
  );
  return row ? toRecord(row) : null;
}

export async function claimReportApproval(
  resourceId: string,
  id: string,
  kind: string,
) {
  await ensureTables();
  const row = await mastraStore.db.oneOrNone<Record<string, unknown>>(
    `UPDATE mastra_agent.report_tasks SET
       status = 'active',
       pending_approval = NULL,
       error_message = NULL,
       updated_at = NOW(),
       expires_at = NOW() + INTERVAL '30 days'
     WHERE id = $1
       AND resource_id = $2
       AND status = 'awaiting_approval'
       AND pending_approval->>'kind' = $3
     RETURNING *`,
    [id, resourceId, kind],
  );
  return row ? toRecord(row) : null;
}
