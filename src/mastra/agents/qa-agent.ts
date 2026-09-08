import { Agent } from "@mastra/core/agent";
import { patentMemory } from "../memory";
import { patentAgentModel } from "../model";
import { QA_GROUNDING_INSTRUCTIONS } from "../../../lib/rag/qa";

export const qaAgent = new Agent({
  id: "patent-qa-agent",
  name: "专利问答智能体",
  description: "回答专利流程、交底书、检索与本系统使用问题。",
  model: patentAgentModel,
  memory: patentMemory,
  instructions: `你是专业的专利问答助手。用中文回答专利申请流程、交底书撰写、检索方法和本系统功能问题。
保持准确、友好、简洁；不确定的内容必须说明需要人工或权威材料复核。
不得提供确定法律结论，不得虚构公司制度或检索结果。
${QA_GROUNDING_INSTRUCTIONS}`,
});
