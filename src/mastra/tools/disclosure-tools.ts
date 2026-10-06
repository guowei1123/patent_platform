import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import {
  stateSchema,
  issueSchema,
  commandSchema,
  modelResultSchema,
} from "../disclosure/contracts";
import { applyModelResult, checkDisclosure } from "../disclosure/quality";
import {
  runDisclosureFeature,
  type DisclosureFeature,
} from "../disclosure/service-adapter";
import {
  getUserTechnicalSolution,
  inspectTechnicalSolution,
  applyExtractedUserSolution,
} from "../disclosure/technical-solution-policy";

export const disclosureToolInputSchema = z.object({
  state: stateSchema,
  command: commandSchema,
  result: modelResultSchema,
  imageAssets: z
    .array(
      z.object({
        id: z.string().uuid(),
        mime: z.enum(["image/png", "image/jpeg"]),
        base64: z.string().max(16000000),
      }),
    )
    .max(10)
    .optional(),
});

function featureTool(
  id: string,
  description: string,
  feature: DisclosureFeature,
) {
  return createTool({
    id,
    description,
    inputSchema: disclosureToolInputSchema,
    outputSchema: modelResultSchema,
    execute: async (input) => runDisclosureFeature(feature, input),
  });
}

export const organizeDisclosureMaterialsTool = featureTool(
  "organize-disclosure-materials",
  "从用户材料提取事实和基本信息，禁止生成核心方案。",
  "materials",
);
export const generateDisclosureBackgroundTool = featureTool(
  "generate-disclosure-background",
  "优化用户背景原稿，补充核心方案相关的背景遗漏，返回待确认建议。",
  "background",
);
export const generateDisclosureBenefitsTool = featureTool(
  "generate-disclosure-benefits",
  "优化用户有益效果原稿，只补充核心方案已有手段支撑的定性效果。",
  "benefits",
);
export const generateDisclosureProtectionTool = featureTool(
  "generate-disclosure-protection",
  "优化用户关键点和保护点原稿，只归纳核心方案已有特征，不扩张范围。",
  "protection",
);
export const polishDisclosureSolutionTool = featureTool(
  "polish-disclosure-solution",
  "仅对用户核心方案进行受限的语言和格式优化，作为待确认建议。",
  "polish",
);
export const detectDisclosureProblemsTool = featureTool(
  "detect-disclosure-problems",
  "调用问题检测服务，仅返回问题，不改写技术方案。",
  "problems",
);
export const checkDisclosureImagesTool = featureTool(
  "check-disclosure-images",
  "调用图片格式及图文核验服务，仅提醒，不改写方案。",
  "images",
);
export const explainDisclosureTermsTool = featureTool(
  "explain-disclosure-terms",
  "调用关键术语解释服务，释义单独保存，不补写核心方案。",
  "terms",
);

export const validateUserSolutionTool = createTool({
  id: "validate-user-disclosure-solution",
  description:
    "校验核心技术方案是否由用户明确提供及是否明显空泛，缺少方案时阻止后续生成。",
  inputSchema: disclosureToolInputSchema,
  outputSchema: z.object({ ready: z.boolean(), result: modelResultSchema }),
  execute: async (input) => {
    const assessment = inspectTechnicalSolution(
      getUserTechnicalSolution(
        applyExtractedUserSolution(input.state, input.result),
      ),
    );
    const result = structuredClone(input.result);
    if (!assessment.ready) {
      result.reply = assessment.message;
      result.questions = [
        "请填写并保存核心技术方案：具体组成或输入、实现步骤或连接关系、输出或执行方式是什么？",
      ];
      result.issues.push({
        section: "technicalSolution",
        severity: "error",
        message: assessment.message,
      });
      result.patches = result.patches.filter((patch) =>
        [
          "inventionName",
          "contactPerson",
          "applicationType",
          "technicalField",
        ].includes(patch.section),
      );
    }
    return { ready: assessment.ready, result };
  },
});

export const applyDisclosureResultTool = createTool({
  id: "validate-and-apply-disclosure-result",
  description:
    "校验工具返回的事实和章节建议，拦截技术内容变化，更新文稿及复核事项。",
  inputSchema: disclosureToolInputSchema,
  outputSchema: stateSchema,
  execute: async (input) =>
    applyModelResult(input.state, input.result, input.command),
});

export const disclosureFeatureTools = {
  organizeDisclosureMaterialsTool,
  generateDisclosureBackgroundTool,
  generateDisclosureBenefitsTool,
  generateDisclosureProtectionTool,
  polishDisclosureSolutionTool,
  detectDisclosureProblemsTool,
  checkDisclosureImagesTool,
  explainDisclosureTermsTool,
};
export type DisclosureFeatureToolName = keyof typeof disclosureFeatureTools;

export const checkDisclosureTool = createTool({
  id: "check-disclosure",
  description: "检查交底书必填章节、量化数据来源和图片检查状态。",
  inputSchema: stateSchema,
  outputSchema: z.array(issueSchema),
  execute: async (state) => checkDisclosure(state),
});

export const disclosureTools = {
  ...disclosureFeatureTools,
  validateUserSolutionTool,
  applyDisclosureResultTool,
  checkDisclosureTool,
};
