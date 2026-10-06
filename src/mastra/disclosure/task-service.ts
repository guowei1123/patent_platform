import { randomUUID } from "node:crypto";
import { ensureMastraStore, mastraStore } from "../storage";
import {
  initialState,
  type DisclosureState,
  type DisclosureTask,
  type DisclosureCommand,
} from "./contracts";

let ready: Promise<void> | undefined;
async function ensureTables() {
  await ensureMastraStore();
  if (!ready)
    ready = mastraStore.db
      .none(
        `
    ALTER TABLE mastra_agent.agent_conversations ADD COLUMN IF NOT EXISTS title_is_custom BOOLEAN NOT NULL DEFAULT FALSE;
    CREATE TABLE IF NOT EXISTS mastra_agent.disclosure_tasks (
      id UUID PRIMARY KEY, conversation_id UUID NOT NULL REFERENCES mastra_agent.agent_conversations(id) ON DELETE CASCADE,
      resource_id TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 0, state JSONB NOT NULL,
      status TEXT NOT NULL DEFAULT 'idle', error TEXT, pending JSONB, operation_id UUID, last_operation_id UUID,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), lease_until TIMESTAMPTZ,
      expires_at TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '30 days'
    );
    CREATE INDEX IF NOT EXISTS disclosure_resource_idx ON mastra_agent.disclosure_tasks(resource_id, updated_at DESC);
    CREATE TABLE IF NOT EXISTS mastra_agent.disclosure_versions (
      task_id UUID NOT NULL REFERENCES mastra_agent.disclosure_tasks(id) ON DELETE CASCADE,
      version INTEGER NOT NULL, state JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY(task_id, version)
    );
    CREATE TABLE IF NOT EXISTS mastra_agent.disclosure_assets (
      id UUID PRIMARY KEY, task_id UUID NOT NULL REFERENCES mastra_agent.disclosure_tasks(id) ON DELETE CASCADE,
      mime TEXT NOT NULL, data BYTEA NOT NULL
    );
  `,
      )
      .then(() => undefined)
      .catch((error) => {
        ready = undefined;
        throw error;
      });
  await ready;
}
function record(row: Record<string, unknown>): DisclosureTask {
  return {
    id: String(row.id),
    conversationId: String(row.conversation_id),
    version: Number(row.version),
    state: row.state as DisclosureState,
    status: row.status as DisclosureTask["status"],
    error: row.error ? String(row.error) : null,
    pending: row.pending as DisclosureCommand | null,
    lastOperationId: row.last_operation_id
      ? String(row.last_operation_id)
      : null,
    updatedAt: new Date(String(row.updated_at)).toISOString(),
  };
}
export async function createDisclosureTask(
  resourceId: string,
  conversationId: string,
) {
  await ensureTables();
  const row = await mastraStore.db.one<Record<string, unknown>>(
    `
    WITH task AS (INSERT INTO mastra_agent.disclosure_tasks(id, conversation_id, resource_id, state)
      VALUES($1,$2,$3,$4::jsonb) RETURNING *)
    , snapshot AS (INSERT INTO mastra_agent.disclosure_versions(task_id,version,state) SELECT id,version,state FROM task)
    SELECT * FROM task`,
    [randomUUID(), conversationId, resourceId, JSON.stringify(initialState())],
  );
  return record(row);
}
export async function getDisclosureTask(resourceId: string, id: string) {
  await ensureTables();
  // 服务中断后租约到期，保留原请求供用户重试。
  await mastraStore.db.none(
    `UPDATE mastra_agent.disclosure_tasks SET status='failed',error='上次执行中断，可重试。'
    WHERE id=$1 AND resource_id=$2 AND status='running' AND lease_until < NOW()`,
    [id, resourceId],
  );
  const row = await mastraStore.db.oneOrNone<Record<string, unknown>>(
    `SELECT * FROM mastra_agent.disclosure_tasks WHERE id=$1 AND resource_id=$2 AND expires_at>NOW()`,
    [id, resourceId],
  );
  return row ? record(row) : null;
}

export async function getDisclosureTaskByConversationId(
  resourceId: string,
  conversationId: string,
) {
  await ensureTables();
  const row = await mastraStore.db.oneOrNone<Record<string, unknown>>(
    `SELECT * FROM mastra_agent.disclosure_tasks
     WHERE conversation_id=$1 AND resource_id=$2 AND expires_at>NOW()`,
    [conversationId, resourceId],
  );
  return row ? record(row) : null;
}
export async function listDisclosureTasks(
  resourceId: string,
  conversationIds?: string[],
) {
  await ensureTables();
  return mastraStore.db.any<{
    id: string;
    conversationId: string;
    title: string;
    version: number;
    updatedAt: string;
  }>(
    `SELECT d.id,d.conversation_id AS "conversationId",
    CASE WHEN c.title_is_custom THEN c.title
      ELSE COALESCE(NULLIF(LEFT(BTRIM(d.state->'sections'->>'inventionName'),80),''),'新交底书') END AS title,
    d.version,d.updated_at AS "updatedAt"
    FROM mastra_agent.disclosure_tasks d JOIN mastra_agent.agent_conversations c ON c.id=d.conversation_id
    WHERE d.resource_id=$1 AND d.expires_at>NOW()
      AND ($2::uuid[] IS NULL OR d.conversation_id=ANY($2::uuid[]))
    ORDER BY d.updated_at DESC LIMIT 50`,
    [resourceId, conversationIds ?? null],
  );
}
export async function claimDisclosure(
  resourceId: string,
  id: string,
  command: DisclosureCommand,
) {
  await ensureTables();
  const row = await mastraStore.db.oneOrNone<Record<string, unknown>>(
    `UPDATE mastra_agent.disclosure_tasks
    SET status='running',error=NULL,pending=$4::jsonb,operation_id=$5,lease_until=NOW()+INTERVAL '4 minutes',updated_at=NOW()
    WHERE id=$1 AND resource_id=$2 AND version=$3 AND expires_at>NOW() AND (status<>'running' OR lease_until<NOW()) RETURNING *`,
    [
      id,
      resourceId,
      command.baseVersion,
      JSON.stringify(command),
      command.operationId,
    ],
  );
  return row ? record(row) : null;
}
/** 工具链执行期间续租，不改变文稿版本，也不能续租其他用户或操作的任务。 */
export async function renewDisclosureLease(
  resourceId: string,
  id: string,
  operationId: string,
) {
  await mastraStore.db.none(
    `UPDATE mastra_agent.disclosure_tasks SET lease_until=NOW()+INTERVAL '4 minutes'
     WHERE id=$1 AND resource_id=$2 AND operation_id=$3 AND status='running'`,
    [id, resourceId, operationId],
  );
}

export async function commitDisclosure(
  resourceId: string,
  id: string,
  command: DisclosureCommand,
  state: DisclosureState,
) {
  // 更新与版本快照在同一 SQL 语句内提交；旧执行无法覆盖新版本。
  const row = await mastraStore.db.oneOrNone<Record<string, unknown>>(
    `WITH updated AS (
    UPDATE mastra_agent.disclosure_tasks SET state=$5::jsonb,version=version+1,status='idle',error=NULL,pending=NULL,
      last_operation_id=$4,operation_id=NULL,lease_until=NULL,updated_at=NOW(),expires_at=NOW()+INTERVAL '30 days'
    WHERE id=$1 AND resource_id=$2 AND version=$3 AND operation_id=$4 AND status='running' RETURNING *)
    , snapshot AS (INSERT INTO mastra_agent.disclosure_versions(task_id,version,state) SELECT id,version,state FROM updated)
    , conversation AS (UPDATE mastra_agent.agent_conversations c SET
      title=CASE WHEN c.title_is_custom THEN c.title
        ELSE COALESCE(NULLIF(LEFT(BTRIM(updated.state->'sections'->>'inventionName'),80),''),'新交底书') END,
      updated_at=NOW(),expires_at=NOW()+INTERVAL '30 days'
      FROM updated WHERE c.id=updated.conversation_id AND c.resource_id=$2)
    SELECT * FROM updated`,
    [
      id,
      resourceId,
      command.baseVersion,
      command.operationId,
      JSON.stringify(state),
    ],
  );
  if (!row) throw new Error("版本已更新，请重新加载任务");
  return record(row);
}
export async function failDisclosure(
  resourceId: string,
  id: string,
  operationId: string,
) {
  await mastraStore.db.none(
    `UPDATE mastra_agent.disclosure_tasks SET status='failed',error='本次处理失败，已保留原文稿和请求，可重试。',lease_until=NULL
    WHERE id=$1 AND resource_id=$2 AND operation_id=$3`,
    [id, resourceId, operationId],
  );
}
export async function getDisclosureVersion(
  resourceId: string,
  id: string,
  version: number,
) {
  await ensureTables();
  const row = await mastraStore.db.oneOrNone<{ state: DisclosureState }>(
    `SELECT v.state FROM mastra_agent.disclosure_versions v JOIN mastra_agent.disclosure_tasks t ON t.id=v.task_id
    WHERE t.id=$1 AND t.resource_id=$2 AND v.version=$3 AND t.expires_at>NOW()`,
    [id, resourceId, version],
  );
  return row?.state || null;
}
export async function putDisclosureAsset(
  resourceId: string,
  taskId: string,
  id: string,
  mime: string,
  data: Buffer,
) {
  await ensureTables();
  await mastraStore.db.none(
    `INSERT INTO mastra_agent.disclosure_assets(id,task_id,mime,data)
    SELECT $3,id,$4,$5 FROM mastra_agent.disclosure_tasks WHERE id=$1 AND resource_id=$2 AND expires_at>NOW()
    ON CONFLICT(id) DO NOTHING`,
    [taskId, resourceId, id, mime, data],
  );
}
export async function getDisclosureAsset(
  resourceId: string,
  taskId: string,
  id: string,
) {
  await ensureTables();
  return mastraStore.db.oneOrNone<{ mime: string; data: Buffer }>(
    `SELECT a.mime,a.data FROM mastra_agent.disclosure_assets a JOIN mastra_agent.disclosure_tasks t ON t.id=a.task_id
    WHERE t.id=$1 AND t.resource_id=$2 AND a.id=$3 AND t.expires_at>NOW()`,
    [taskId, resourceId, id],
  );
}
