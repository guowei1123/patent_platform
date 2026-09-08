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
    "你负责识别用户意图。首期仅支持专利问答与专利检索；报告、交底书和解析功能尚未接入智能体，应简要引导用户使用现有功能入口。",
});
