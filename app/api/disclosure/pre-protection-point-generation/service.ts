import { ChatPromptTemplate } from "@langchain/core/prompts";
import { RunnableSequence } from "@langchain/core/runnables";
import { StringOutputParser } from "@langchain/core/output_parsers";
import { ChatOpenAI } from "@langchain/openai";
import { CallbackHandler } from "@langfuse/langchain";

const langfuseHandler = new CallbackHandler();

const PROTECTION_POINTS_TEMPLATE_STRING = `你是一位专业的专利代理师，请根据以下信息为一份专利申请撰写"技术关键点和欲保护点"（Technical Key Points and Protection Scope）部分。

输入信息：
1. 技术背景：{technicalBackground}
2. 技术方案：{technicalSolution}

撰写要求：
1. **技术关键点**：识别并提炼技术方案中的核心创新点、关键技术手段、算法、架构设计等。
2. **保护范围**：明确本发明请求专利保护的技术范围，包括技术特征、实现方式、应用场景等。
3. **层次清晰**：按照重要程度或逻辑关系，分点列出技术关键点和保护点。
4. **避免泄露**：不要泄露非必要的实现细节，重点描述技术特征和创新点。
5. **语言风格**：使用专业、严谨的专利法律和技术术语。
6. **格式**：分点列出，每点简洁明了。200-400字。

请直接输出技术关键点和欲保护点的内容，不要包含Markdown标题（如# 技术关键点和欲保护点）或其他开场白。`;

const protectionPointsPromptTemplate = ChatPromptTemplate.fromTemplate(
  PROTECTION_POINTS_TEMPLATE_STRING,
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

const protectionPointsChain = RunnableSequence.from([
  protectionPointsPromptTemplate,
  model,
  stringOutputParser,
]);

export async function streamProtectionPoints(params: {
  technicalBackground: string;
  technicalSolution: string;
}) {
  try {
    const stream = await protectionPointsChain.stream(params, {
      callbacks: [langfuseHandler],
    });
    return stream;
  } catch (error) {
    console.error("技术关键点和欲保护点生成时发生错误:", error);
    throw new Error("技术关键点和欲保护点生成失败");
  }
}

/** 供交底书工作流复用的非流式入口。 */
export async function generateProtectionPoints(params: {
  technicalBackground: string;
  technicalSolution: string;
}): Promise<string> {
  try {
    return String(
      await protectionPointsChain.invoke(params, {
        callbacks: [langfuseHandler],
      }),
    ).trim();
  } catch (error) {
    console.error("技术关键点和欲保护点生成时发生错误:", error);
    throw new Error("技术关键点和欲保护点生成失败");
  }
}

export { protectionPointsChain };
