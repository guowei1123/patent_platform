import { ChatPromptTemplate } from "@langchain/core/prompts";
import { RunnableSequence } from "@langchain/core/runnables";
import { StringOutputParser } from "@langchain/core/output_parsers";
import { ChatOpenAI } from "@langchain/openai";
import { CallbackHandler } from "@langfuse/langchain";

const langfuseHandler = new CallbackHandler();

const BENEFICIAL_EFFECTS_TEMPLATE_STRING = `你是一位专业的专利代理师，请根据以下信息为一份专利申请撰写"有益效果"（Beneficial Effects）部分。

输入信息：
1. 技术背景：{technicalBackground}
2. 技术方案：{technicalSolution}

撰写要求：
1. **效果分析**：基于技术方案的核心创新点，分析其带来的具体技术效果。
2. **量化对比**：只有用户明确提供测量结果及条件时才引用量化数据；没有依据时只作定性说明，不能把目标值写成实测结果。
3. **多维度阐述**：从技术性能、实施成本、用户体验、可扩展性等多个角度阐述有益效果。
4. **具体明确**：说明技术手段及其产生效果的机制；不得编造百分比、实验数据、性能提升或对比结果。
5. **语言风格**：使用专业、客观的专利法律和技术术语。
6. **格式**：分段撰写，逻辑清晰。300-500字。

请直接输出有益效果的内容，不要包含Markdown标题（如# 有益效果）或其他开场白。`;

const beneficialEffectsPromptTemplate = ChatPromptTemplate.fromTemplate(
  BENEFICIAL_EFFECTS_TEMPLATE_STRING,
);

const model = new ChatOpenAI({
  modelName: process.env.OPENAI_CHAT_MODEL,
  temperature: 0.4,
  openAIApiKey: process.env.OPENAI_API_KEY,
  configuration: {
    baseURL: process.env.OPENAI_BASE_URL,
  },
  timeout: 120000,
  maxRetries: 1,
  streaming: true,
});

const stringOutputParser = new StringOutputParser();

const beneficialEffectsChain = RunnableSequence.from([
  beneficialEffectsPromptTemplate,
  model,
  stringOutputParser,
]);

export async function streamBeneficialEffects(params: {
  technicalBackground: string;
  technicalSolution: string;
}) {
  try {
    const stream = await beneficialEffectsChain.stream(params, {
      callbacks: [langfuseHandler],
    });
    return stream;
  } catch (error) {
    console.error("有益效果生成时发生错误:", error);
    throw new Error("有益效果生成失败");
  }
}

/** 供交底书工作流复用的非流式入口。 */
export async function generateBeneficialEffects(params: {
  technicalBackground: string;
  technicalSolution: string;
}): Promise<string> {
  try {
    return String(
      await beneficialEffectsChain.invoke(params, {
        callbacks: [langfuseHandler],
      }),
    ).trim();
  } catch (error) {
    console.error("有益效果生成时发生错误:", error);
    throw new Error("有益效果生成失败");
  }
}

export { beneficialEffectsChain };
