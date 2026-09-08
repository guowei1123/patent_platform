import { createTool } from "@mastra/core/tools";
import { z } from "zod";

import { generateKeywords } from "@/app/api/report/keyword-recommendation/service";
import {
  generateFormula,
  recommendIPC,
} from "@/app/api/report/search-formula-generation/service";
import { searchPatents } from "@/app/api/report/patent-search/service";
import { searchStrategySchema } from "../contracts";

const nextActionMessage =
  "本工具只提供辅助信息，尚未查询专利数据库。如果用户要求真实检索，请继续调用 searchPatentsTool。";

const keywordOutputSchema = z.object({
  recommendations: z.array(z.string()),
  nextAction: z.string(),
});

function normalizeRecommendations(value: unknown) {
  const record =
    value && typeof value === "object"
      ? (value as Record<string, unknown>)
      : {};
  const items = Array.isArray(record.recommendations)
    ? record.recommendations
    : [];
  return [
    ...new Set(items.map((item) => String(item).trim()).filter(Boolean)),
  ].slice(0, 15);
}

export const recommendKeywordsTool = createTool({
  id: "recommend-keywords",
  description:
    "仅当用户明确要求扩展关键词或补充同义词时使用。根据技术主题生成检索扩展词；不会查询专利数据库。",
  inputSchema: z.object({
    topic: z.string().trim().min(1).max(300),
    desiredCount: z.coerce.number().int().min(3).max(12).default(8),
  }),
  outputSchema: keywordOutputSchema,
  execute: async ({ topic, desiredCount }) => ({
    recommendations: normalizeRecommendations(
      await generateKeywords({ coreKeyword: topic, desiredCount }),
    ),
    nextAction: nextActionMessage,
  }),
});

export const recommendIpcTool = createTool({
  id: "recommend-ipc",
  description:
    "仅当用户明确要求推荐或分析 IPC 分类号时使用；不会查询专利数据库。",
  inputSchema: z.object({ topic: z.string().trim().min(1).max(500) }),
  outputSchema: z.object({
    items: z
      .array(z.object({ code: z.string(), description: z.string() }))
      .max(8),
    nextAction: z.string(),
  }),
  execute: async ({ topic }) => ({
    items: (await recommendIPC(topic)).slice(0, 8),
    nextAction: nextActionMessage,
  }),
});

export const generateSearchFormulaTool = createTool({
  id: "generate-search-formula",
  description:
    "仅当用户明确要求生成检索式时使用。基于关键词和 IPC 分类号生成 Incopat 格式检索式；不会查询专利数据库。",
  inputSchema: z.object({
    keywords: z.array(z.string()).min(1).max(15),
    ipcCodes: z.array(z.string()).max(10),
  }),
  outputSchema: z.object({ formula: z.string(), nextAction: z.string() }),
  execute: async ({ keywords, ipcCodes }) => ({
    ...(await generateFormula({
      keywords,
      ipcCodes,
      outputFormat: ipcCodes.length ? "format1" : "format2",
    })),
    nextAction: nextActionMessage,
  }),
});

export const searchPatentsTool = createTool({
  id: "search-patents-after-approval",
  description:
    "用户要求检索、查找或查询专利时使用。执行前需要用户确认检索策略，确认后查询本地 PostgreSQL 数据库并返回真实专利数据。",
  requireApproval: true,
  inputSchema: searchStrategySchema,
  outputSchema: z.object({
    strategy: searchStrategySchema,
    relaxed: z.boolean().optional(),
    relaxationNote: z.string().optional(),
    total: z.number().optional(),
    limit: z.number().optional(),
    offset: z.number().optional(),
    items: z.array(z.unknown()).optional(),
  }),
  execute: async (strategy) => {
    const effectiveStrategy = searchStrategySchema.parse(strategy);
    const result = await searchPatents(effectiveStrategy);
    if (result.total === 0 && effectiveStrategy.ipcCodes.length > 0) {
      const relaxedResult = await searchPatents({
        ...effectiveStrategy,
        ipcCodes: [],
      });
      return {
        strategy: effectiveStrategy,
        relaxed: true,
        relaxationNote: "原关键词与 IPC 组合无结果，已自动移除 IPC 条件重试。",
        ...relaxedResult,
      };
    }
    return { strategy: effectiveStrategy, relaxed: false, ...result };
  },
});
