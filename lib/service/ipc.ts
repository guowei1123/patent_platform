"use server";

import { Pool, PoolConfig } from "pg";
import { OpenAIEmbeddings } from "@langchain/openai";
import { Document } from "@langchain/core/documents";
import { CallbackHandler } from "@langfuse/langchain";
import { RunnableLambda } from "@langchain/core/runnables";

// 数据库配置
const poolConfig: PoolConfig = {
  host: process.env.POSTGRES_HOST || "localhost",
  port: parseInt(process.env.POSTGRES_PORT || "5432"),
  user: process.env.POSTGRES_USER || "postgres",
  password: process.env.POSTGRES_PASSWORD || "password",
  database: process.env.POSTGRES_DB || "vectordb",
  ssl:
    process.env.POSTGRES_SSL === "true" ? { rejectUnauthorized: false } : false,
};

const tableName = `${process.env.POSTGRES_SCHEMA || "public"}.ipcs`;

// 数据库连接池
let pool: Pool | null = null;

function getPool(): Pool {
  if (!pool) {
    pool = new Pool(poolConfig);
  }
  return pool;
}

const langfuseHandler = new CallbackHandler();

/**
 * 创建 OpenAI Compatible Embedding 模型实例
 * 支持与 Chat 模型独立的 API Key 和 Base URL 配置
 * 优先使用 OPENAI_EMBEDDING_API_KEY / OPENAI_EMBEDDING_BASE_URL,
 * 未配置时回退到 OPENAI_API_KEY / OPENAI_BASE_URL 以保持向后兼容
 */
const embeddings = new OpenAIEmbeddings({
  modelName: process.env.OPENAI_EMBEDDING_MODEL,
  openAIApiKey:
    process.env.OPENAI_EMBEDDING_API_KEY || process.env.OPENAI_API_KEY,
  configuration: {
    baseURL:
      process.env.OPENAI_EMBEDDING_BASE_URL || process.env.OPENAI_BASE_URL,
  },
});

/**
 * IPC 接口定义
 */
export interface IPC {
  code: string; // 编号 (作为主键)
  level: string; // 层级
  description_zh: string; // 中文描述
  description_en?: string; // 英文描述
  note?: string; // 备注
  created_at?: string; // 创建时间
  updated_at?: string; // 修改时间
}

interface IPCRow {
  code: string;
  level: string;
  description_zh: string;
  description_en: string | null;
  note: string | null;
  vector: string;
  created_at: string;
  updated_at: string;
  similarity?: number;
}

/**
 * 将 IPC 添加到向量数据库
 */
export async function addIPCToVectorStore(ipc: IPC): Promise<string> {
  const client = await getPool().connect();
  try {
    // 生成向量 (仅使用中文描述)
    const vector = await RunnableLambda.from((text: string) =>
      embeddings.embedQuery(text),
    ).invoke(ipc.description_zh, { callbacks: [langfuseHandler] });

    // 格式化向量为 pgvector 字符串格式
    const vectorStr = `[${vector.join(",")}]`;

    const query = `
      INSERT INTO ${tableName} (
        code, 
        level, 
        description_zh, 
        description_en, 
        note, 
        vector, 
        created_at, 
        updated_at
      ) 
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      ON CONFLICT (code) DO UPDATE SET
        level = EXCLUDED.level,
        description_zh = EXCLUDED.description_zh,
        description_en = EXCLUDED.description_en,
        note = EXCLUDED.note,
        vector = EXCLUDED.vector,
        updated_at = EXCLUDED.updated_at;
    `;

    const now = new Date().toISOString();
    const values = [
      ipc.code,
      ipc.level,
      ipc.description_zh,
      ipc.description_en || null,
      ipc.note || null,
      vectorStr,
      ipc.created_at || now,
      ipc.updated_at || now,
    ];

    await client.query(query, values);
    return ipc.code;
  } finally {
    client.release();
  }
}

/**
 * 批量添加 IPC 到向量数据库
 */
export async function addIPCsToVectorStore(ipcs: IPC[]): Promise<string[]> {
  if (ipcs.length === 0) return [];

  const client = await getPool().connect();
  try {
    // 准备文档内容 (仅使用中文描述)
    const contents = ipcs.map((ipc) => ipc.description_zh);

    // 批量生成向量
    const vectors = await RunnableLambda.from((texts: string[]) =>
      embeddings.embedDocuments(texts),
    ).invoke(contents, { callbacks: [langfuseHandler] });

    const ids: string[] = [];
    const batchSize = 100; // 这里的 batchSize 取决于 PostgreSQL 参数限制和性能权衡

    for (let i = 0; i < ipcs.length; i += batchSize) {
      const batchIPCs = ipcs.slice(i, i + batchSize);
      const batchVectors = vectors.slice(i, i + batchSize);

      const values: any[] = [];
      const placeholders: string[] = [];
      const now = new Date().toISOString();

      for (let j = 0; j < batchIPCs.length; j++) {
        const ipc = batchIPCs[j];
        const vector = batchVectors[j];
        const vectorStr = `[${vector.join(",")}]`;

        const offset = j * 8;
        placeholders.push(
          `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5}, $${offset + 6}, $${offset + 7}, $${offset + 8})`,
        );

        values.push(
          ipc.code,
          ipc.level,
          ipc.description_zh,
          ipc.description_en || null,
          ipc.note || null,
          vectorStr,
          ipc.created_at || now,
          ipc.updated_at || now,
        );
        ids.push(ipc.code);
      }

      const query = `
        INSERT INTO ${tableName} (
          code, level, description_zh, description_en, note, vector, created_at, updated_at
        ) 
        VALUES ${placeholders.join(", ")}
        ON CONFLICT (code) DO UPDATE SET
          level = EXCLUDED.level,
          description_zh = EXCLUDED.description_zh,
          description_en = EXCLUDED.description_en,
          note = EXCLUDED.note,
          vector = EXCLUDED.vector,
          updated_at = EXCLUDED.updated_at;
      `;

      await client.query(query, values);
    }
    return ids;
  } finally {
    client.release();
  }
}

/**
 * 搜索相似 IPC
 */
export async function searchSimilarIPCs(
  query: string,
  limit: number = 5,
  filter?: Record<string, any>,
): Promise<Document[]> {
  const client = await getPool().connect();
  try {
    // 生成查询向量
    const vector = await RunnableLambda.from((text: string) =>
      embeddings.embedQuery(text),
    ).invoke(query, { callbacks: [langfuseHandler] });
    const vectorStr = `[${vector.join(",")}]`;

    // 构建 SQL
    // 注意：这里使用了余弦距离 (<=>)，相似度 = 1 - 距离
    let sql = `
      SELECT 
        code, 
        level, 
        description_zh, 
        description_en, 
        note, 
        created_at,
        updated_at,
        1 - (vector <=> $1) as similarity
      FROM ${tableName}
    `;

    const params: any[] = [vectorStr];

    // 简单的过滤器实现 (仅支持相等匹配)
    // 为防止 SQL 注入，验证 key 是否为合法列名
    const allowedColumns = [
      "code",
      "level",
      "description_zh",
      "description_en",
      "note",
    ];
    if (filter && Object.keys(filter).length > 0) {
      const conditions: string[] = [];
      let paramIndex = 2;

      for (const [key, value] of Object.entries(filter)) {
        if (allowedColumns.includes(key)) {
          conditions.push(`${key} = $${paramIndex}`);
          params.push(value);
          paramIndex++;
        }
      }

      if (conditions.length > 0) {
        sql += ` WHERE ${conditions.join(" AND ")}`;
      }
    }

    sql += ` ORDER BY vector <=> $1 LIMIT ${limit}`; // 按距离升序排列（即相似度降序）

    const result = await client.query(sql, params);

    return result.rows.map((row: IPCRow) => ({
      pageContent: row.description_zh, // 使用中文描述作为页面内容
      metadata: {
        code: row.code,
        level: row.level,
        description_zh: row.description_zh,
        description_en: row.description_en,
        note: row.note || "",
        created_at: row.created_at,
        updated_at: row.updated_at,
        similarity: ((row.similarity ?? 0) * 100).toFixed(1) + "%",
      },
    }));
  } finally {
    client.release();
  }
}

/**
 * 创建 IPC
 */
export async function createIPC(
  data: Omit<IPC, "created_at" | "updated_at">,
): Promise<string> {
  const ipc: IPC = {
    ...data,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  return await addIPCToVectorStore(ipc);
}

/**
 * 获取 IPC 列表（支持分页和 code 查询）
 */
export async function getIPCList(
  page: number = 1,
  pageSize: number = 10,
  code?: string,
): Promise<{ data: IPC[]; total: number }> {
  const client = await getPool().connect();
  try {
    const offset = (page - 1) * pageSize;

    // 构建查询条件
    let whereClause = "";
    const params: any[] = [];

    if (code) {
      whereClause = "WHERE code ILIKE $1";
      params.push(`%${code}%`);
    }

    // 获取总数
    const countSql = `SELECT COUNT(*) FROM ${tableName} ${whereClause}`;
    const countResult = await client.query(countSql, params);
    const total = parseInt(countResult.rows[0].count);

    // 获取列表数据
    let query = `
      SELECT 
        code, 
        level, 
        description_zh, 
        description_en, 
        note, 
        created_at, 
        updated_at 
      FROM ${tableName}
      ${whereClause}
      ORDER BY code ASC
      LIMIT $${params.length + 1} OFFSET $${params.length + 2}
    `;

    const result = await client.query(query, [...params, pageSize, offset]);

    return {
      data: result.rows.map((row: IPCRow) => ({
        code: row.code,
        level: row.level,
        description_zh: row.description_zh,
        description_en: row.description_en || undefined,
        note: row.note || undefined,
        created_at: row.created_at,
        updated_at: row.updated_at,
      })),
      total,
    };
  } finally {
    client.release();
  }
}

/**
 * 删除 IPC
 */
export async function deleteIPC(id: string): Promise<void> {
  const client = await getPool().connect();
  try {
    await client.query(`DELETE FROM ${tableName} WHERE code = $1`, [id]);
  } finally {
    client.release();
  }
}

/**
 * 获取 IPC 向量
 */
export async function getIPCVector(code: string): Promise<number[] | null> {
  const client = await getPool().connect();
  try {
    const result = await client.query(
      `SELECT vector FROM ${tableName} WHERE code = $1`,
      [code],
    );
    if (result.rows.length === 0) {
      return null;
    }
    const vectorStr = result.rows[0].vector;
    // pgvector returns string like "[0.1,0.2,...]" which is valid JSON array format
    if (typeof vectorStr === "string") {
      return JSON.parse(vectorStr);
    }
    return vectorStr;
  } finally {
    client.release();
  }
}
