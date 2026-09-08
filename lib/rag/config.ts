export interface RagConfig {
  baseUrl: string;
  apiKey: string;
  knowledgeBaseIds: string[];
  topK: number;
  recallCount: number;
  maxContextChars: number;
  timeoutMs: number;
  rewrite: boolean;
  rerank?: { url: string; apiKey: string; model: string };
}

function httpUrl(value: string, name: string) {
  const url = new URL(value);
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new Error(`${name} 必须为无凭据、无查询参数的 HTTP(S) 地址`);
  return value.replace(/\/+$/, "");
}

function integer(
  value: string | undefined,
  fallback: number,
  min: number,
  max: number,
) {
  const parsed = Number(value ?? fallback);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max)
    throw new Error(`RAG 数值配置必须是 ${min}–${max} 范围内的整数`);
  return parsed;
}

export function getRagConfig(
  env: NodeJS.ProcessEnv = process.env,
): RagConfig | null {
  if (env.QA_RAG_ENABLED !== "true") return null;
  const knowledgeBaseIds = [
    ...new Set(
      (env.WEKNORA_KNOWLEDGE_BASE_IDS || "")
        .split(",")
        .map((id) => id.trim())
        .filter(Boolean),
    ),
  ];
  if (
    !env.WEKNORA_BASE_URL ||
    !env.WEKNORA_API_KEY ||
    !knowledgeBaseIds.length ||
    knowledgeBaseIds.length > 10
  )
    throw new Error(
      "请配置 WeKnora 服务地址、API Key 和 1–10 个通用问答知识库 ID",
    );
  const rerankValues = [
    env.QA_RERANK_URL,
    env.QA_RERANK_API_KEY,
    env.QA_RERANK_MODEL,
  ];
  if (rerankValues.some(Boolean) && !rerankValues.every(Boolean))
    throw new Error("重排服务必须同时配置 URL、API Key 和模型");
  const topK = integer(env.QA_RAG_TOP_K, 6, 1, 20);
  return {
    baseUrl: httpUrl(env.WEKNORA_BASE_URL, "WEKNORA_BASE_URL"),
    apiKey: env.WEKNORA_API_KEY,
    knowledgeBaseIds,
    topK,
    recallCount: Math.max(topK, integer(env.QA_RAG_RECALL_COUNT, 30, 1, 100)),
    maxContextChars: integer(env.QA_RAG_MAX_CONTEXT_CHARS, 16000, 1000, 60000),
    timeoutMs: integer(env.QA_RAG_TIMEOUT_MS, 20000, 1000, 60000),
    rewrite: env.QA_RAG_REWRITE !== "false",
    rerank: env.QA_RERANK_URL
      ? {
          url: httpUrl(env.QA_RERANK_URL, "QA_RERANK_URL"),
          apiKey: env.QA_RERANK_API_KEY!,
          model: env.QA_RERANK_MODEL!,
        }
      : undefined,
  };
}
