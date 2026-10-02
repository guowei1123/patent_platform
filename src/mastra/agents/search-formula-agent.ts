import { Agent } from "@mastra/core/agent";
import { patentMemory } from "../memory";
import { patentAgentModel } from "../model";
import { recommendIpcTool, recommendKeywordsTool } from "../tools/search-tools";

export const searchFormulaAgent = new Agent({
  id: "patent-search-formula-agent",
  name: "专利检索式智能体",
  description: "根据专利交底书形成可人工编辑的检索策略。",
  model: patentAgentModel,
  memory: patentMemory,
  tools: { recommendKeywordsTool, recommendIpcTool },
  instructions: `你是专利检索式智能体。你的任务是根据交底书中的客观技术事实，形成供用户审核的初始检索策略。

规则：
- 只能使用用户提供的交底书内容和推荐工具；不得虚构技术事实、IPC 或检索结果。
- 优先保留交底书已提取的关键词和 IPC/CPC；信息不足时可调用推荐工具补充。
- 关键词应覆盖核心部件、方法步骤和技术效果，最多 15 个；IPC/CPC 最多 10 个。
- 首次策略必须采用调用方提供的 targetKeywordLanguage，并与交底书主语言保持一致：中文交底书使用中文关键词，英文交底书使用英文关键词。用户后续手动添加的词可保留原样。
- 必须返回 keywordGroups：同义词、近义词、中英文对译词、英文名、缩写或可替代表述放在同一组并用 OR；不同技术要素必须分到不同组，组与组之间由系统用 AND 连接。每个关键词只能出现一次。
- 调用方提供 selectedKeywords 时，必须保留其中每个词，并仅判断它们之间的语义关系；不得删除或替换这些词。
- 本轮只生成策略，不查询专利库，也不对新颖性、创造性或侵权作结论。
- 最终必须按调用方给定的结构化字段返回，理由简明说明取舍依据。`,
});
