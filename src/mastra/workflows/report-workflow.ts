import { createStep, createWorkflow } from "@mastra/core/workflows";
import { z } from "zod";
import {
  classifyDocumentsRelevance,
  screenCandidateDocuments,
} from "@/app/api/report/document-relevance-classification/service";
import { generateKeywords } from "@/app/api/report/keyword-recommendation/service";
import {
  getPatentComparisonMaterials,
  searchPatents,
} from "@/app/api/report/patent-search/service";
import { buildRetrievalPlan } from "@/app/api/report/retrieval-plan/service";
import {
  generateFormula,
  recommendIPC,
} from "@/app/api/report/search-formula-generation/service";
import { streamConclusion } from "@/app/api/report/conclusion-generation/service";
import {
  evaluateProposal,
  proposalEvaluationInputSchema,
} from "@/lib/service/proposal-grade-evaluation";
import { searchStrategySchema } from "../contracts";
import {
  classifiedReportPatentSchema,
  reportApprovalSchema,
  reportSuspendPayloadSchema,
  reportWorkflowContextSchema,
  type ReportWorkflowContext,
} from "../report/contracts";

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
}

function normalizeRecommendations(value: unknown) {
  const items = asRecord(value).recommendations;
  return Array.isArray(items)
    ? [
        ...new Set(
          items
            .map(String)
            .map((item) => item.trim())
            .filter(Boolean),
        ),
      ]
    : [];
}

function buildFallbackFormula(keywords: string[], ipcCodes: string[]) {
  const keywordExpression = keywords
    .map((keyword) => `"${keyword.replace(/"/g, "").trim()}"`)
    .filter((keyword) => keyword !== '""')
    .join(" OR ");
  const keywordPart = `TIAB=(${keywordExpression})`;
  const normalizedIpcCodes = ipcCodes
    .map((code) => code.replace(/\s+/g, "").trim())
    .filter(Boolean);
  if (!normalizedIpcCodes.length) return keywordPart;
  const ipcExpression = normalizedIpcCodes.join(" OR ");
  return `${keywordPart} AND (IPC=(${ipcExpression}) OR CPC=(${ipcExpression}))`;
}

async function withTimeout<T>(promise: Promise<T>, milliseconds: number) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`模型调用超过 ${milliseconds / 1000} 秒`)),
          milliseconds,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function createSearchFormula(keywords: string[], ipcCodes: string[]) {
  try {
    const { formula } = await withTimeout(
      generateFormula({
        keywords,
        ipcCodes,
        outputFormat: ipcCodes.length ? "format1" : "format2",
      }),
      20_000,
    );
    if (formula.trim()) return formula.trim();
  } catch (error) {
    console.warn(
      "Report formula generation failed; using deterministic fallback:",
      error instanceof Error ? error.message : "unknown error",
    );
  }
  return buildFallbackFormula(keywords, ipcCodes);
}

function cancelled(
  inputData: ReportWorkflowContext,
  bail: (value: ReportWorkflowContext) => unknown,
) {
  return bail({ ...inputData, status: "cancelled" }) as never;
}

function passedReturnTarget(
  inputData: ReportWorkflowContext,
  stage: NonNullable<ReportWorkflowContext["returnTo"]>,
) {
  const stages = [
    "strategy",
    "document-selection",
    "classification-review",
    "evaluation-input",
  ];
  return Boolean(
    inputData.returnTo &&
    stages.indexOf(inputData.returnTo) > stages.indexOf(stage),
  );
}

const prepareStrategyStep = createStep({
  id: "prepare-report-strategy",
  inputSchema: reportWorkflowContextSchema,
  outputSchema: reportWorkflowContextSchema,
  execute: async ({ inputData }) => {
    if (
      inputData.strategy &&
      inputData.generatedFormula &&
      inputData.retrievalPlan
    )
      return inputData;
    const topic =
      inputData.disclosure.inventionName ||
      inputData.disclosure.technicalSolution.slice(0, 300) ||
      inputData.disclosure.technicalField;
    let recommendedKeywords: string[] = [];
    if (inputData.disclosure.searchKeywords.length < 5) {
      try {
        recommendedKeywords = normalizeRecommendations(
          await generateKeywords({ coreKeyword: topic, desiredCount: 8 }),
        );
      } catch (error) {
        console.warn(
          "Report keyword recommendation failed; using disclosure keywords:",
          error instanceof Error ? error.message : "unknown error",
        );
      }
    }
    const keywords = [
      ...new Set([
        ...inputData.disclosure.searchKeywords,
        ...recommendedKeywords,
        ...inputData.disclosure.keyTechnicalFeatures,
        topic,
      ]),
    ].slice(0, 15);
    let ipcCodes = [
      ...new Set(inputData.disclosure.ipcSuggestions.map((item) => item.code)),
    ].slice(0, 10);
    if (!ipcCodes.length) {
      try {
        const recommendedIpc = await withTimeout(
          recommendIPC(
            [topic, inputData.disclosure.technicalField]
              .filter(Boolean)
              .join("；"),
          ),
          20_000,
        );
        ipcCodes = [...new Set(recommendedIpc.map((item) => item.code))].slice(
          0,
          10,
        );
      } catch (error) {
        console.warn(
          "Report IPC recommendation failed; continuing without IPC:",
          error instanceof Error ? error.message : "unknown error",
        );
      }
    }
    const strategy = searchStrategySchema.parse({
      topic,
      keywords,
      ipcCodes,
      sortBy: "relevance",
      limit: 20,
      explanation: "基于交底书客观技术事实、扩展关键词和 IPC 建议形成。",
    });
    const formula = await createSearchFormula(
      strategy.keywords,
      strategy.ipcCodes,
    );
    return {
      ...inputData,
      strategy,
      generatedFormula: formula,
      retrievalPlan: buildRetrievalPlan(inputData.disclosure, strategy),
    };
  },
});

const confirmStrategyStep = createStep({
  id: "confirm-report-strategy",
  inputSchema: reportWorkflowContextSchema,
  outputSchema: reportWorkflowContextSchema,
  resumeSchema: reportApprovalSchema,
  suspendSchema: reportSuspendPayloadSchema,
  execute: async ({ inputData, resumeData, suspend, bail }) => {
    if (passedReturnTarget(inputData, "strategy")) return inputData;
    if (!resumeData) {
      return suspend({
        reportId: inputData.reportId,
        kind: "strategy",
        title: "请确认检索策略",
        data: {
          strategy: inputData.strategy,
          generatedFormula: inputData.generatedFormula,
          retrievalPlan: inputData.retrievalPlan,
          disclosure: inputData.disclosure,
          targetClaimsText: inputData.targetClaimsText || "",
        },
      });
    }
    if (resumeData.decision === "cancel") return cancelled(inputData, bail);
    const data = asRecord(resumeData.data);
    const strategy = searchStrategySchema.parse(
      data.strategy || inputData.strategy,
    );
    const formula = await createSearchFormula(
      strategy.keywords,
      strategy.ipcCodes,
    );
    const targetClaimsText = z
      .string()
      .trim()
      .max(80_000)
      .parse(data.targetClaimsText || "");
    return {
      ...inputData,
      returnTo: undefined,
      strategy,
      generatedFormula: formula,
      retrievalPlan: buildRetrievalPlan(inputData.disclosure, strategy),
      ...(targetClaimsText ? { targetClaimsText } : {}),
    };
  },
});

const searchPatentsStep = createStep({
  id: "search-report-patents",
  inputSchema: reportWorkflowContextSchema,
  outputSchema: reportWorkflowContextSchema,
  execute: async ({ inputData }) => {
    if (inputData.searchResult && inputData.retrievalRounds) return inputData;
    const strategy = searchStrategySchema.parse(inputData.strategy);
    const plan =
      inputData.retrievalPlan ||
      buildRetrievalPlan(inputData.disclosure, strategy);
    const executableRoutes = plan.routes.filter(
      (route) => route.purpose !== "SEMANTIC",
    );
    const responses = await Promise.all(
      executableRoutes.map(async (route) => ({
        route,
        result: await searchPatents({
          ...strategy,
          keywords: route.keywords,
          keywordMatch: route.keywordMatch,
          ipcCodes: route.ipcCodes,
          limit: Math.min(strategy.limit, 15),
          offset: 0,
        }),
      })),
    );
    const merged = new Map<
      string,
      (typeof responses)[number]["result"]["items"][number] & {
        retrievalRouteIds: string[];
      }
    >();
    for (const { route, result } of responses) {
      for (const item of result.items) {
        const existing = merged.get(item.id);
        if (existing) existing.retrievalRouteIds.push(route.id);
        else merged.set(item.id, { ...item, retrievalRouteIds: [route.id] });
      }
    }
    const items = [...merged.values()]
      .map((item) => ({
        ...item,
        retrievalRouteIds: [...new Set(item.retrievalRouteIds)],
      }))
      .sort(
        (left, right) =>
          right.retrievalRouteIds.length - left.retrievalRouteIds.length ||
          right.pubDate.localeCompare(left.pubDate),
      )
      .slice(0, 50);
    const retrievalRounds = [
      ...responses.map(({ route, result }) => ({
        routeId: route.id,
        label: route.label,
        status: "completed" as const,
        total: result.total,
        returned: result.items.length,
      })),
      ...plan.routes
        .filter((route) => route.purpose === "SEMANTIC")
        .map((route) => ({
          routeId: route.id,
          label: route.label,
          status: "pending_vector_index" as const,
          total: 0,
          returned: 0,
        })),
    ];
    return {
      ...inputData,
      retrievalPlan: plan,
      retrievalRounds,
      searchResult: { total: items.length, limit: 50, offset: 0, items },
    };
  },
});

const screenCandidatesStep = createStep({
  id: "screen-report-candidates",
  inputSchema: reportWorkflowContextSchema,
  outputSchema: reportWorkflowContextSchema,
  execute: async ({ inputData }) => {
    if (inputData.candidateScreening) return inputData;
    const items = inputData.searchResult?.items || [];
    if (!items.length) return { ...inputData, candidateScreening: [] };
    const targetText = [
      inputData.disclosure.technicalSolution,
      ...inputData.disclosure.keyTechnicalFeatures,
    ]
      .filter(Boolean)
      .join("\n");
    const candidateScreening = await screenCandidateDocuments(
      targetText,
      items.map((item) => ({
        id: item.id,
        abstract: item.abstract,
        claims: "",
        description: "",
        drawings: "",
        availableSections: [],
      })),
      (inputData.retrievalPlan?.features || []).map((feature) => ({
        id: feature.id,
        text: feature.text,
      })),
    );
    return { ...inputData, candidateScreening };
  },
});

const selectDocumentsStep = createStep({
  id: "select-report-documents",
  inputSchema: reportWorkflowContextSchema,
  outputSchema: reportWorkflowContextSchema,
  resumeSchema: reportApprovalSchema,
  suspendSchema: reportSuspendPayloadSchema,
  execute: async ({ inputData, resumeData, suspend, bail }) => {
    if (
      passedReturnTarget(inputData, "document-selection") &&
      inputData.selectedPatentIds?.length
    )
      return inputData;
    if (!resumeData) {
      return suspend({
        reportId: inputData.reportId,
        kind: "document-selection",
        title: "请选择需要进行 X/Y/A 辅助分类的候选文献",
        data: {
          ...inputData.searchResult,
          items: (inputData.searchResult?.items || []).filter((item) =>
            inputData.candidateScreening?.find(
              (screening) => screening.id === item.id,
            )?.proceed,
          ),
          screening: inputData.candidateScreening || [],
          retrievalPlan: inputData.retrievalPlan,
          retrievalRounds: inputData.retrievalRounds,
          selectedPatentIds: inputData.selectedPatentIds || [],
        },
      });
    }
    if (resumeData.decision === "cancel") return cancelled(inputData, bail);
    const selectedPatentIds = z
      .array(z.string())
      .min(1)
      .max(20)
      .parse(asRecord(resumeData.data).selectedPatentIds);
    const available = new Set(
      (inputData.searchResult?.items || [])
        .filter((item) =>
          inputData.candidateScreening?.find(
            (screening) => screening.id === item.id,
          )?.proceed,
        )
        .map((item) => item.id),
    );
    if (selectedPatentIds.some((id) => !available.has(id)))
      throw new Error("选择的候选文献不属于当前检索结果");
    return {
      ...inputData,
      returnTo: undefined,
      selectedPatentIds: [...new Set(selectedPatentIds)],
    };
  },
});

const classifyDocumentsStep = createStep({
  id: "classify-report-documents",
  inputSchema: reportWorkflowContextSchema,
  outputSchema: reportWorkflowContextSchema,
  execute: async ({ inputData }) => {
    if (inputData.returnTo && inputData.classifications) return inputData;
    const selected = new Set(inputData.selectedPatentIds || []);
    const patents = (inputData.searchResult?.items || []).filter((item) =>
      selected.has(item.id),
    );
    const targetText = [
      inputData.disclosure.technicalSolution,
      ...inputData.disclosure.keyTechnicalFeatures,
    ]
      .filter(Boolean)
      .join("\n");
    const materials = await getPatentComparisonMaterials(
      patents.map((patent) => patent.id),
    );
    const results = await classifyDocumentsRelevance(
      targetText,
      patents.map((patent) => {
        const material = materials.get(patent.id);
        return {
          id: patent.id,
          abstract: patent.abstract,
          claims: material?.claims || "",
          description: material?.description || "",
          drawings: material?.drawings || "",
          availableSections: material?.availableSections || [],
        };
      }),
      inputData.targetClaimsText,
      new Map(
        (inputData.candidateScreening || [])
          .filter((screening) => selected.has(screening.id))
          .map((screening) => [screening.id, screening]),
      ),
      inputData.retrievalPlan?.features,
    );
    const classifications = patents.map((patent, index) => ({
      patent,
      classification: results[index],
    }));
    return { ...inputData, classifications };
  },
});

const reviewClassificationsStep = createStep({
  id: "review-report-classifications",
  inputSchema: reportWorkflowContextSchema,
  outputSchema: reportWorkflowContextSchema,
  resumeSchema: reportApprovalSchema,
  suspendSchema: reportSuspendPayloadSchema,
  execute: async ({ inputData, resumeData, suspend, bail }) => {
    if (passedReturnTarget(inputData, "classification-review"))
      return inputData;
    if (!resumeData) {
      return suspend({
        reportId: inputData.reportId,
        kind: "classification-review",
        title: "请人工复核 X/Y/A 辅助分类",
        data: inputData.classifications,
      });
    }
    if (resumeData.decision === "cancel") return cancelled(inputData, bail);
    const supplied = asRecord(resumeData.data).classifications;
    const classifications = supplied
      ? z.array(classifiedReportPatentSchema).parse(supplied)
      : inputData.classifications;
    return { ...inputData, returnTo: undefined, classifications };
  },
});

const collectEvaluationInputStep = createStep({
  id: "collect-report-evaluation-input",
  inputSchema: reportWorkflowContextSchema,
  outputSchema: reportWorkflowContextSchema,
  resumeSchema: reportApprovalSchema,
  suspendSchema: reportSuspendPayloadSchema,
  execute: async ({ inputData, resumeData, suspend, bail }) => {
    if (
      passedReturnTarget(inputData, "evaluation-input") &&
      inputData.evaluationInput
    )
      return inputData;
    if (!resumeData) {
      return suspend({
        reportId: inputData.reportId,
        kind: "evaluation-input",
        title: "请补充并确认提案评级事实",
        data: {
          classifications: inputData.classifications,
          requiredFields: [
            "isUsedOnProduct",
            "isUsedOnMarketProduct",
            "enforceability",
            "isStandardEssentialPatent",
            "relatedADocumentCount",
            "inventionPoints",
          ],
        },
      });
    }
    if (resumeData.decision === "cancel") return cancelled(inputData, bail);
    const evaluationInput = z
      .object({ evaluationInput: z.unknown() })
      .parse(resumeData.data).evaluationInput;
    return {
      ...inputData,
      returnTo: undefined,
      evaluationInput: proposalEvaluationInputSchema.parse(evaluationInput),
    };
  },
});

const evaluateProposalStep = createStep({
  id: "evaluate-report-proposal",
  inputSchema: reportWorkflowContextSchema,
  outputSchema: reportWorkflowContextSchema,
  execute: async ({ inputData }) => {
    if (!inputData.evaluationInput) throw new Error("缺少评级输入");
    return {
      ...inputData,
      evaluation: evaluateProposal(inputData.evaluationInput),
    };
  },
});

const generateConclusionStep = createStep({
  id: "generate-report-conclusion",
  inputSchema: reportWorkflowContextSchema,
  outputSchema: reportWorkflowContextSchema,
  execute: async ({ inputData }) => {
    const classifications = inputData.classifications || [];
    const counts = { X: 0, Y: 0, A: 0 };
    for (const item of classifications) {
      if (item.classification.category in counts)
        counts[item.classification.category as "X" | "Y" | "A"]++;
    }
    const reportableClassifications = classifications.filter(
      ({ classification }) => ["X", "Y", "A"].includes(classification.category),
    );
    const keyPatentAnalysis = reportableClassifications
      .map(
        ({ patent, classification }) =>
          `${patent.docNumber}《${patent.title}》：${classification.category}类，${classification.conclusion}`,
      )
      .join("\n");
    const ipcDistribution = [
      ...new Set(classifications.flatMap(({ patent }) => patent.ipcCodes)),
    ]
      .slice(0, 20)
      .join("、");
    const stream = await streamConclusion({
      searchTopic:
        inputData.strategy?.topic || inputData.disclosure.inventionName,
      searchResults: `共检索到 ${inputData.searchResult?.total || 0} 件文献；选取 ${classifications.length} 件复核，其中 X 类 ${counts.X} 件、Y 类 ${counts.Y} 件、A 类 ${counts.A} 件；其余文献不纳入报告或待人工复核。`,
      keyPatentAnalysis: keyPatentAnalysis || "未选择可分析的候选专利。",
      patentMap: ipcDistribution || "暂无可用 IPC 分布数据。",
      innovationAssessment:
        inputData.evaluation?.ruleTrace.join("\n") || "暂无规则评级结果。",
    });
    let conclusion = "";
    for await (const chunk of stream) conclusion += chunk;
    return { ...inputData, conclusion };
  },
});

const confirmFinalReportStep = createStep({
  id: "confirm-final-report",
  inputSchema: reportWorkflowContextSchema,
  outputSchema: reportWorkflowContextSchema,
  resumeSchema: reportApprovalSchema,
  suspendSchema: reportSuspendPayloadSchema,
  execute: async ({ inputData, resumeData, suspend, bail }) => {
    if (!resumeData) {
      return suspend({
        reportId: inputData.reportId,
        kind: "final-report",
        title: "请确认最终报告内容",
        data: inputData,
      });
    }
    if (resumeData.decision === "cancel") return cancelled(inputData, bail);
    const conclusion = asRecord(resumeData.data).conclusion;
    return {
      ...inputData,
      conclusion:
        typeof conclusion === "string" ? conclusion : inputData.conclusion,
      status: "completed" as const,
    };
  },
});

export const reportWorkflow = createWorkflow({
  id: "patent-search-report-workflow",
  inputSchema: reportWorkflowContextSchema,
  outputSchema: reportWorkflowContextSchema,
})
  .then(prepareStrategyStep)
  .then(confirmStrategyStep)
  .then(searchPatentsStep)
  .then(screenCandidatesStep)
  .then(selectDocumentsStep)
  .then(classifyDocumentsStep)
  .then(reviewClassificationsStep)
  .then(collectEvaluationInputStep)
  .then(evaluateProposalStep)
  .then(generateConclusionStep)
  .then(confirmFinalReportStep)
  .commit();
