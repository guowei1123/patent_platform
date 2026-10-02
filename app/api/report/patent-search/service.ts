import { Pool, PoolConfig } from "pg";
import { compilePatentFormula } from "./formula";

export interface PatentSearchResult {
  id: string;
  docNumber: string;
  kind: string;
  title: string;
  abstract: string;
  appDate: string;
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

export interface PatentComparisonMaterial {
  id: string;
  claims: string;
  description: string;
  drawings: string;
  availableSections: Array<"claims" | "description" | "drawings">;
}

export type PatentSortBy = "pub_date_desc" | "pub_date_asc" | "relevance";

export interface PatentSearchParams {
  formula?: string;
  id?: string;
  /** 关键词列表(命中标题或摘要任一即可) */
  keywords?: string[];
  /** 多关键词命中方式；检索计划中的技术关系路由使用 all。 */
  keywordMatch?: "any" | "all";
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
  host: process.env.CNIPA_PG_HOST,
  port: parseInt(process.env.CNIPA_PG_PORT || "5432", 10),
  user: process.env.CNIPA_PG_USER,
  password: process.env.CNIPA_PG_PASSWORD,
  database: process.env.CNIPA_PG_DB,
};

let pool: Pool | null = null;

function getPool(): Pool {
  if (!pool) pool = new Pool(poolConfig);
  return pool;
}

const contentColumnCandidates = {
  claims: ["claims", "claim_text", "claims_text", "claim_content", "claim"],
  description: [
    "description",
    "description_text",
    "specification",
    "specification_text",
    "full_text",
    "content",
  ],
  drawings: [
    "drawings",
    "drawings_text",
    "drawing_description",
    "figures",
    "figure_description",
  ],
} as const;

type ComparisonSection = keyof typeof contentColumnCandidates;

function quoteIdentifier(identifier: string) {
  return `"${identifier.replace(/"/g, '""')}"`;
}

/** 仅接受数据库实际存在的白名单字段，避免将配置值拼入 SQL。 */
export function resolvePatentTextColumns(
  availableColumns: string[],
  configuredColumns: Partial<Record<ComparisonSection, string>> = {},
) {
  const available = new Set(availableColumns);
  return Object.fromEntries(
    (Object.keys(contentColumnCandidates) as ComparisonSection[]).flatMap(
      (section) => {
        const configured = configuredColumns[section];
        const column =
          configured && available.has(configured)
            ? configured
            : contentColumnCandidates[section].find((item) =>
                available.has(item),
              );
        return column ? [[section, column]] : [];
      },
    ),
  ) as Partial<Record<ComparisonSection, string>>;
}

/**
 * 读取检索报告深度比对所需的权利要求、说明书和附图说明。
 * 当前支持正文存储在 cnipa.patent 的 ETL；字段名会自动识别，也可通过
 * CNIPA_PATENT_CLAIMS_COLUMN、CNIPA_PATENT_DESCRIPTION_COLUMN、
 * CNIPA_PATENT_DRAWINGS_COLUMN 显式指定。
 */
export async function getPatentComparisonMaterials(
  patentIds: string[],
): Promise<Map<string, PatentComparisonMaterial>> {
  const ids = [...new Set(patentIds.filter(Boolean))];
  const result = new Map<string, PatentComparisonMaterial>();
  if (!ids.length) return result;
  const client = await getPool().connect();
  try {
    const columnsResult = await client.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema = 'cnipa' AND table_name = 'patent'`,
    );
    const columns = resolvePatentTextColumns(
      columnsResult.rows.map((row) => row.column_name),
      {
        claims: process.env.CNIPA_PATENT_CLAIMS_COLUMN,
        description: process.env.CNIPA_PATENT_DESCRIPTION_COLUMN,
        drawings: process.env.CNIPA_PATENT_DRAWINGS_COLUMN,
      },
    );
    const selected = (Object.keys(columns) as ComparisonSection[]).map(
      (section) =>
        `COALESCE(p.${quoteIdentifier(columns[section]!)}::text, '') AS ${quoteIdentifier(section)}`,
    );
    if (!selected.length) {
      for (const id of ids) {
        result.set(id, {
          id,
          claims: "",
          description: "",
          drawings: "",
          availableSections: [],
        });
      }
      return result;
    }
    const rows = await client.query<Record<string, unknown>>(
      `SELECT p.id, ${selected.join(", ")} FROM cnipa.patent p WHERE p.id::text = ANY($1::text[])`,
      [ids],
    );
    for (const row of rows.rows) {
      const availableSections = (
        Object.keys(columns) as ComparisonSection[]
      ).filter((section) => String(row[section] || "").trim());
      result.set(String(row.id), {
        id: String(row.id),
        claims: String(row.claims || "").trim(),
        description: String(row.description || "").trim(),
        drawings: String(row.drawings || "").trim(),
        availableSections,
      });
    }
    for (const id of ids) {
      if (!result.has(id)) {
        result.set(id, {
          id,
          claims: "",
          description: "",
          drawings: "",
          availableSections: [],
        });
      }
    }
    return result;
  } finally {
    client.release();
  }
}

function normalize(input?: string | string[]): string[] {
  if (!input) return [];
  const arr = Array.isArray(input) ? input : [input];
  return arr
    .flatMap((s) => String(s).split(/[，、,\n\r]/))
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * CNIPA ETL 中的 IPC 可能包含不定数量空格和版本号，
 * 例如 `G06N    3/08    (2023.01)`。查询条件统一使用无空格、无版本号的前缀。
 */
export function normalizeIpcCodes(input?: string | string[]): string[] {
  return [
    ...new Set(
      normalize(input)
        .map((code) => code.replace(/\s+/g, ""))
        .map((code) => code.replace(/\(\d{4}\.\d{2}\)$/i, ""))
        .filter(Boolean),
    ),
  ];
}

export async function searchPatents(
  params: PatentSearchParams,
): Promise<PatentSearchResponse> {
  const {
    formula,
    id,
    keywords = [],
    keywordMatch = "any",
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
  const ipc = normalizeIpcCodes(ipcCodes);

  // 至少要有一个过滤条件,避免全表扫描
  if (
    !formula &&
    !id &&
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
    if (formula) {
      conditions.push(compilePatentFormula(formula, paramsArr));
      paramIdx = paramsArr.length + 1;
    }
    if (id) {
      paramsArr.push(id);
      conditions.push(`p.id = $${paramIdx}`);
      paramIdx++;
    }

    // 关键词命中标题或摘要；技术关系检索可要求全部关键词共同出现。
    if (kw.length) {
      if (keywordMatch === "all") {
        for (const keyword of kw) {
          paramsArr.push(`%${keyword}%`);
          conditions.push(
            `(p.title ILIKE $${paramIdx} OR p.abstract ILIKE $${paramIdx})`,
          );
          paramIdx++;
        }
      } else {
        paramsArr.push(kw.map((k) => `%${k}%`));
        conditions.push(
          `(p.title ILIKE ANY($${paramIdx}) OR p.abstract ILIKE ANY($${paramIdx}))`,
        );
        paramIdx++;
      }
    }

    // IPC 分类号前缀匹配。ETL 原始值可能含不定空格和版本号，
    // 因此数据库侧也移除空格后再比较。
    if (ipc.length) {
      paramsArr.push(ipc.map((c) => `${c}%`));
      conditions.push(
        `EXISTS (SELECT 1 FROM cnipa.patent_ipc pi WHERE pi.patent_id = p.id AND regexp_replace(pi.ipc_code, '[[:space:]]+', '', 'g') ILIKE ANY($${paramIdx}))`,
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
        p.app_date,
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
      appDate: String(r.app_date || ""),
      pubDate:
        r.pub_date instanceof Date
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
