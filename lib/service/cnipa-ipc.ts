"use server";

import { Pool, type PoolConfig } from "pg";

import type { IPCSearchResult } from "./redis-ipc.ts";

const poolConfig: PoolConfig = {
  host: process.env.CNIPA_PG_HOST || "127.0.0.1",
  port: Number.parseInt(process.env.CNIPA_PG_PORT || "5432", 10),
  database: process.env.CNIPA_PG_DB || "patent_etl",
  user: process.env.CNIPA_PG_USER || "postgres",
  password: process.env.CNIPA_PG_PASSWORD,
  ssl:
    process.env.CNIPA_PG_SSL === "true"
      ? { rejectUnauthorized: false }
      : false,
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
};

let pool: Pool | undefined;

function getPool() {
  pool ??= new Pool(poolConfig);
  return pool;
}

interface CNIPAIPCRow {
  code: string;
  level: number | null;
  title_zh: string | null;
  title_en: string;
  version: string;
  match_rank: number;
}

/**
 * 从 CNIPA IPC 分类主表中检索分类号。
 * 该表不包含向量列，因此采用分类号精确度与中英文标题关键词进行排序。
 */
export async function searchCNIPAIPCs(
  query: string,
  limit: number = 5,
): Promise<IPCSearchResult[]> {
  const normalizedQuery = query.trim();
  const safeLimit = Math.min(Math.max(Math.trunc(limit), 1), 10);
  if (!normalizedQuery) return [];

  const result = await getPool().query<CNIPAIPCRow>(
    `
      SELECT
        COALESCE(NULLIF(code, ''), code_norm) AS code,
        level,
        title_zh,
        title_en,
        version,
        CASE
          WHEN UPPER(code_norm) = UPPER($1) OR UPPER(code) = UPPER($1) THEN 4
          WHEN code_norm ILIKE $2 OR code ILIKE $2 THEN 3
          WHEN COALESCE(title_zh, '') ILIKE $2 THEN 2
          WHEN title_en ILIKE $2 THEN 1
          ELSE 0
        END AS match_rank
      FROM cnipa.ipc_classification
      WHERE
        code_norm ILIKE $2
        OR code ILIKE $2
        OR COALESCE(title_zh, '') ILIKE $2
        OR title_en ILIKE $2
      ORDER BY match_rank DESC, level ASC NULLS LAST, code_norm ASC
      LIMIT $3
    `,
    [normalizedQuery, `%${normalizedQuery}%`, safeLimit],
  );

  return result.rows.map((row) => ({
    pageContent: row.title_zh || row.title_en,
    metadata: {
      code: row.code,
      level: row.level === null ? "" : String(row.level),
      description_zh: row.title_zh || "",
      description_en: row.title_en,
      note: `IPC ${row.version}`,
    },
  }));
}
