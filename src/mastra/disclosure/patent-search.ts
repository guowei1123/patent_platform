import { Agent } from "@mastra/core/agent";
import { z } from "zod";
import { searchPatents } from "@/app/api/report/patent-search/service";
import { patentAgentModel } from "../model";
import {
  patentInsightSchema,
  patentSearchSchema,
  type DisclosureState,
} from "./contracts";

const analysisSchema = patentInsightSchema.omit({
  id: true,
  searchId: true,
  patentIds: true,
  createdAt: true,
});

const patentEvidenceAgent = new Agent({
  id: "disclosure-patent-evidence-agent",
  name: "交底书检索证据助手",
  model: patentAgentModel,
  instructions: `你根据用户明确选择的检索专利，形成供人工审阅的背景和差异描述建议。
检索专利是独立外部证据，不是用户提供的技术事实。不得把其中任何技术特征写入、补全或改写用户技术方案；不得声称新颖性、创造性、侵权或授权结论。
只依据输入中给出的题名、摘要和公开号，说明可用于背景交代和待人工比对的方向。每一项引用都写明公开号或文献编号；若仅有摘要，limitations 必须说明比对范围受限。输出严格符合结构，使用中文。`,
});

export async function runDisclosurePatentSearch(input: {
  id: string;
  keywords: string[];
  limit: number;
}) {
  const keywords = [...new Set(input.keywords.map((item) => item.trim()))].filter(
    Boolean,
  );
  const result = await searchPatents({
    keywords,
    limit: input.limit,
    sortBy: "pub_date_desc",
  });
  return patentSearchSchema.parse({
    id: input.id,
    keywords,
    total: result.total,
    items: result.items,
    searchedAt: new Date().toISOString(),
  });
}

export async function analyzeDisclosurePatentEvidence(input: {
  id: string;
  state: DisclosureState;
  searchId: string;
  patentIds: string[];
}) {
  const search = input.state.patentSearches.find(
    (item) => item.id === input.searchId,
  );
  if (!search) throw new Error("检索记录不存在，请重新检索");
  const selected = search.items.filter((item) => input.patentIds.includes(item.id));
  if (!selected.length || selected.length !== new Set(input.patentIds).size)
    throw new Error("所选专利不属于当前检索结果");
  const response = await patentEvidenceAgent.generate<z.infer<typeof analysisSchema>>(
    JSON.stringify({
      userDisclosure: {
        inventionName: input.state.sections.inventionName,
        technicalField: input.state.sections.technicalField,
        techBackground: input.state.sections.techBackground,
        technicalSolution: input.state.sections.technicalSolution,
      },
      selectedPatents: selected,
      outputRequirement:
        "backgroundSuggestion 只能作为技术背景候选文字；differenceSuggestion 只能列出需要人工逐项比对的差异说明，不能形成或修改技术方案。",
    }),
    {
      structuredOutput: { schema: analysisSchema },
      maxSteps: 1,
      abortSignal: AbortSignal.timeout(150000),
    },
  );
  return patentInsightSchema.parse({
    ...response.object,
    id: input.id,
    searchId: input.searchId,
    patentIds: [...new Set(input.patentIds)],
    createdAt: new Date().toISOString(),
  });
}
