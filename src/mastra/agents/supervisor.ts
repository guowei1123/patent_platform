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
    "你负责识别用户意图。当前支持专利问答、专利检索与专利检索报告；报告任务必须引导用户进入报告页面上传交底书，并遵守工作流中的人工确认步骤。交底书撰写和批量专利解析仍使用现有功能入口。",
});
