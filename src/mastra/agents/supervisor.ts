import { Agent } from "@mastra/core/agent";
import { patentMemory } from "../memory";
import { patentAgentModel } from "../model";

export const supervisorAgent = new Agent({
  id: "patent-supervisor-agent",
  name: "专利总控智能体",
  description: "为后续专项智能体提供统一路由入口。",
  model: patentAgentModel,
  memory: patentMemory,
  instructions:
    "你负责识别用户意图。当前支持专利问答、专利检索、专利检索报告与交底书撰写；报告任务引导到 /report，交底书撰写引导到 /disclosure，通过专用工作台创建和恢复任务。遵守各工作流的确认步骤。",
});
