import { createStep, createWorkflow } from "@mastra/core/workflows";
import { z } from "zod";
import { searchFormulaAgent } from "../agents/search-formula-agent";
import {
  searchFormulaStrategySchema,
  searchFormulaWorkflowInputSchema,
  searchFormulaWorkflowOutputSchema,
} from "../search-formula/contracts";

function unique(items: string[]) {
  return [...new Set(items.map((item) => item.trim()).filter(Boolean))];
}

function targetKeywordLanguage(disclosure: {
  inventionName: string;
  technicalField: string;
  technicalSolution: string;
  keyTechnicalFeatures: string[];
}) {
  const text = [
    disclosure.inventionName,
    disclosure.technicalField,
    disclosure.technicalSolution,
    ...disclosure.keyTechnicalFeatures,
  ].join(" ");
  const chineseCharacters = (text.match(/[\u3400-\u9fff]/g) || []).length;
  const latinCharacters = (text.match(/[A-Za-z]/g) || []).length;
  return chineseCharacters >= latinCharacters ? "中文" : "英文";
}

function buildSemanticFormula(
  groups: Array<{ keywords: string[]; operator: "AND" | "OR" }>,
  ipcCodes: string[],
) {
  const term = (value: string) => {
    const text = value.trim().replace(/["()]/g, "");
    return /\s/.test(text) ? `"${text}"` : text;
  };
  const keywordPart = groups
    .map(
      (group) =>
        `(${group.keywords.map((word) => `TIAB=${term(word)}`).join(` ${group.operator} `)})`,
    )
    .join(" AND ");
  if (!ipcCodes.length) return `(${keywordPart})`;
  const ipcPart = ipcCodes
    .map((code) => `IPC=${term(code.replace(/\s/g, ""))}`)
    .join(" OR ");
  return `(${ipcPart}) AND (${keywordPart})`;
}

function normalizeStrategy(
  strategy: z.infer<typeof searchFormulaStrategySchema>,
  inputData: z.infer<typeof searchFormulaWorkflowInputSchema>,
) {
  const keywords = unique(
    inputData.keywords?.length ? inputData.keywords : strategy.keywords,
  ).slice(0, 15);
  const known = new Set(keywords.map((keyword) => keyword.toLocaleLowerCase()));
  const seen = new Set<string>();
  const keywordGroups = strategy.keywordGroups
    .map((group) => ({
      operator: group.operator,
      keywords: group.keywords.filter((keyword) => {
        const normalized = keyword.trim().toLocaleLowerCase();
        if (!known.has(normalized) || seen.has(normalized)) return false;
        seen.add(normalized);
        return true;
      }),
    }))
    .filter((group) => group.keywords.length);
  for (const keyword of keywords) {
    if (!seen.has(keyword.toLocaleLowerCase()))
      keywordGroups.push({ keywords: [keyword], operator: "AND" });
  }
  return searchFormulaStrategySchema.parse({
    ...strategy,
    keywords,
    ipcCodes: unique(
      inputData.ipcCodes?.length ? inputData.ipcCodes : strategy.ipcCodes,
    ).slice(0, 10),
    keywordGroups,
  });
}

const formStrategy = createStep({
  id: "form-search-formula-strategy",
  inputSchema: searchFormulaWorkflowInputSchema,
  outputSchema: searchFormulaWorkflowInputSchema.extend({
    strategy: searchFormulaStrategySchema,
  }),
  execute: async ({ inputData }) => {
    const disclosure = inputData.disclosure;
    const response = await searchFormulaAgent.generate<
      z.infer<typeof searchFormulaStrategySchema>
    >(
      JSON.stringify({
        task: "根据专利交底书形成检索策略",
        template: inputData.template,
        disclosure,
        targetKeywordLanguage: targetKeywordLanguage(disclosure),
        selectedKeywords: inputData.keywords || [],
        selectedIpcCodes: inputData.ipcCodes || [],
      }),
      {
        structuredOutput: { schema: searchFormulaStrategySchema },
        maxSteps: 3,
        abortSignal: AbortSignal.timeout(90_000),
      },
    );
    const strategy = normalizeStrategy(
      searchFormulaStrategySchema.parse(response.object),
      inputData,
    );
    return {
      ...inputData,
      strategy,
    };
  },
});

const generateFormulaStep = createStep({
  id: "generate-search-formula",
  inputSchema: searchFormulaWorkflowInputSchema.extend({
    strategy: searchFormulaStrategySchema,
  }),
  outputSchema: searchFormulaWorkflowOutputSchema,
  execute: async ({ inputData }) => {
    return {
      ...inputData,
      generatedFormula: buildSemanticFormula(
        inputData.strategy.keywordGroups,
        inputData.template === "ipc-keywords"
          ? inputData.strategy.ipcCodes
          : [],
      ),
    };
  },
});

export const searchFormulaWorkflow = createWorkflow({
  id: "patent-search-formula-workflow",
  inputSchema: searchFormulaWorkflowInputSchema,
  outputSchema: searchFormulaWorkflowOutputSchema,
})
  .then(formStrategy)
  .then(generateFormulaStep)
  .commit();
