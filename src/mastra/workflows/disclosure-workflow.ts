import { createStep, createWorkflow } from "@mastra/core/workflows";
import { z } from "zod";
import { noopObserve } from "@mastra/core/tools";
import { planDisclosureTools } from "../agents/disclosure-agent";
import {
  commandSchema,
  stateSchema,
  modelResultSchema,
} from "../disclosure/contracts";
import {
  disclosureFeatureTools,
  disclosureToolInputSchema,
  validateUserSolutionTool,
  applyDisclosureResultTool,
} from "../tools/disclosure-tools";

const inputSchema = disclosureToolInputSchema.pick({
  state: true,
  command: true,
  imageAssets: true,
});
const plannedSchema = inputSchema.extend({
  plan: z.object({
    requiresSolution: z.boolean(),
    tools: z.array(
      z.enum([
        "organizeDisclosureMaterialsTool",
        "generateDisclosureBackgroundTool",
        "generateDisclosureBenefitsTool",
        "generateDisclosureProtectionTool",
        "polishDisclosureSolutionTool",
        "detectDisclosureProblemsTool",
        "checkDisclosureImagesTool",
        "explainDisclosureTermsTool",
      ]),
    ),
  }),
});
const generatedSchema = inputSchema.extend({ result: modelResultSchema });

const plan = createStep({
  id: "plan-disclosure-tools",
  inputSchema,
  outputSchema: plannedSchema,
  execute: async ({ inputData }) => ({
    ...inputData,
    plan: planDisclosureTools(inputData.command),
  }),
});

const executeTools = createStep({
  id: "execute-disclosure-tools",
  inputSchema: plannedSchema,
  outputSchema: generatedSchema,
  execute: async ({ inputData, mastra, requestContext, abortSignal }) => {
    const { state, command, plan } = inputData;
    let result = modelResultSchema.parse({
      reply: "",
      facts: state.facts,
      questions: state.questions,
      issues: [],
      patches: [],
    });
    const context = {
      mastra,
      requestContext,
      abortSignal,
      observe: noopObserve,
    };
    const validateSolution = async () => {
      const validation = await validateUserSolutionTool.execute!(
        disclosureToolInputSchema.parse({ state, command, result }),
        context,
      );
      if (!validation || !("ready" in validation))
        throw new Error("技术方案校验工具未返回有效结果");
      result = modelResultSchema.parse(validation.result);
      return validation.ready;
    };
    if (
      plan.requiresSolution &&
      plan.tools[0] !== "organizeDisclosureMaterialsTool" &&
      !(await validateSolution())
    )
      return { state, command, result };
    for (const name of plan.tools) {
      const tool = disclosureFeatureTools[name];
      result = modelResultSchema.parse(
        await tool.execute!(
          disclosureToolInputSchema.parse({
            state,
            command,
            result,
            imageAssets: inputData.imageAssets,
          }),
          context,
        ),
      );
      if (
        name === "organizeDisclosureMaterialsTool" &&
        plan.requiresSolution &&
        !(await validateSolution())
      )
        return { state, command, result };
    }
    return { state, command, result };
  },
});

const review = createStep({
  id: "validate-disclosure-tool-results",
  inputSchema: generatedSchema,
  outputSchema: stateSchema,
  execute: async ({ inputData, mastra, requestContext, abortSignal }) =>
    stateSchema.parse(
      await applyDisclosureResultTool.execute!(inputData, {
        mastra,
        requestContext,
        abortSignal,
        observe: noopObserve,
      }),
    ),
});

/** 编排层只负责路由、调用和交接，功能实现全部位于工具及其 service。 */
export const disclosureWorkflow = createWorkflow({
  id: "patent-disclosure-workflow",
  inputSchema,
  outputSchema: stateSchema,
})
  .then(plan)
  .then(executeTools)
  .then(review)
  .commit();
