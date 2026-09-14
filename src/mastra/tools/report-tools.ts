import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import {
  parseDisclosureText,
  parsedDisclosureSchema,
} from "@/app/api/report/disclosure-parse/service";
import {
  classifyDocumentRelevance,
  documentClassificationInputSchema,
  documentClassificationResultSchema,
} from "@/app/api/report/document-relevance-classification/service";
import { generateKeywords } from "@/app/api/report/keyword-recommendation/service";
import {
  generateFormula,
  recommendIPC,
} from "@/app/api/report/search-formula-generation/service";
import { searchPatents } from "@/app/api/report/patent-search/service";
import { streamConclusion } from "@/app/api/report/conclusion-generation/service";
import {
  evaluateProposal,
  proposalEvaluationInputSchema,
} from "@/lib/service/proposal-grade-evaluation";
import { searchStrategySchema } from "../contracts";
import {
  proposalEvaluationResultSchema,
  reportPatentSearchResultSchema,
} from "../report/contracts";

function normalizeRecommendations(value: unknown) {
  const record =
    value && typeof value === "object"
      ? (value as Record<string, unknown>)
      : {};
  const items = Array.isArray(record.recommendations)
    ? record.recommendations
    : [];
  return [
    ...new Set(
      items
        .map(String)
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  ];
}

export const parseReportDisclosureTool = createTool({
  id: "parse-report-disclosure",
  description: "从交底书纯文本中提取报告所需的客观技术事实。",
  inputSchema: z.object({
    disclosureText: z.string().trim().min(80).max(120_000),
  }),
  outputSchema: parsedDisclosureSchema,
  execute: async ({ disclosureText }) => parseDisclosureText(disclosureText),
});

export const recommendReportKeywordsTool = createTool({
  id: "recommend-report-keywords",
  description: "为专利检索报告扩展专业检索关键词。",
  inputSchema: z.object({
    coreKeyword: z.string().trim().min(1).max(300),
    desiredCount: z.coerce.number().int().min(3).max(15).default(8),
  }),
  outputSchema: z.object({ recommendations: z.array(z.string()).max(15) }),
  execute: async (input) => ({
    recommendations: normalizeRecommendations(
      await generateKeywords(input),
    ).slice(0, input.desiredCount),
  }),
});

export const recommendReportIpcTool = createTool({
  id: "recommend-report-ipc",
  description: "根据交底书技术主题推荐 IPC/CPC 分类号。",
  inputSchema: z.object({ topic: z.string().trim().min(1).max(500) }),
  outputSchema: z.object({
    items: z
      .array(z.object({ code: z.string(), description: z.string() }))
      .max(8),
  }),
  execute: async ({ topic }) => ({
    items: (await recommendIPC(topic)).slice(0, 8),
  }),
});

export const generateReportFormulaTool = createTool({
  id: "generate-report-formula",
  description: "为报告生成 Incopat 格式检索式。",
  inputSchema: z.object({
    keywords: z.array(z.string()).min(1).max(15),
    ipcCodes: z.array(z.string()).max(10),
  }),
  outputSchema: z.object({ formula: z.string() }),
  execute: async ({ keywords, ipcCodes }) =>
    generateFormula({
      keywords,
      ipcCodes,
      outputFormat: ipcCodes.length ? "format1" : "format2",
    }),
});

export const searchReportPatentsTool = createTool({
  id: "search-report-patents",
  description: "根据已确认的报告检索策略查询本地中国专利数据库。",
  requireApproval: true,
  inputSchema: searchStrategySchema,
  outputSchema: reportPatentSearchResultSchema,
  execute: async (strategy) =>
    searchPatents(searchStrategySchema.parse(strategy)),
});

export const classifyReportDocumentTool = createTool({
  id: "classify-report-document",
  description: "将单篇对比文献初步标记为 X、Y 或 A，并输出逐项特征映射。",
  inputSchema: documentClassificationInputSchema,
  outputSchema: documentClassificationResultSchema,
  execute: async (input) => classifyDocumentRelevance(input),
});

export const evaluateReportProposalTool = createTool({
  id: "evaluate-report-proposal",
  description: "使用确定性业务规则计算用途前景、授权前景和提案等级。",
  inputSchema: proposalEvaluationInputSchema,
  outputSchema: proposalEvaluationResultSchema,
  execute: async (input) => evaluateProposal(input),
});

const conclusionInputSchema = z.object({
  searchTopic: z.string().trim().min(1).max(1000),
  searchResults: z.string().trim().min(1).max(30_000),
  keyPatentAnalysis: z.string().trim().min(1).max(30_000),
  patentMap: z.string().max(10_000).default("暂无专利地图数据"),
  innovationAssessment: z.string().max(10_000),
});

export const generateReportConclusionTool = createTool({
  id: "generate-report-conclusion",
  description: "根据已确认的检索、分类和评级事实生成报告结论草稿。",
  inputSchema: conclusionInputSchema,
  outputSchema: z.object({ conclusion: z.string() }),
  execute: async (input) => {
    const stream = await streamConclusion(input);
    let conclusion = "";
    for await (const chunk of stream) conclusion += chunk;
    return { conclusion };
  },
});

export const reportTools = {
  parseReportDisclosureTool,
  recommendReportKeywordsTool,
  recommendReportIpcTool,
  generateReportFormulaTool,
  searchReportPatentsTool,
  classifyReportDocumentTool,
  evaluateReportProposalTool,
  generateReportConclusionTool,
};
