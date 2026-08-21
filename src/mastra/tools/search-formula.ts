import { createTool } from "@mastra/core/tools";
import { z } from "zod";

import { generateFormula } from "@/app/api/report/search-formula-generation/service";

export const searchFormulaTool = createTool({
  id: "generate-patent-search-formula",
  description:
    "根据确认过的关键词和 IPC 分类号生成专利数据库检索式。缺少关键词或 IPC 时应先向用户询问或调用其他工具。",
  inputSchema: z.object({
    keywords: z.array(z.string().min(1)).min(1),
    ipcCodes: z.array(z.string().min(1)).min(1),
    outputFormat: z.enum(["format1", "format2"]).default("format1"),
  }),
  outputSchema: z.object({
    formula: z.string(),
  }),
  execute: async ({ keywords, ipcCodes, outputFormat }) =>
    generateFormula({ keywords, ipcCodes, outputFormat }),
});
