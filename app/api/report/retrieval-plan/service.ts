import { z } from "zod";
import type { ParsedDisclosure } from "@/app/api/report/disclosure-parse/service";
import type { SearchStrategy } from "@/src/mastra/contracts";

export const retrievalFeatureSchema = z.object({
  id: z.string().min(1),
  text: z.string().min(1).max(500),
  importance: z.enum(["CORE", "KEY", "BASIC"]),
  isInnovation: z.boolean(),
  synonyms: z.array(z.string().min(1).max(100)).max(10),
});

export const retrievalRouteSchema = z.object({
  id: z.string().min(1),
  purpose: z.enum([
    "TOPIC",
    "CORE_FEATURE",
    "TECHNICAL_RELATION",
    "EXPANDED_TERM",
    "SEMANTIC",
  ]),
  label: z.string().min(1).max(200),
  keywords: z.array(z.string().min(1).max(100)).min(1).max(10),
  keywordMatch: z.enum(["any", "all"]),
  ipcCodes: z.array(z.string().min(1).max(30)).max(10),
  semanticQuery: z.string().max(2_000).optional(),
});

export const retrievalPlanSchema = z.object({
  features: z.array(retrievalFeatureSchema).min(1).max(12),
  routes: z.array(retrievalRouteSchema).min(1).max(8),
});

export const candidateScreeningSchema = z.object({
  id: z.string().min(1),
  proceed: z.boolean(),
  reason: z.string().min(1).max(500),
  matchedFeatureIds: z.array(z.string().min(1)).max(12).default([]),
});

export const retrievalRoundSchema = z.object({
  routeId: z.string().min(1),
  label: z.string().min(1),
  status: z.enum(["completed", "pending_vector_index"]),
  total: z.number().int().nonnegative(),
  returned: z.number().int().nonnegative(),
});

export type RetrievalPlan = z.infer<typeof retrievalPlanSchema>;

/**
 * 向量库接入后的适配器契约。检索工作流只依赖此接口，不绑定具体向量数据库。
 */
export interface SemanticPatentRetriever<TPatent> {
  search(input: {
    query: string;
    ipcCodes: string[];
    limit: number;
  }): Promise<TPatent[]>;
}

function unique(items: string[]) {
  return [...new Set(items.map((item) => item.trim()).filter(Boolean))];
}

/**
 * 当前专利库只有题名、摘要和 IPC 的检索能力。语义路由会被保留，待向量索引接入后
 * 通过 SemanticPatentRetriever 执行。 同族、引用、日期资格和非专利文献不在本项目第一期范围内。
 */
export function buildRetrievalPlan(
  disclosure: ParsedDisclosure,
  strategy: SearchStrategy,
): RetrievalPlan {
  const baseKeywords = unique([
    ...strategy.keywords,
    disclosure.inventionName,
    disclosure.technicalField,
  ]).slice(0, 10);
  const rawFeatures = unique([
    ...disclosure.keyTechnicalFeatures,
    disclosure.technicalSolution,
    disclosure.inventionName,
    disclosure.technicalField,
  ]).slice(0, 6);
  const features = rawFeatures.map((text, index) => ({
    id: `F${index + 1}`,
    text,
    importance: index < disclosure.keyTechnicalFeatures.length ? "CORE" : "KEY",
    isInnovation: index < disclosure.keyTechnicalFeatures.length,
    synonyms: unique(
      strategy.keywords.filter(
        (keyword) => keyword !== text && text.includes(keyword),
      ),
    ).slice(0, 5),
  }));

  const routes = [
    {
      id: "topic",
      purpose: "TOPIC" as const,
      label: "技术主题与分类号召回",
      keywords: baseKeywords.slice(0, 5),
      keywordMatch: "any" as const,
      ipcCodes: strategy.ipcCodes,
    },
    ...features.slice(0, 4).map((feature) => ({
      id: `core-${feature.id}`,
      purpose: "CORE_FEATURE" as const,
      label: `核心特征：${feature.text.slice(0, 60)}`,
      keywords: [feature.text, ...feature.synonyms].slice(0, 4),
      keywordMatch: "any" as const,
      ipcCodes: strategy.ipcCodes,
    })),
    ...(features.length >= 2
      ? [
          {
            id: "relation",
            purpose: "TECHNICAL_RELATION" as const,
            label: "关键技术关系联合检索",
            keywords: features.slice(0, 2).map((feature) => feature.text),
            keywordMatch: "all" as const,
            ipcCodes: strategy.ipcCodes,
          },
        ]
      : []),
    ...(baseKeywords.length > 2
      ? [
          {
            id: "expanded",
            purpose: "EXPANDED_TERM" as const,
            label: "扩展术语补充召回",
            keywords: baseKeywords.slice(2, 7),
            keywordMatch: "any" as const,
            ipcCodes: [],
          },
        ]
      : []),
    {
      id: "semantic",
      purpose: "SEMANTIC" as const,
      label: "语义相似方案补充召回（待向量库接入）",
      keywords: [disclosure.inventionName || features[0]?.text || "技术方案"],
      keywordMatch: "any" as const,
      ipcCodes: strategy.ipcCodes,
      semanticQuery: [
        disclosure.inventionName,
        disclosure.technicalSolution,
        ...disclosure.keyTechnicalFeatures.slice(0, 4),
      ]
        .filter(Boolean)
        .join("；")
        .slice(0, 2_000),
    },
  ].filter((route) => route.keywords.length);

  return retrievalPlanSchema.parse({ features, routes: routes.slice(0, 8) });
}
