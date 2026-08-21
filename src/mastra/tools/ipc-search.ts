import { createTool } from "@mastra/core/tools";
import { z } from "zod";

import { searchClassificationIPCs } from "@/lib/service/classification-ipc";

const ipcResultSchema = z.object({
  code: z.string(),
  level: z.string(),
  description: z.string(),
  descriptionEn: z.string().optional(),
  note: z.string().optional(),
  similarity: z.string().optional(),
});

export const ipcSearchTool = createTool({
  id: "search-ipc-classifications",
  description:
    "根据分类号或技术主题查询 CNIPA IPC 分类数据。用户询问 IPC、分类号或需要生成检索式但未提供分类号时使用。",
  inputSchema: z.object({
    query: z
      .string()
      .min(2)
      .describe("IPC 分类号或技术主题核心词；多个核心词使用空格分隔"),
    limit: z.number().int().min(1).max(10).default(5),
  }),
  outputSchema: z.object({
    results: z.array(ipcResultSchema),
  }),
  execute: async ({ query, limit }) => {
    const documents = await searchClassificationIPCs(query, limit);

    return {
      results: documents.map((document) => ({
        code: String(document.metadata.code || ""),
        level: String(document.metadata.level || ""),
        description: document.pageContent,
        descriptionEn: document.metadata.description_en
          ? String(document.metadata.description_en)
          : undefined,
        note: document.metadata.note
          ? String(document.metadata.note)
          : undefined,
        similarity: document.metadata.similarity
          ? String(document.metadata.similarity)
          : undefined,
      })),
    };
  },
});
