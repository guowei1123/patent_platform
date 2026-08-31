import { Pool, PoolConfig } from "pg";

export interface PatentSearchResult {
  id: string;
  docNumber: string;
  kind: string;
  title: string;
  abstract: string;
  pubDate: string;
  applicant: string;
  ipcCodes: string[];
}

export interface PatentSearchResponse {
  total: number;
  limit: number;
  offset: number;
  items: PatentSearchResult[];
}

export type PatentSortBy =
  | "pub_date_desc"
  | "pub_date_asc"
  | "relevance";

export interface PatentSearchParams {
  /** 关键词列表(命中标题或摘要任一即可) */
  keywords?: string[];
  /** IPC 分类号前缀(如 G06F 匹配所有子类) */
  ipcCodes?: string[];
  /** 申请人模糊匹配 */
  applicant?: string;
  /** 公开日范围-起始(YYYY-MM-DD) */
  dateFrom?: string;
  /** 公开日范围-结束(YYYY-MM-DD) */
  dateTo?: string;
  /** 文献类型过滤(如 B / U / A / S) */
  kind?: string;
  /** 排序方式 */
  sortBy?: PatentSortBy;
  /** 分页大小,默认 20 */
  limit?: number;
  /** 分页偏移量,默认 0 */
  offset?: number;
}

// 连接 patent_etl 库(中国专利 ETL)
const poolConfig: PoolConfig = {
  host: process.env.CNIPA_PG_HOST || "localhost",
  port: parseInt(process.env.CNIPA_PG_PORT || "5432"),
  user: process.env.CNIPA_PG_USER || "postgres",
  password: process.env.CNIPA_PG_PASSWORD || "password",
  database: process.env.CNIPA_PG_DB || "patent_etl",
};

let pool: Pool | null = null;

function getPool(): Pool {
  if (!pool) pool = new Pool(poolConfig);
  return pool;
}

function normalize(input?: string | string[]): string[] {
  if (!input) return [];
  const arr = Array.isArray(input) ? input : [input];
  return arr
    .flatMap((s) => String(s).split(/[，、,\n\r]/))
    .map((s) => s.trim())
    .filter(Boolean);
}

export async function searchPatents(
  params: PatentSearchParams,
): Promise<PatentSearchResponse> {
  const {
    keywords = [],
    ipcCodes = [],
    applicant,
    dateFrom,
    dateTo,
    kind,
    sortBy = "pub_date_desc",
    limit = 20,
    offset = 0,
  } = params;

  const kw = normalize(keywords);
  const ipc = normalize(ipcCodes);

  // 至少要有一个过滤条件,避免全表扫描
  if (
    !kw.length &&
    !ipc.length &&
    !applicant &&
    !dateFrom &&
    !dateTo &&
    !kind
  ) {
    return { total: 0, limit, offset, items: [] };
  }

  const client = await getPool().connect();
  try {
    const conditions: string[] = [];
    const paramsArr: unknown[] = [];
    let paramIdx = 1;

    // 关键词命中标题或摘要(任一命中即可)
    if (kw.length) {
      paramsArr.push(kw.map((k) => `%${k}%`));
      conditions.push(
        `(p.title ILIKE ANY($${paramIdx}) OR p.abstract ILIKE ANY($${paramIdx}))`,
      );
      paramIdx++;
    }

    // IPC 分类号前缀匹配(如 G06F 匹配 G06F 开头的所有子类)
    if (ipc.length) {
      paramsArr.push(ipc.map((c) => `${c}%`));
      conditions.push(
        `EXISTS (SELECT 1 FROM cnipa.patent_ipc pi WHERE pi.patent_id = p.id AND pi.ipc_code ILIKE ANY($${paramIdx}))`,
      );
      paramIdx++;
    }

    // 申请人模糊匹配
    if (applicant) {
      paramsArr.push(`%${applicant}%`);
      conditions.push(
        `EXISTS (SELECT 1 FROM cnipa.patent_applicant pa WHERE pa.patent_id = p.id AND pa.name ILIKE $${paramIdx})`,
      );
      paramIdx++;
    }

    // 公开日范围
    if (dateFrom) {
      paramsArr.push(dateFrom);
      conditions.push(`p.pub_date >= $${paramIdx}::date`);
      paramIdx++;
    }
    if (dateTo) {
      paramsArr.push(dateTo);
      conditions.push(`p.pub_date <= $${paramIdx}::date`);
      paramIdx++;
    }

    // 文献类型
    if (kind) {
      paramsArr.push(kind);
      conditions.push(`p.kind = $${paramIdx}`);
      paramIdx++;
    }

    // 排序
    const orderClause =
      sortBy === "pub_date_asc"
        ? "p.pub_date ASC NULLS LAST"
        : sortBy === "relevance"
          ? "p.pub_date DESC NULLS LAST"
          : "p.pub_date DESC NULLS LAST";

    paramsArr.push(limit);
    const limitIdx = paramIdx++;
    paramsArr.push(offset);
    const offsetIdx = paramIdx;

    const baseWhere = conditions.join(" AND ");

    const sql = `
      SELECT
        p.id,
        p.doc_number,
        p.kind,
        p.title,
        p.abstract,
        p.pub_date,
        (SELECT string_agg(name, '; ') FROM cnipa.patent_applicant WHERE patent_id = p.id) AS applicants,
        (SELECT string_agg(ipc_code, ', ') FROM cnipa.patent_ipc WHERE patent_id = p.id) AS ipc_codes
      FROM cnipa.patent p
      WHERE ${baseWhere}
      ORDER BY ${orderClause}
      LIMIT $${limitIdx} OFFSET $${offsetIdx}
    `;

    const countSql = `SELECT COUNT(*)::int AS n FROM cnipa.patent p WHERE ${baseWhere}`;

    const [res, countRes] = await Promise.all([
      client.query(sql, paramsArr),
      client.query(countSql, paramsArr.slice(0, -2)),
    ]);

    const items = res.rows.map((r) => ({
      id: r.id,
      docNumber: r.doc_number,
      kind: r.kind || "",
      title: r.title || "",
      abstract: r.abstract || "",
      pubDate: r.pub_date instanceof Date
        ? r.pub_date.toISOString().slice(0, 10)
        : String(r.pub_date || ""),
      applicant: r.applicants || "",
      ipcCodes: r.ipc_codes ? r.ipc_codes.split(", ") : [],
    }));

    return {
      total: countRes.rows[0]?.n || 0,
      limit,
      offset,
      items,
    };
  } finally {
    client.release();
  }
}
