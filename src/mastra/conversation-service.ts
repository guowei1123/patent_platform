import { randomUUID } from "node:crypto";
import type { ConversationType } from "./contracts";
import { patentMemory } from "./memory";
import { ensureMastraStore, mastraStore } from "./storage";
import type { RagResult } from "../../lib/rag/types";

export interface ConversationRecord {
  id: string;
  resourceId: string;
  type: ConversationType;
  title: string;
  titleIsCustom: boolean;
  status: string;
  activeRunId: string | null;
  pendingApproval: unknown;
  lastMessagePreview: string | null;
  searchResults: unknown;
  createdAt: string;
  updatedAt: string;
}

let tablesReady: Promise<void> | undefined;

async function ensureTables() {
  await ensureMastraStore();
  if (!tablesReady) {
    tablesReady = (async () => {
      await mastraStore.db.none(`
        CREATE TABLE IF NOT EXISTS mastra_agent.agent_conversations (
          id UUID PRIMARY KEY,
          resource_id TEXT NOT NULL,
          type TEXT NOT NULL CHECK (type IN ('qa', 'search', 'report', 'disclosure', 'analysis', 'search_formula')),
          title TEXT NOT NULL,
          title_is_custom BOOLEAN NOT NULL DEFAULT FALSE,
          status TEXT NOT NULL DEFAULT 'active',
          active_run_id TEXT,
          pending_approval JSONB,
          last_message_preview TEXT,
          search_results JSONB,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          expires_at TIMESTAMPTZ NOT NULL
        );
        CREATE INDEX IF NOT EXISTS agent_conversations_resource_updated_idx
          ON mastra_agent.agent_conversations(resource_id, updated_at DESC);
        ALTER TABLE mastra_agent.agent_conversations ADD COLUMN IF NOT EXISTS search_results JSONB;
        ALTER TABLE mastra_agent.agent_conversations ADD COLUMN IF NOT EXISTS title_is_custom BOOLEAN NOT NULL DEFAULT FALSE;
        ALTER TABLE mastra_agent.agent_conversations
          DROP CONSTRAINT IF EXISTS agent_conversations_type_check;
        ALTER TABLE mastra_agent.agent_conversations
          ADD CONSTRAINT agent_conversations_type_check
          CHECK (type IN ('qa', 'search', 'report', 'disclosure', 'analysis', 'search_formula'));
        CREATE TABLE IF NOT EXISTS mastra_agent.qa_message_sources (
          conversation_id UUID NOT NULL REFERENCES mastra_agent.agent_conversations(id) ON DELETE CASCADE,
          message_id TEXT NOT NULL,
          result JSONB NOT NULL,
          PRIMARY KEY (conversation_id, message_id)
        );
      `);
    })();
  }
  await tablesReady;
}

function toRecord(row: Record<string, unknown>): ConversationRecord {
  return {
    id: String(row.id),
    resourceId: String(row.resource_id),
    type: row.type as ConversationType,
    title: String(row.title),
    titleIsCustom: row.title_is_custom === true,
    status: String(row.status),
    activeRunId: row.active_run_id ? String(row.active_run_id) : null,
    pendingApproval: row.pending_approval,
    lastMessagePreview: row.last_message_preview
      ? String(row.last_message_preview)
      : null,
    searchResults: row.search_results,
    createdAt: new Date(String(row.created_at)).toISOString(),
    updatedAt: new Date(String(row.updated_at)).toISOString(),
  };
}

export function titleFromMessage(message: string) {
  return message.replace(/\s+/g, " ").trim().slice(0, 30) || "新对话";
}

export async function cleanupExpiredConversations() {
  await ensureTables();
  const rows = await mastraStore.db.any<{ id: string }>(
    "DELETE FROM mastra_agent.agent_conversations WHERE expires_at < NOW() RETURNING id",
  );
  await Promise.all(
    rows.map((row) => patentMemory.deleteThread(row.id).catch(() => undefined)),
  );
}

export async function createConversation(
  resourceId: string,
  type: ConversationType,
  title: string,
) {
  await ensureTables();
  const id = randomUUID();
  const row = await mastraStore.db.one<Record<string, unknown>>(
    `INSERT INTO mastra_agent.agent_conversations
      (id, resource_id, type, title, expires_at)
     VALUES ($1, $2, $3, $4, NOW() + INTERVAL '30 days') RETURNING *`,
    [id, resourceId, type, title],
  );
  return toRecord(row);
}

export async function getConversation(resourceId: string, id: string) {
  await ensureTables();
  const row = await mastraStore.db.oneOrNone<Record<string, unknown>>(
    "SELECT * FROM mastra_agent.agent_conversations WHERE id = $1 AND resource_id = $2 AND expires_at >= NOW()",
    [id, resourceId],
  );
  return row ? toRecord(row) : null;
}

export async function listConversations(
  resourceId: string,
  type?: ConversationType,
) {
  await cleanupExpiredConversations();
  const rows = await mastraStore.db.any<Record<string, unknown>>(
    type
      ? "SELECT * FROM mastra_agent.agent_conversations WHERE resource_id = $1 AND type = $2 ORDER BY updated_at DESC LIMIT 50"
      : "SELECT * FROM mastra_agent.agent_conversations WHERE resource_id = $1 ORDER BY updated_at DESC LIMIT 50",
    type ? [resourceId, type] : [resourceId],
  );
  return rows.map(toRecord);
}

export async function updateConversation(
  resourceId: string,
  id: string,
  patch: Partial<
    Pick<
      ConversationRecord,
      | "title"
      | "titleIsCustom"
      | "status"
      | "activeRunId"
      | "pendingApproval"
      | "lastMessagePreview"
      | "searchResults"
    >
  >,
) {
  await ensureTables();
  const shouldUpdateRun = patch.activeRunId !== undefined;
  const shouldUpdateApproval = patch.pendingApproval !== undefined;
  const row = await mastraStore.db.oneOrNone<Record<string, unknown>>(
    `UPDATE mastra_agent.agent_conversations SET
      title = COALESCE($3, title), status = COALESCE($4, status),
      active_run_id = CASE WHEN $5 THEN $6 ELSE active_run_id END,
      pending_approval = CASE WHEN $7 THEN $8::jsonb ELSE pending_approval END,
      last_message_preview = COALESCE($9, last_message_preview),
      search_results = CASE WHEN $10 THEN $11::jsonb ELSE search_results END,
      title_is_custom = COALESCE($12, title_is_custom),
      updated_at = NOW(), expires_at = NOW() + INTERVAL '30 days'
     WHERE id = $1 AND resource_id = $2 RETURNING *`,
    [
      id,
      resourceId,
      patch.title ?? null,
      patch.status ?? null,
      shouldUpdateRun,
      patch.activeRunId ?? null,
      shouldUpdateApproval,
      patch.pendingApproval === undefined
        ? null
        : JSON.stringify(patch.pendingApproval),
      patch.lastMessagePreview ?? null,
      patch.searchResults !== undefined,
      patch.searchResults === undefined
        ? null
        : JSON.stringify(patch.searchResults),
      patch.titleIsCustom ?? null,
    ],
  );
  return row ? toRecord(row) : null;
}

export async function deleteConversation(resourceId: string, id: string) {
  await ensureTables();
  const row = await mastraStore.db.oneOrNone<{ id: string }>(
    "DELETE FROM mastra_agent.agent_conversations WHERE id = $1 AND resource_id = $2 RETURNING id",
    [id, resourceId],
  );
  if (!row) return false;
  await patentMemory.deleteThread(id).catch(() => undefined);
  return true;
}

export async function getConversationMessages(resourceId: string, id: string) {
  const conversation = await getConversation(resourceId, id);
  if (!conversation) return null;
  const thread = await patentMemory.getThreadById({ threadId: id });
  const result = thread
    ? await patentMemory.recall({
        threadId: id,
        resourceId,
        perPage: 100,
        page: 0,
      })
    : { messages: [] };
  const rows = await mastraStore.db.any<{
    message_id: string;
    result: RagResult;
  }>(
    `SELECT s.message_id, s.result FROM mastra_agent.qa_message_sources s
     JOIN mastra_agent.agent_conversations c ON c.id = s.conversation_id
     WHERE c.id = $1 AND c.resource_id = $2 AND c.expires_at >= NOW()`,
    [id, resourceId],
  );
  return {
    conversation,
    messages: result.messages,
    searchResults: conversation.searchResults,
    ragSources: Object.fromEntries(
      rows.map((row) => [row.message_id, row.result]),
    ),
  };
}

export async function saveQaSources(
  resourceId: string,
  conversationId: string,
  messageId: string,
  result: RagResult,
) {
  await ensureTables();
  await mastraStore.db.none(
    `INSERT INTO mastra_agent.qa_message_sources (conversation_id, message_id, result)
     SELECT id, $3, $4::jsonb FROM mastra_agent.agent_conversations
     WHERE id = $1 AND resource_id = $2 AND expires_at >= NOW()
     ON CONFLICT (conversation_id, message_id) DO UPDATE SET result = EXCLUDED.result`,
    [conversationId, resourceId, messageId, JSON.stringify(result)],
  );
}
