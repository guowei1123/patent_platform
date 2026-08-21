import { createStep, createWorkflow } from "@mastra/core/workflows";
import { z } from "zod";

import { backgroundGenerationChain } from "../../../app/api/disclosure/background-generation/service";
import { streamBeneficialEffects } from "../../../app/api/disclosure/beneficial-effect-generation/service";
import { generateKeywordsExplanation } from "../../../app/api/disclosure/explanation-of-keywords/service";
import { detectImageProperties } from "../../../app/api/disclosure/image-detection/service";
import { streamProblemDetection } from "../../../app/api/disclosure/problem-detection/service";
import { streamProtectionPoints } from "../../../app/api/disclosure/pre-protection-point-generation/service";
import { optimizeProposalText } from "../../../app/api/disclosure/proposal-text-optimization/service";
import { generateDisclosureDocumentFromTemplate } from "../../../app/api/disclosure/template-export/service";

const imageDetectionSchema = z.object({
  isWhiteBackground: z.boolean(),
  isBlackLines: z.boolean(),
  pass: z.boolean(),
  reason: z.string(),
});

const contentBlockSchema = z.object({
  id: z.string(),
  type: z.enum(["text", "image"]),
  content: z.string(),
  imageUrl: z.string().optional(),
  detectionResult: imageDetectionSchema.optional(),
});

const keywordSchema = z.object({
  term: z.string(),
  definition: z.string(),
});

const warningSchema = z.object({
  type: z.string(),
  message: z.string(),
});

export const disclosureDraftSchema = z.object({
  inventionName: z.string(),
  contactPerson: z.string(),
  applicationType: z.enum(["发明", "实用新型", ""]),
  technicalField: z.string(),
  existingProblems: z.string(),
  techBackground: z.string(),
  contentBlocks: z.array(contentBlockSchema),
  keywords: z.array(keywordSchema),
  aiWarnings: z.array(warningSchema),
  problemDetection: z.string(),
  beneficialEffects: z.string(),
  protectionPoints: z.string(),
});

export type DisclosureDraft = z.infer<typeof disclosureDraftSchema>;

const disclosureDocumentSchema = z.object({
  filename: z.string(),
  contentType: z.string(),
  base64: z.string(),
});

const disclosureExportResultSchema = z.object({
  draft: disclosureDraftSchema,
  document: disclosureDocumentSchema,
});

const stagePayloadSchema = z.object({
  step: z.union([z.literal(2), z.literal(3), z.literal(4), z.literal(5)]),
  draft: disclosureDraftSchema,
});

const draftResumeSchema = z.object({
  draft: disclosureDraftSchema,
});

async function collectTextStream(stream: AsyncIterable<string>) {
  let result = "";
  for await (const chunk of stream) result += chunk;
  return result;
}

function getTechnicalSolution(draft: DisclosureDraft) {
  return draft.contentBlocks
    .filter((block) => block.type === "text")
    .map((block) => block.content.trim())
    .filter(Boolean)
    .join("\n");
}

const validateBasicInfo = createStep({
  id: "validate-basic-info",
  description: "校验交底书基本信息",
  inputSchema: disclosureDraftSchema,
  outputSchema: disclosureDraftSchema,
  execute: async ({ inputData }) => {
    if (
      !inputData.inventionName.trim() ||
      !inputData.contactPerson.trim() ||
      !inputData.applicationType ||
      !inputData.technicalField.trim()
    ) {
      throw new Error("请完整填写发明名称、联系人、申请类型和技术领域");
    }
    return inputData;
  },
});

export const prepareBackground = createStep({
  id: "prepare-background",
  description: "生成并确认技术背景",
  inputSchema: disclosureDraftSchema,
  outputSchema: disclosureDraftSchema,
  resumeSchema: draftResumeSchema,
  suspendSchema: stagePayloadSchema,
  execute: async ({ inputData, resumeData, suspend }) => {
    if (!resumeData) {
      return suspend({ step: 2, draft: inputData });
    }

    const draft = resumeData.draft;
    if (!draft.existingProblems.trim() && !draft.techBackground.trim()) {
      throw new Error("请描述现有技术问题或填写技术背景");
    }
    if (draft.techBackground.trim()) return draft;

    const techBackground = await backgroundGenerationChain.invoke({
      inventionName: draft.inventionName,
      technicalField: draft.technicalField,
      existingProblems: draft.existingProblems,
    });
    return { ...draft, techBackground };
  },
});

export const analyzeTechnicalSolution = createStep({
  id: "analyze-technical-solution",
  description: "优化技术方案、检测图片并分析问题",
  inputSchema: disclosureDraftSchema,
  outputSchema: disclosureDraftSchema,
  resumeSchema: draftResumeSchema,
  suspendSchema: stagePayloadSchema,
  execute: async ({ inputData, resumeData, suspend }) => {
    if (!resumeData) {
      return suspend({ step: 3, draft: inputData });
    }

    const draft = resumeData.draft;
    const technicalSolution = getTechnicalSolution(draft);
    if (!technicalSolution) throw new Error("请填写技术方案");

    const contentBlocks = await Promise.all(
      draft.contentBlocks.map(async (block) => {
        if (block.type === "text" && block.content.trim()) {
          return {
            ...block,
            content: await optimizeProposalText({
              text: block.content,
              optimizationType: "standard",
            }),
          };
        }
        if (block.type === "image" && block.imageUrl) {
          const detectionResult = imageDetectionSchema.parse(
            await detectImageProperties({ imageUrl: block.imageUrl }),
          );
          return { ...block, detectionResult };
        }
        return block;
      }),
    );

    const optimizedDraft = { ...draft, contentBlocks };
    const optimizedSolution = getTechnicalSolution(optimizedDraft);
    const [problemDetection, keywordResult] = await Promise.all([
      streamProblemDetection({ technicalSolution: optimizedSolution }).then(
        collectTextStream,
      ),
      generateKeywordsExplanation({ techSolution: optimizedSolution }),
    ]);
    const parsedKeywords = z
      .object({
        keywords: z.array(
          z.object({ term: z.string(), explanation: z.string() }),
        ),
      })
      .parse(keywordResult);
    const imageWarnings = contentBlocks
      .filter(
        (block) =>
          block.type === "image" && block.detectionResult?.pass === false,
      )
      .map((block) => ({
        type: "image",
        message: `图片检测未通过：${block.detectionResult?.reason || "不符合专利附图要求"}`,
      }));

    return {
      ...optimizedDraft,
      keywords: parsedKeywords.keywords.map((keyword) => ({
        term: keyword.term,
        definition: keyword.explanation,
      })),
      aiWarnings: imageWarnings,
      problemDetection,
    };
  },
});

export const generateBenefits = createStep({
  id: "generate-benefits-and-protection",
  description: "生成有益效果与保护点",
  inputSchema: disclosureDraftSchema,
  outputSchema: disclosureDraftSchema,
  resumeSchema: draftResumeSchema,
  suspendSchema: stagePayloadSchema,
  execute: async ({ inputData, resumeData, suspend }) => {
    if (!resumeData) {
      return suspend({ step: 4, draft: inputData });
    }

    const draft = resumeData.draft;
    const technicalSolution = getTechnicalSolution(draft);
    if (!draft.techBackground.trim() || !technicalSolution) {
      throw new Error("请先完成技术背景和技术方案");
    }

    const [beneficialEffects, protectionPoints] = await Promise.all([
      draft.beneficialEffects.trim()
        ? Promise.resolve(draft.beneficialEffects)
        : streamBeneficialEffects({
            technicalBackground: draft.techBackground,
            technicalSolution,
          }).then(collectTextStream),
      draft.protectionPoints.trim()
        ? Promise.resolve(draft.protectionPoints)
        : streamProtectionPoints({
            technicalBackground: draft.techBackground,
            technicalSolution,
          }).then(collectTextStream),
    ]);

    return { ...draft, beneficialEffects, protectionPoints };
  },
});

export const reviewDisclosure = createStep({
  id: "review-and-approve",
  description: "等待人工预览确认",
  inputSchema: disclosureDraftSchema,
  outputSchema: disclosureDraftSchema,
  resumeSchema: z.object({
    approved: z.literal(true),
    draft: disclosureDraftSchema,
  }),
  suspendSchema: stagePayloadSchema,
  execute: async ({ inputData, resumeData, suspend }) => {
    if (!resumeData) {
      return suspend({ step: 5, draft: inputData });
    }
    return resumeData.draft;
  },
});

const exportDisclosureDocument = createStep({
  id: "export-disclosure-document",
  description: "根据人工确认后的内容生成专利交底书 DOCX 文件",
  inputSchema: disclosureDraftSchema,
  outputSchema: disclosureExportResultSchema,
  execute: async ({ inputData }) => {
    const document = await generateDisclosureDocumentFromTemplate({
      inventionName: inputData.inventionName,
      contactPerson: inputData.contactPerson,
      applicationType: inputData.applicationType,
      technicalField: inputData.technicalField,
      techBackground: inputData.techBackground,
      technicalSolution: getTechnicalSolution(inputData),
      beneficialEffects: inputData.beneficialEffects,
      protectionPoints: inputData.protectionPoints,
    });

    return {
      draft: inputData,
      document: {
        filename: `专利交底书-${inputData.inventionName}.docx`,
        contentType:
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        base64: document.toString("base64"),
      },
    };
  },
});

export const disclosureWorkflow = createWorkflow({
  id: "patent-disclosure-workflow",
  description: "服务端专利交底书五步生成、审查、人工确认与文档导出流程",
  inputSchema: disclosureDraftSchema,
  outputSchema: disclosureExportResultSchema,
})
  .then(validateBasicInfo)
  .then(prepareBackground)
  .then(analyzeTechnicalSolution)
  .then(generateBenefits)
  .then(reviewDisclosure)
  .then(exportDisclosureDocument)
  .commit();
