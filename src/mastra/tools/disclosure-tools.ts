import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { stateSchema, issueSchema } from "../disclosure/contracts";
import { checkDisclosure } from "../disclosure/quality";

export const checkDisclosureTool = createTool({
  id: "check-disclosure",
  description: "检查交底书必填章节、量化数据来源和图片检查状态。",
  inputSchema: stateSchema,
  outputSchema: z.array(issueSchema),
  execute: async (state) => checkDisclosure(state),
});
