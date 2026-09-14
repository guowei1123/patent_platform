import { ChatOpenAI } from "@langchain/openai";
import { z } from "zod";

const referenceSchema = z.object({
  id: z.string().min(1),
  abstract: z.string().max(20_000).default(""),
  claims: z.string().max(80_000).default(""),
  description: z.string().max(120_000).default(""),
  drawings: z.string().max(40_000).default(""),
  availableSections: z
    .array(z.enum(["claims", "description", "drawings"]))
    .default([]),
});
export const documentClassificationInputSchema = z.object({
  targetText: z.string().trim().min(20).max(50_000),
  targetClaimsText: z.string().trim().max(80_000).optional(),
  referenceText: z.string().trim().min(20).max(50_000),
  otherReferences: z.array(referenceSchema).max(50).default([]),
});
const metricsSchema = z.object({
  coverageRate: z.number().min(0).max(100),
  weightedCoverageRate: z.number().min(0).max(100),
  innovationOverlap: z.boolean(),
  combinationRequired: z.boolean(),
  combinedCoverageRate: z.number().min(0).max(100),
  motivationScore: z.enum(["High", "Low"]),
  combinationDocumentIds: z.array(z.string()),
  motivationReason: z.string(),
  closestDocumentId: z.string().optional(),
  featureGapIds: z.array(z.string()).default([]),
});
export const documentClassificationResultSchema = z.object({
  category: z.enum(["X", "Y", "A", "EXCLUDE", "REVIEW_REQUIRED"]),
  subtype: z
    .enum([
      "X_NOVELTY",
      "Y_COMBINATION",
      "A_PARTIAL",
      "A_BACKGROUND",
      "EXCLUDE",
      "REVIEW_REQUIRED",
    ])
    .optional(),
  confidence: z.enum(["高", "中", "低"]),
  conclusion: z.string(),
  featureMappings: z.array(
    z.object({
      targetFeature: z.string(),
      referenceDisclosure: z.string(),
      assessment: z.enum(["已披露", "未披露", "部分披露"]),
    }),
  ),
  metrics: metricsSchema.optional(),
  evidenceChain: z
    .object({
      abstractScreening: z.enum(["进入深度比对", "摘要不相关", "摘要不足"]),
      abstractReason: z.string(),
      claimComparison: z.enum(["已完成", "缺少权利要求", "未进入"]),
      fullTextVerification: z.enum(["已完成", "材料不足", "未进入"]),
      availableSections: z.array(z.enum(["claims", "description", "drawings"])),
    })
    .optional(),
  requiresHumanReview: z.boolean().default(false),
  riskFlags: z.array(z.string()).default([]),
  reviewNote: z.string(),
});
export type DocumentClassificationInput = z.input<
  typeof documentClassificationInputSchema
>;
export type DocumentClassificationResult = z.infer<
  typeof documentClassificationResultSchema
>;

const evidenceSchema = z.object({
  features: z
    .array(
      z.object({
        id: z.string().min(1),
        text: z.string().min(1),
        // 旧模型输出及部分兼容模型会漏掉该辅助字段；缺失时不得推定为创新点。
        isInnovation: z.boolean().default(false),
        importance: z.enum(["CORE", "KEY", "BASIC"]).default("BASIC"),
      }),
    )
    .min(1),
  documents: z.array(
    z.object({
      id: z.string(),
      confidence: z.enum(["高", "中", "低"]),
      materiallyRelevant: z.boolean().default(true),
      sameCoherentSolution: z.boolean().default(false),
      relationshipsPreserved: z.boolean().default(false),
      sequencePreserved: z.boolean().default(false),
      parameterLimitsPreserved: z.boolean().default(false),
      reviewNote: z.string(),
      disclosures: z.array(
        z.object({
          featureId: z.string(),
          disclosureStatus: z
            .enum([
              "EXPLICIT",
              "IMPLICIT_DIRECT",
              "PARTIAL",
              "NOT_FOUND",
              "UNCERTAIN",
              "CONFLICT",
            ])
            .default("NOT_FOUND"),
          sourceType: z.enum(["claims", "description", "drawings"]).optional(),
          evidenceText: z.string().default(""),
        }),
      ),
    }),
  ),
  combinations: z.array(
    z.object({
      documentIds: z.array(z.string()).min(2),
      motivationScore: z.enum(["High", "Low"]),
      motivationReason: z.string(),
      motivationType: z
        .enum([
          "EXPLICIT_SUGGESTION",
          "SAME_TECHNICAL_PROBLEM",
          "SAME_FUNCTION_EFFECT",
          "KNOWN_EQUIVALENT_SUBSTITUTION",
          "KNOWN_APPLICATION",
          "COMMON_GENERAL_KNOWLEDGE",
          "DOCUMENT_INTERNAL_TEACHING",
          "OTHER_VERIFIED_MOTIVATION",
          "SAME_FIELD_ONLY",
        ])
        .default("SAME_FIELD_ONLY"),
      motivationEvidence: z
        .array(
          z.object({
            documentId: z.string(),
            sourceType: z.enum(["claims", "description", "drawings"]),
            evidenceText: z.string(),
          }),
        )
        .default([]),
      technicallyCompatible: z.boolean().default(false),
      teachingAway: z.boolean().default(false),
      hindsightDetected: z.boolean().default(false),
    }),
  ),
});
type Evidence = z.infer<typeof evidenceSchema>;

class ModelJsonParseError extends SyntaxError {
  constructor(
    message: string,
    readonly raw: string,
  ) {
    super(message);
  }
}

function contentToText(content: unknown) {
  return (
    typeof content === "string"
      ? content
      : Array.isArray(content)
        ? content
            .map((item) => (typeof item === "string" ? item : item?.text || ""))
            .join("")
        : String((content as { text?: string })?.text || "")
  );
}

function extractJsonObjects(text: string) {
  const results: string[] = [];
  for (let start = text.indexOf("{"); start >= 0; start = text.indexOf("{", start + 1)) {
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let index = start; index < text.length; index += 1) {
      const character = text[index];
      if (inString) {
        if (escaped) escaped = false;
        else if (character === "\\") escaped = true;
        else if (character === '"') inString = false;
        continue;
      }
      if (character === '"') inString = true;
      else if (character === "{") depth += 1;
      else if (character === "}" && --depth === 0) {
        results.push(text.slice(start, index + 1));
        break;
      }
    }
  }
  return results;
}

function repairCommonJsonMistakes(text: string) {
  return text
    .replace(/[“”]/g, '"')
    .replace(/,\s*([}\]])/g, "$1")
    .replace(/(["}\]])\s*\r?\n\s*(?="[^"\n]+"\s*:)/g, "$1,");
}

export function parseJson(content: unknown): unknown {
  const text = contentToText(content)
    .replace(/^\s*```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/, "")
    .trim();
  const candidates = [text, ...extractJsonObjects(text)];
  let lastError: unknown;
  for (const candidate of candidates) {
    for (const attempt of [candidate, repairCommonJsonMistakes(candidate)]) {
      try {
        return JSON.parse(attempt);
      } catch (error) {
        lastError = error;
      }
    }
  }
  throw new ModelJsonParseError(
    lastError instanceof Error ? lastError.message : "模型未返回可解析 JSON",
    text,
  );
}

async function invokeJson(prompt: string) {
  const response = await getModel().invoke(prompt);
  try {
    return parseJson(response.content);
  } catch (error) {
    if (!(error instanceof ModelJsonParseError)) throw error;
    const repaired = await getModel().invoke(`你是 JSON 格式修复器。下面内容应为一个 JSON 对象，但存在格式错误。只能修复 JSON 语法，例如缺失逗号、代码块或多余说明；不得改写、删减、补充任何字段或字段值。只返回修复后的合法 JSON 对象。\n\n${error.raw.slice(0, 160_000)}`);
    return parseJson(repaired.content);
  }
}

const disclosureStatuses = new Set([
  "EXPLICIT",
  "IMPLICIT_DIRECT",
  "PARTIAL",
  "NOT_FOUND",
  "UNCERTAIN",
  "CONFLICT",
]);
const sourceTypes = new Set(["claims", "description", "drawings"]);
const maxCombinationDocuments = 3;
const knownMotivationTypes = new Set([
  "EXPLICIT_SUGGESTION",
  "SAME_TECHNICAL_PROBLEM",
  "SAME_FUNCTION_EFFECT",
  "KNOWN_EQUIVALENT_SUBSTITUTION",
  "KNOWN_APPLICATION",
  "COMMON_GENERAL_KNOWLEDGE",
  "DOCUMENT_INTERNAL_TEACHING",
  "OTHER_VERIFIED_MOTIVATION",
  "SAME_FIELD_ONLY",
]);

/**
 * 模型可能重复、漏写或臆造 ID。这里以输入文献清单为准清洗并补齐，
 * 缺失部分按“无披露证据”处理，避免格式问题中断报告或虚增覆盖率。
 */
function normalizeEvidenceInput(raw: unknown, referenceIds: string[] = []): unknown {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return raw;
  const record = raw as Record<string, unknown>;
  const allowed = new Set(referenceIds);
  const featureIds = new Set<string>();
  const features = (Array.isArray(record.features) ? record.features : []).flatMap(
    (feature) => {
      if (!feature || typeof feature !== "object") return [];
      const value = feature as Record<string, unknown>;
      const id = typeof value.id === "string" ? value.id.trim() : "";
      const text = typeof value.text === "string" ? value.text.trim() : "";
      if (!id || !text || featureIds.has(id)) return [];
      featureIds.add(id);
      return [
        {
          ...value,
          id,
          text,
          isInnovation: value.isInnovation === true,
          importance: ["CORE", "KEY", "BASIC"].includes(
            String(value.importance || "").toUpperCase(),
          )
            ? String(value.importance).toUpperCase()
            : "BASIC",
        },
      ];
    },
  );
  const documentIds = new Set<string>();
  const documents = (Array.isArray(record.documents) ? record.documents : [])
    .flatMap((document) => {
      if (!document || typeof document !== "object") return [];
      const value = document as Record<string, unknown>;
      const id = typeof value.id === "string" ? value.id.trim() : "";
      if (!id || documentIds.has(id) || (allowed.size && !allowed.has(id)))
        return [];
      documentIds.add(id);
      const disclosureIds = new Set<string>();
      const disclosures = (Array.isArray(value.disclosures) ? value.disclosures : [])
        .flatMap((disclosure) => {
          if (!disclosure || typeof disclosure !== "object") return [];
          const item = disclosure as Record<string, unknown>;
          const featureId =
            typeof item.featureId === "string" ? item.featureId.trim() : "";
          if (!featureIds.has(featureId) || disclosureIds.has(featureId)) return [];
          disclosureIds.add(featureId);
          const status = String(item.disclosureStatus || "").toUpperCase();
          const sourceType = String(item.sourceType || "").toLowerCase();
          return [
            {
              featureId,
              disclosureStatus: disclosureStatuses.has(status)
                ? status
                : "NOT_FOUND",
              ...(sourceTypes.has(sourceType) ? { sourceType } : {}),
              evidenceText:
                typeof item.evidenceText === "string" ? item.evidenceText : "",
            },
          ];
        });
      const confidence = String(value.confidence || "");
      return [
        {
          ...value,
          id,
          confidence: ["高", "中", "低"].includes(confidence)
            ? confidence
            : "低",
          materiallyRelevant: value.materiallyRelevant !== false,
          sameCoherentSolution: value.sameCoherentSolution === true,
          relationshipsPreserved: value.relationshipsPreserved === true,
          sequencePreserved: value.sequencePreserved === true,
          parameterLimitsPreserved: value.parameterLimitsPreserved === true,
          reviewNote:
            typeof value.reviewNote === "string"
              ? value.reviewNote
              : "模型未提供完整的文献说明。",
          disclosures,
        },
      ];
    })
    .concat(
      referenceIds
        .filter((id) => !documentIds.has(id))
        .map((id) => ({
          id,
          confidence: "低",
          materiallyRelevant: false,
          sameCoherentSolution: false,
          relationshipsPreserved: false,
          sequencePreserved: false,
          parameterLimitsPreserved: false,
          reviewNote: "模型未返回该文献的特征映射，按无披露证据处理。",
          disclosures: [],
        })),
    );
  const combinations = Array.isArray(record.combinations)
    ? record.combinations
        .filter((combination) => {
          const documentIds =
            combination && typeof combination === "object"
              ? (combination as Record<string, unknown>).documentIds
              : undefined;
          return Array.isArray(documentIds) && documentIds.length >= 2;
        })
        .flatMap((combination) => {
          const value = combination as Record<string, unknown>;
          const ids = Array.isArray(value.documentIds)
            ? [...new Set(value.documentIds.filter((id): id is string => typeof id === "string"))]
                .filter((id) => !allowed.size || allowed.has(id))
            : [];
          if (ids.length < 2) return [];
          const score = String(value.motivationScore || "").toLowerCase();
          const motivationType = String(value.motivationType || "").toUpperCase();
          return [
            {
              ...value,
              documentIds: ids,
              // 结合启示不是 High 时一律按 Low 处理，避免模型自造 Medium 抬高 Y 风险。
              motivationScore: score === "high" || score === "高" ? "High" : "Low",
              // 未纳入规则的动机类型不得作为 Y 的结合启示。
              motivationType: knownMotivationTypes.has(motivationType)
                ? motivationType
                : "SAME_FIELD_ONLY",
            },
          ];
        })
    : [];
  return { ...record, features, documents, combinations };
}

/** CR 使用完整披露的特征数；部分披露不计入，组合按同一特征 ID 求并集。 */
export function classifyEvidence(
  raw: unknown,
  referenceIds: string[],
  referenceSources: Map<string, Record<string, string>> = new Map(),
): DocumentClassificationResult[] {
  const evidence: Evidence = evidenceSchema.parse(
    normalizeEvidenceInput(raw, referenceIds),
  );
  const features = evidence.features;
  const featureIds = new Set(features.map((feature) => feature.id));
  const allowed = new Set(referenceIds);
  if (
    featureIds.size !== features.length ||
    allowed.size !== referenceIds.length ||
    evidence.documents.length !== referenceIds.length ||
    new Set(evidence.documents.map((doc) => doc.id)).size !==
      referenceIds.length ||
    evidence.documents.some((doc) => !allowed.has(doc.id))
  )
    throw new Error("特征或文献 ID 重复、缺失或未知");
  for (const doc of evidence.documents) {
    if (
      new Set(doc.disclosures.map((item) => item.featureId)).size !==
        doc.disclosures.length ||
      doc.disclosures.some((item) => !featureIds.has(item.featureId))
    )
      throw new Error("特征映射 ID 无效");
  }
  for (const combination of evidence.combinations) {
    if (
      new Set(combination.documentIds).size !==
        combination.documentIds.length ||
      combination.documentIds.some((id) => !allowed.has(id))
    )
      throw new Error("组合引用了未知或重复文献");
  }
  const isEvidenceVerified = (
    documentId: string,
    sourceType: "claims" | "description" | "drawings" | undefined,
    evidenceText: string,
  ) => {
    const source = referenceSources.get(documentId)?.[sourceType || ""] || "";
    return Boolean(
      sourceType && evidenceText.trim() && source.includes(evidenceText.trim()),
    );
  };
  const disclosure = new Map(
    evidence.documents.map((doc) => [
      doc.id,
      new Map(
        doc.disclosures.map((item) => {
          const verified = isEvidenceVerified(
            doc.id,
            item.sourceType,
            item.evidenceText,
          );
          const status =
            (item.disclosureStatus === "EXPLICIT" ||
              item.disclosureStatus === "IMPLICIT_DIRECT") &&
            (!verified || item.sourceType !== "claims")
              ? "UNCERTAIN"
              : item.disclosureStatus;
          return [item.featureId, { ...item, status, verified }];
        }),
      ),
    ]),
  );
  const covered = new Map(
    evidence.documents.map((doc) => [
      doc.id,
      new Set(
        [...disclosure.get(doc.id)!.values()]
          .filter(
            (item) =>
              item.status === "EXPLICIT" || item.status === "IMPLICIT_DIRECT",
          )
          .map((item) => item.featureId),
      ),
    ]),
  );
  const rate = (count: number) => (count / features.length) * 100;
  const featureWeight = (feature: (typeof features)[number]) =>
    feature.importance === "CORE" ? 3 : feature.importance === "KEY" ? 2 : 1;
  const weightedRate = (ids: Set<string>) => {
    const total = features.reduce((sum, feature) => sum + featureWeight(feature), 0);
    const coveredWeight = features
      .filter((feature) => ids.has(feature.id))
      .reduce((sum, feature) => sum + featureWeight(feature), 0);
    return total ? (coveredWeight / total) * 100 : 0;
  };
  const invalidById = new Map(
    referenceIds.map((id) => [
      id,
      [...disclosure.get(id)!.values()].some(
        (item) =>
          (item.disclosureStatus === "EXPLICIT" ||
            item.disclosureStatus === "IMPLICIT_DIRECT") &&
          item.status === "UNCERTAIN",
      ),
    ]),
  );
  const closestDocumentId = [...referenceIds].sort((left, right) => {
    const score = (id: string) => weightedRate(covered.get(id)!);
    return score(right) - score(left) || covered.get(right)!.size - covered.get(left)!.size;
  })[0];
  const hasSingleCompleteSolution = referenceIds.some((id) => {
    const doc = evidence.documents.find((item) => item.id === id)!;
    return (
      covered.get(id)!.size === features.length &&
      doc.sameCoherentSolution &&
      doc.relationshipsPreserved &&
      doc.sequencePreserved &&
      doc.parameterLimitsPreserved &&
      !invalidById.get(id)
    );
  });
  return referenceIds.map((id) => {
    const doc = evidence.documents.find((item) => item.id === id)!;
    const own = covered.get(id)!;
    const full = own.size === features.length;
    const io = features.some(
      (feature) => feature.isInnovation && own.has(feature.id),
    );
    const combinations = evidence.combinations
      .filter(
        (item) =>
          item.documentIds.includes(id) &&
          item.documentIds.includes(closestDocumentId),
      )
      .map((item) => ({
        ...item,
        union: new Set(
          item.documentIds.flatMap((documentId) => [
            ...covered.get(documentId)!,
          ]),
        ),
      }));
    const motivationVerified = (item: (typeof combinations)[number]) =>
      item.motivationEvidence.length > 0 &&
      item.motivationEvidence.every((evidence) =>
        isEvidenceVerified(
          evidence.documentId,
          evidence.sourceType,
          evidence.evidenceText,
        ),
      );
    const eachDocumentContributes = (item: (typeof combinations)[number]) =>
      item.documentIds.every((documentId) =>
        [...covered.get(documentId)!].some((featureId) =>
          item.documentIds
            .filter((otherId) => otherId !== documentId)
            .every((otherId) => !covered.get(otherId)!.has(featureId)),
        ),
      );
    const qualifies = (item: (typeof combinations)[number]) =>
      !hasSingleCompleteSolution &&
      item.documentIds.length >= 2 &&
      item.documentIds.length <= maxCombinationDocuments &&
      item.union.size === features.length &&
      eachDocumentContributes(item) &&
      item.motivationScore === "High" &&
      item.motivationType !== "SAME_FIELD_ONLY" &&
      !!item.motivationReason.trim() &&
      motivationVerified(item) &&
      item.technicallyCompatible &&
      !item.teachingAway &&
      !item.hindsightDetected;
    const best =
      combinations
        .filter(qualifies)
        .sort((left, right) => left.documentIds.length - right.documentIds.length)[0] ||
      combinations.sort((a, b) => b.union.size - a.union.size)[0];
    const invalidEvidence = invalidById.get(id)!;
    const implicitUsed = [...disclosure.get(id)!.values()].some(
      (item) => item.status === "IMPLICIT_DIRECT",
    );
    const canBeNoveltyX =
      full &&
      doc.sameCoherentSolution &&
      doc.relationshipsPreserved &&
      doc.sequencePreserved &&
      doc.parameterLimitsPreserved &&
      !invalidEvidence;
    const requiresHumanReview =
      invalidEvidence ||
      implicitUsed ||
      (full && !doc.sameCoherentSolution) ||
      (Boolean(best) &&
        !qualifies(best) &&
        best!.union.size === features.length);
    const category = canBeNoveltyX
      ? "X"
      : requiresHumanReview
        ? "REVIEW_REQUIRED"
        : own.size > 0 && !full && best && qualifies(best)
          ? "Y"
          : !doc.materiallyRelevant
            ? "EXCLUDE"
            : "A";
    const metrics = metricsSchema.parse({
      coverageRate: rate(own.size),
      weightedCoverageRate: weightedRate(own),
      innovationOverlap: io,
      combinationRequired: !full,
      combinedCoverageRate: rate(best?.union.size ?? own.size),
      motivationScore: best?.motivationScore || "Low",
      combinationDocumentIds: best?.documentIds || [],
      motivationReason:
        best?.motivationReason || "未提供可验证的组合及结合启示",
      closestDocumentId,
      featureGapIds: features
        .filter((feature) => !own.has(feature.id))
        .map((feature) => feature.id),
    });
    const reason =
      category === "X"
        ? "单篇文献以同一完整技术方案公开全部限制性特征及必要关系。"
        : category === "Y"
          ? "最接近文献与补充文献完整覆盖区别特征，且存在经证据核验的组合动机。"
          : category === "EXCLUDE"
            ? "与目标权利要求不存在实质技术关联，不纳入 X/Y/A 报告分类。"
            : category === "REVIEW_REQUIRED"
              ? "关键证据、同一技术方案或组合条件存在不确定性，需人工复核。"
              : "仅反映部分限制性特征或相关背景技术，不足以形成 X 或 Y。";
    return {
      category,
      subtype:
        category === "X"
          ? "X_NOVELTY"
          : category === "Y"
            ? "Y_COMBINATION"
            : category === "EXCLUDE"
              ? "EXCLUDE"
              : category === "REVIEW_REQUIRED"
                ? "REVIEW_REQUIRED"
                : own.size
                  ? "A_PARTIAL"
                  : "A_BACKGROUND",
      confidence: requiresHumanReview || !own.size ? "低" : doc.confidence,
      requiresHumanReview,
      riskFlags: [
        invalidEvidence ? "EVIDENCE_TEXT_NOT_VERIFIED" : "",
        implicitUsed ? "IMPLICIT_DIRECT_USED" : "",
        !doc.sameCoherentSolution && full
          ? "COHERENT_SOLUTION_NOT_VERIFIED"
          : "",
        best && best.union.size === features.length && !qualifies(best)
          ? "COMBINATION_REQUIREMENTS_NOT_VERIFIED"
          : "",
      ].filter(Boolean),
      metrics,
      conclusion: `CR=${metrics.coverageRate.toFixed(2)}%；加权覆盖率=${metrics.weightedCoverageRate.toFixed(2)}%；IO=${io}；CRQ=${metrics.combinationRequired}；组合覆盖率=${metrics.combinedCoverageRate.toFixed(2)}%；MS=${metrics.motivationScore}。${reason}`,
      featureMappings: features.map((feature) => {
        const item = disclosure.get(id)!.get(feature.id);
        return {
          targetFeature: feature.text,
          referenceDisclosure: item
            ? `${item.status}${item.evidenceText ? `：${item.evidenceText}` : ""}`
            : "NOT_FOUND：未提供披露证据",
          assessment:
            item?.status === "EXPLICIT" || item?.status === "IMPLICIT_DIRECT"
              ? ("已披露" as const)
              : item?.status === "PARTIAL"
                ? ("部分披露" as const)
                : ("未披露" as const),
        };
      }),
      reviewNote: [
        doc.reviewNote,
        "LLM 仅提供特征与证据事实；类别由硬规则引擎裁决。",
      ]
        .filter(Boolean)
        .join(" "),
    };
  });
}

// 旧格式仅用于读取历史结果；缺少指标时不再信任模型直接给出的类别。
export function parseDocumentClassificationResponse(
  content: unknown,
): DocumentClassificationResult {
  const parsed = parseJson(content) as Record<string, unknown>;
  return documentClassificationResultSchema.parse({
    ...parsed,
    category: "A",
    confidence: "低",
    reviewNote: "历史结果缺少量化证据，请重新分类。",
  });
}

const abstractScreeningSchema = z.object({
  documents: z.array(
    z.object({
      id: z.string(),
      proceed: z.boolean(),
      reason: z.string(),
      matchedFeatureIds: z.array(z.string()).default([]),
    }),
  ),
});

export type CandidateScreening = z.infer<typeof abstractScreeningSchema>["documents"][number];

type Reference = z.infer<typeof referenceSchema>;

function buildReferenceSections(reference: Reference) {
  return {
    id: reference.id,
    abstract: reference.abstract.slice(0, 20_000),
    claims: reference.claims.slice(0, 80_000),
    description: reference.description.slice(0, 120_000),
    drawings: reference.drawings.slice(0, 40_000),
    availableSections: reference.availableSections,
  };
}

function getModel() {
  return new ChatOpenAI({
    modelName: process.env.OPENAI_CHAT_MODEL,
    temperature: 0,
    openAIApiKey: process.env.OPENAI_API_KEY,
    configuration: { baseURL: process.env.OPENAI_BASE_URL },
    timeout: 120_000,
    maxRetries: 1,
  });
}

export async function screenCandidateDocuments(
  targetText: string,
  references: Reference[],
  features: Array<{ id: string; text: string }> = [],
): Promise<CandidateScreening[]> {
  const response = await invokeJson(`你是专利检索初筛员。此步骤只能依据摘要，不能阅读、推断或使用权利要求、说明书、附图，也不能判断 X/Y/A。
目标技术方案：${targetText}
目标核心特征：${JSON.stringify(features)}
待筛摘要：${JSON.stringify(references.map(({ id, abstract }) => ({ id, abstract })))}
对每篇文献判断是否值得进入“权利要求拆解比对”：摘要与目标方案存在具体技术特征或技术问题交集时 proceed=true；摘要为空、信息不足或只有宽泛主题相同但无具体交集时 proceed=false。matchedFeatureIds 只能填写输入的特征 ID；没有明确命中时为空数组。只返回 JSON：{"documents":[{"id":"输入ID","proceed":true,"reason":"摘要依据","matchedFeatureIds":["F1"]}]}。所有输入 ID 必须且只能出现一次。`);
  return normalizeCandidateScreening(response, references);
}

/**
 * 摘要初筛是候选收窄步骤，模型漏写或错写 ID 时不能阻断报告流程。
 * 仅接受可回查到输入文献的结果；其余文献保守地保留给后续全文比对。
 */
export function normalizeCandidateScreening(
  raw: unknown,
  references: Array<Pick<Reference, "id" | "abstract">>,
): CandidateScreening[] {
  const record = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const documents = Array.isArray(record.documents) ? record.documents : [];
  const allowed = new Set(references.map((reference) => reference.id));
  const byId = new Map<string, CandidateScreening>();
  for (const item of documents) {
    if (!item || typeof item !== "object") continue;
    const candidate = item as Record<string, unknown>;
    const id = typeof candidate.id === "string" ? candidate.id : "";
    if (!allowed.has(id) || byId.has(id) || typeof candidate.proceed !== "boolean")
      continue;
    byId.set(id, {
      id,
      proceed: candidate.proceed,
      reason:
        typeof candidate.reason === "string" && candidate.reason.trim()
          ? candidate.reason.trim().slice(0, 500)
          : "摘要初筛未提供理由。",
      matchedFeatureIds: Array.isArray(candidate.matchedFeatureIds)
        ? candidate.matchedFeatureIds
            .filter((featureId): featureId is string => typeof featureId === "string")
            .slice(0, 12)
        : [],
    });
  }
  return references.map((reference) => {
    const existing = byId.get(reference.id);
    if (existing) return existing;
    return {
      id: reference.id,
      proceed: Boolean(reference.abstract.trim()),
      reason: reference.abstract.trim()
        ? "摘要初筛结果缺失或文献 ID 无效，已保留待权利要求和全文比对。"
        : "摘要为空，保留待人工补充全文材料。",
      matchedFeatureIds: [],
    };
  });
}

function createScreenedOutResult(
  reference: Reference,
  screening: z.infer<typeof abstractScreeningSchema>["documents"][number],
): DocumentClassificationResult {
  const abstractScreening = reference.abstract.trim()
    ? "摘要不相关"
    : "摘要不足";
  return {
    category: "EXCLUDE",
    subtype: "EXCLUDE",
    confidence: "低",
    conclusion: `摘要初筛未发现实质技术交集，不纳入 X/Y/A 分类；CR=0.00%；组合覆盖率=0.00%。`,
    featureMappings: [],
    metrics: {
      coverageRate: 0,
      weightedCoverageRate: 0,
      innovationOverlap: false,
      combinationRequired: true,
      combinedCoverageRate: 0,
      motivationScore: "Low",
      combinationDocumentIds: [],
      motivationReason: "摘要初筛未发现足以进入深度比对的具体技术交集。",
      closestDocumentId: undefined,
      featureGapIds: [],
    },
    evidenceChain: {
      abstractScreening,
      abstractReason: screening.reason,
      claimComparison: "未进入",
      fullTextVerification: "未进入",
      availableSections: reference.availableSections,
    },
    requiresHumanReview: false,
    riskFlags: [],
    reviewNote:
      "未通过摘要初筛，不作为 A 类背景文献计入报告；如人工确认摘要遗漏关键技术内容，可重新进入深度比对。",
  };
}

async function compareClaimsAndVerify(
  targetText: string,
  targetClaimsText: string | undefined,
  references: Reference[],
  targetFeatures: Array<{
    id: string;
    text: string;
    importance: "CORE" | "KEY" | "BASIC";
    isInnovation: boolean;
  }> = [],
) {
  const target = targetClaimsText
    ? {
        claims: targetClaimsText,
        technicalSolution: targetText,
        note: "本次仅分析一项目标权利要求。若输入的是从属权利要求，必须已包含其引用权利要求的全部限制性特征；未展开的从属关系不得自动裁决。",
      }
    : {
        technicalSolution: targetText,
        note: "目标材料为未申请的专利交底书；以技术方案和关键技术特征作为检索与对比基础，结论为检索辅助结论。",
      };
  return invokeJson(`你是专利技术特征证据提取员。必须严格执行三个阶段：
1. 摘要初筛已完成，以下仅包含已进入深度比对的文献；不得重新用摘要作披露依据。
2. 以对比文献“权利要求书”为主，逐项拆分并比对目标必要技术特征。公开状态只能为 EXPLICIT、IMPLICIT_DIRECT、PARTIAL、NOT_FOUND、UNCERTAIN、CONFLICT。只有权利要求明确完整记载，且 evidenceText 是可从原文逐字回查的连续原文，才可为 EXPLICIT。IMPLICIT_DIRECT 只限本领域技术人员可直接、毫无疑义确定的内容。缺少权利要求的文献不得用说明书补齐。
3. 仅对权利要求中已披露或部分披露的特征，用说明书和附图说明核验具体实施、部件关系和步骤顺序。说明书、附图只能核验，不得单独补齐权利要求未披露的特征。sourceType 和 evidenceText 必须对应输入原文。
不得决定 X/Y/A 或计算覆盖率。每个 document 必须判断 sameCoherentSolution、relationshipsPreserved、sequencePreserved、parameterLimitsPreserved；跨独立实施例拼接时均为 false。组合可由 D1 加一篇或两篇补充文献组成，优先使用文献数量最少的组合；每篇成员必须公开至少一个其他成员未公开的必要特征，禁止将无独立贡献的文件纳入组合。组合动机不能仅为同一技术领域；必须提供 motivationEvidence，且说明技术问题、技术效果与具体结合方式。存在技术冲突、teaching away 或事后分析时如实标出。
若“已编号目标特征”非空，features 必须逐项、原样使用该数组的 id、text、isInnovation、importance，禁止新增、删除、改写或重新编号特征。
只返回 JSON：{"features":[{"id":"F1","text":"必要特征，包含关系/顺序/参数限制","isInnovation":true,"importance":"CORE"}],"documents":[{"id":"输入文献ID","confidence":"低","materiallyRelevant":true,"sameCoherentSolution":true,"relationshipsPreserved":true,"sequencePreserved":true,"parameterLimitsPreserved":true,"reviewNote":"材料边界","disclosures":[{"featureId":"F1","disclosureStatus":"EXPLICIT","sourceType":"claims","evidenceText":"可逐字回查的原文"}]}],"combinations":[{"documentIds":["D1","D2"],"motivationScore":"High","motivationReason":"具体技术问题、技术效果与结合方式","motivationType":"SAME_TECHNICAL_PROBLEM","motivationEvidence":[{"documentId":"D1","sourceType":"description","evidenceText":"原文"}],"technicallyCompatible":true,"teachingAway":false,"hindsightDetected":false}]}。
目标材料：${JSON.stringify(target)}
已编号目标特征：${JSON.stringify(targetFeatures)}
对比文献材料：${JSON.stringify(references.map(buildReferenceSections))}`);
}

export async function classifyDocumentsRelevance(
  targetText: string,
  references: Reference[],
  targetClaimsText?: string,
  screeningOverride?: Map<string, CandidateScreening>,
  targetFeatures?: Array<{
    id: string;
    text: string;
    importance: "CORE" | "KEY" | "BASIC";
    isInnovation: boolean;
  }>,
): Promise<DocumentClassificationResult[]> {
  z.string().trim().min(20).max(50_000).parse(targetText);
  z.array(referenceSchema).max(51).parse(references);
  if (!references.length) return [];
  const screening =
    screeningOverride ||
    new Map(
      (await screenCandidateDocuments(targetText, references)).map((item) => [
        item.id,
        item,
      ]),
    );
  const selected = references.filter(
    (reference) => screening.get(reference.id)!.proceed,
  );
  const classified = selected.length
    ? classifyEvidence(
        await compareClaimsAndVerify(
          targetText,
          targetClaimsText,
          selected,
          targetFeatures,
        ),
        selected.map((item) => item.id),
        new Map(
          selected.map((reference) => [
            reference.id,
            {
              claims: reference.claims,
              description: reference.description,
              drawings: reference.drawings,
            },
          ]),
        ),
      )
    : [];
  const classifiedById = new Map(
    selected.map((item, index) => [item.id, classified[index]]),
  );
  return references.map((reference) => {
    const existing = classifiedById.get(reference.id);
    if (!existing)
      return createScreenedOutResult(reference, screening.get(reference.id)!);
    const hasClaims = Boolean(reference.claims.trim());
    const hasVerificationMaterial = Boolean(
      reference.description.trim() || reference.drawings.trim(),
    );
    const materialReviewRequired =
      !hasClaims ||
      ((existing.category === "X" || existing.category === "Y") &&
        !hasVerificationMaterial);
    return {
      ...existing,
      category:
        materialReviewRequired
          ? "REVIEW_REQUIRED"
          : existing.category,
      subtype:
        materialReviewRequired
          ? "REVIEW_REQUIRED"
          : existing.subtype,
      confidence: hasClaims ? existing.confidence : "低",
      requiresHumanReview:
        existing.requiresHumanReview ||
        materialReviewRequired,
      riskFlags: [
        ...existing.riskFlags,
        ...(!hasClaims ? ["REFERENCE_CLAIMS_MISSING"] : []),
        ...(hasClaims &&
        !hasVerificationMaterial &&
        (existing.category === "X" || existing.category === "Y")
          ? ["FULL_TEXT_VERIFICATION_MISSING"]
          : []),
      ],
      evidenceChain: {
        abstractScreening: "进入深度比对",
        abstractReason: screening.get(reference.id)!.reason,
        claimComparison: hasClaims ? "已完成" : "缺少权利要求",
        fullTextVerification: hasVerificationMaterial ? "已完成" : "材料不足",
        availableSections: reference.availableSections,
      },
      reviewNote: [
        existing.reviewNote,
        !hasClaims ? "缺少权利要求书，按规则不得用说明书或附图补齐特征。" : "",
        !hasVerificationMaterial
          ? "缺少说明书和附图说明，权利要求披露尚未完成全文核验。"
          : "",
        !targetClaimsText
          ? "目标材料为专利交底书，已按技术方案特征进行辅助比对。"
          : "",
      ]
        .filter(Boolean)
        .join(" "),
    };
  });
}

export async function classifyDocumentRelevance(
  input: DocumentClassificationInput,
): Promise<DocumentClassificationResult> {
  const data = documentClassificationInputSchema.parse(input);
  return (
    await classifyDocumentsRelevance(
      data.targetText,
      [
        {
          id: "target-reference",
          abstract: data.referenceText,
          claims: "",
          description: "",
          drawings: "",
          availableSections: [],
        },
        ...data.otherReferences,
      ],
      data.targetClaimsText,
    )
  )[0];
}
