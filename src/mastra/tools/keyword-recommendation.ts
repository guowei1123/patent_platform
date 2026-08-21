import { createTool } from "@mastra/core/tools";
import { z } from "zod";

import { generateKeywords } from "@/app/api/report/keyword-recommendation/service";

const keywordResultSchema = z.object({
  recommendations: z.array(z.string()),
});

export const keywordRecommendationTool = createTool({
  id: "recommend-patent-keywords",
  description:
    "围绕核心技术词推荐专利检索用的同义词、上下位词、技术关联词和应用场景词。",
  inputSchema: z.object({
    coreKeyword: z.string().min(1).describe("需要扩展的核心技术关键词"),
    desiredCount: z.number().int().min(3).max(15).default(8),
  }),
  outputSchema: keywordResultSchema,
  execute: async ({ coreKeyword, desiredCount }) => {
    const result = await generateKeywords({ coreKeyword, desiredCount });
    return keywordResultSchema.parse(result);
  },
});
