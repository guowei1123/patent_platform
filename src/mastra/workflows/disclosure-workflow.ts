import { createStep, createWorkflow } from "@mastra/core/workflows";
import { z } from "zod";
import { disclosureAgent } from "../agents/disclosure-agent";
import {
  commandSchema,
  stateSchema,
  modelResultSchema,
  sectionsSchema,
  sectionKeys,
} from "../disclosure/contracts";
import { applyModelResult } from "../disclosure/quality";
import { enrichDisclosureWithServices } from "../disclosure/service-adapter";

const inputSchema = z.object({ state: stateSchema, command: commandSchema });
const generatedSchema = inputSchema.extend({ result: modelResultSchema });
const draftResultSchema = modelResultSchema.omit({ patches: true }).extend({
  sections: sectionsSchema.extend({
    inventionName: z.string().min(1).max(300),
    applicationType: z.string().max(100),
    technicalField: z.string().min(1).max(2000),
    techBackground: z.string().min(1).max(20000),
    technicalSolution: z.string().min(1).max(40000),
    beneficialEffects: z.string().min(1).max(15000),
    protectionPoints: z.string().min(1).max(15000),
  }),
});
const generate = createStep({
  id: "organize-and-draft-disclosure",
  inputSchema,
  outputSchema: generatedSchema,
  execute: async ({ inputData }) => {
    const { state, command } = inputData;
    const drafting =
      command.action === "draft" ||
      (command.action === "message" &&
        /(?:生成|撰写|写).*(?:初稿|交底书)/.test(command.message));
    const outputSchema = drafting ? draftResultSchema : modelResultSchema;
    const response = await disclosureAgent.generate<
      z.infer<typeof modelResultSchema> | z.infer<typeof draftResultSchema>
    >(
      JSON.stringify({
        action: drafting ? "draft" : command.action,
        outputRequirement: drafting
          ? "本次是完整初稿生成，按输出结构的 sections 返回所有章节完整正文（不使用 patches）。名称、技术领域、背景、技术方案、效果、保护点均不能为空。不要加章节标题前缀；依据原始材料撰写，缺失实施信息明确写待补充，不能编造。申请类型未知时为空字符串。"
          : "如仅需要澄清，patches 可为空，不得声称已生成正文。",
        instruction: command.message,
        section: command.section,
        sections: state.sections,
        lockedSections: state.lockedSections,
        sources: state.sources,
        facts: state.facts,
        questions: state.questions,
        images: state.images.map((image, index) => ({
          number: index + 1,
          caption: image.caption,
          detection: image.detection,
        })),
      }),
      {
        structuredOutput: { schema: outputSchema },
        maxSteps: 1,
        abortSignal: AbortSignal.timeout(150000),
      },
    );
    if (drafting) {
      const draft = draftResultSchema.parse(response.object);
      if (!["", "发明", "实用新型"].includes(draft.sections.applicationType))
        draft.sections.applicationType = "";
      const result = modelResultSchema.parse({
        ...draft,
        patches: sectionKeys
          .filter(
            (section) => draft.sections[section] !== state.sections[section],
          )
          .map((section) => ({
            section,
            content: draft.sections[section],
            reason: "根据现有材料整理初稿",
          })),
      });
      return {
        ...inputData,
        result: modelResultSchema.parse(
          await enrichDisclosureWithServices({
            state,
            command,
            result,
            drafting: true,
          }),
        ),
      };
    }
    return {
      ...inputData,
      result: modelResultSchema.parse(
        await enrichDisclosureWithServices({
          state,
          command,
          result: modelResultSchema.parse(response.object),
          drafting: false,
        }),
      ),
    };
  },
});
const review = createStep({
  id: "validate-disclosure",
  inputSchema: generatedSchema,
  outputSchema: stateSchema,
  execute: async ({ inputData }) =>
    stateSchema.parse(
      applyModelResult(inputData.state, inputData.result, inputData.command),
    ),
});
export const disclosureWorkflow = createWorkflow({
  id: "patent-disclosure-workflow",
  inputSchema,
  outputSchema: stateSchema,
})
  .then(generate)
  .then(review)
  .commit();
