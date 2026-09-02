import { z } from "zod";

export const proposalEvaluationInputSchema = z.object({
  isUsedOnProduct: z.boolean(),
  isUsedOnMarketProduct: z.boolean(),
  enforceability: z.enum(["高", "低", "无"]),
  isStandardEssentialPatent: z.boolean(),
  relatedADocumentCount: z.number().int().min(0),
  inventionPoints: z
    .array(
      z.object({
        name: z.string().trim().min(1).max(200),
        hasXDocument: z.boolean(),
        yDocumentCount: z.number().int().min(0),
        yCombinationObvious: z.boolean(),
        isCommonKnowledgeOrObvious: z.boolean(),
      }),
    )
    .min(1)
    .max(20),
});

export type ProposalEvaluationInput = z.infer<
  typeof proposalEvaluationInputSchema
>;

type PointProspect = "高" | "中" | "低" | "无";

function evaluateInventionPoint(
  point: ProposalEvaluationInput["inventionPoints"][number],
  relatedADocumentCount: number,
) {
  if (point.isCommonKnowledgeOrObvious || point.hasXDocument) {
    return {
      name: point.name,
      prospect: "无" as PointProspect,
      reason: point.hasXDocument
        ? "存在 X 类文件，单篇对比文献可能已披露必要技术特征。"
        : "属于公知常识、容易想到、惯用手段简单组合或缺乏创造性的转用/替代。",
    };
  }
  if (
    (point.yDocumentCount === 2 && point.yCombinationObvious) ||
    (point.yDocumentCount >= 3 && point.yCombinationObvious)
  ) {
    return {
      name: point.name,
      prospect: "低" as PointProspect,
      reason: `存在 ${point.yDocumentCount} 个 Y 类文件，且其组合被判断为容易想到。`,
    };
  }
  if (relatedADocumentCount > 5) {
    return {
      name: point.name,
      prospect: "中" as PointProspect,
      reason: "未发现影响创造性的 X/Y 类文件，但相关 A 类文件超过 5 件。",
    };
  }
  return {
    name: point.name,
    prospect: "高" as PointProspect,
    reason: "未发现影响创造性的 X/Y 类文件，且相关 A 类文件少于 5 件。",
  };
}

export function evaluateProposal(input: ProposalEvaluationInput) {
  const points = input.inventionPoints.map((point) =>
    evaluateInventionPoint(point, input.relatedADocumentCount),
  );
  const prospects = points.map((point) => point.prospect);
  const authorizationProspect = prospects.includes("高")
    ? "高"
    : prospects.includes("中")
      ? "中"
      : prospects.every((prospect) => prospect === "低")
        ? "低"
        : prospects.every((prospect) => prospect === "无")
          ? "无"
          : "需人工确认";

  const usageProspect = input.isStandardEssentialPatent
    ? "高"
    : input.enforceability === "无"
      ? "无"
      : "低";

  let proposalGrade: "A" | "B" | "C" | "不通过" | "不适用" | "需人工确认";
  let applicationType: "发明" | "实用新型" | "不申请专利" | "需人工确认";
  if (authorizationProspect === "无" || usageProspect === "无") {
    proposalGrade = "不通过";
    applicationType = "不申请专利";
  } else if (input.isUsedOnMarketProduct) {
    proposalGrade = "不适用";
    applicationType = "实用新型";
  } else if (authorizationProspect === "高" && usageProspect === "高") {
    proposalGrade = "A";
    applicationType = "发明";
  } else if (authorizationProspect === "高" && usageProspect === "低") {
    proposalGrade = "B";
    applicationType = "发明";
  } else if (authorizationProspect === "中" && usageProspect === "低") {
    proposalGrade = "C";
    applicationType = "发明";
  } else if (authorizationProspect === "低") {
    proposalGrade = "不适用";
    applicationType = "实用新型";
  } else {
    proposalGrade = "需人工确认";
    applicationType = "需人工确认";
  }

  const ruleTrace = [
    input.isStandardEssentialPatent
      ? "用途前景：SEP 一律判定为高。"
      : input.enforceability === "无"
        ? "用途前景：无法维权且非 SEP，判定为无。"
        : `用途前景：非 SEP，维权性为${input.enforceability}，按细则判定为低。`,
    `授权前景：${points.map((point) => `${point.name}=${point.prospect}`).join("；")}。`,
    input.isUsedOnProduct
      ? "产品使用：已使用、计划使用于具体车型，或已明确应用于某一架构。"
      : "产品使用：尚未使用于产品。",
    input.isUsedOnMarketProduct
      ? "已使用于上市车型的方案按细则通常申请实用新型；不易发现的方案可由人工追加发明申请判断。"
      : "未标记为已使用于上市车型。",
  ];

  return {
    usageProspect,
    authorizationProspect,
    proposalGrade,
    applicationType,
    inventionPointAssessments: points,
    ruleTrace,
    manualReviewRequired:
      authorizationProspect === "需人工确认" || proposalGrade === "需人工确认",
  };
}