import { ChatPromptTemplate } from "@langchain/core/prompts";
import { RunnableSequence } from "@langchain/core/runnables";
import { StringOutputParser } from "@langchain/core/output_parsers";
import { ChatOpenAI } from "@langchain/openai";

import { CallbackHandler } from "@langfuse/langchain";

const langfuseHandler = new CallbackHandler();

// 背景技术生成模板字符串
const BACKGROUND_GENERATION_TEMPLATE_STRING = `你是一位专业的专利代理师，请根据以下信息为一份专利申请撰写"背景技术"（Background of the Invention）部分。

输入信息：
1. 发明名称：{inventionName}
2. 技术领域：{technicalField}
3. 现有技术问题/缺点：{existingProblems}

撰写要求：
1. **技术领域**：首先简要说明该发明所属的技术领域。
2. **背景技术**：介绍该领域目前的常规技术或主流方案。
3. **现有技术缺点**：重点阐述现有技术中存在的问题、缺点或不足。请充分利用提供的"现有技术问题"信息，并进行合理的专业扩展和深化。分析这些问题产生的原因（如：算法复杂度高、硬件依赖强、处理流程繁琐等）。
4. **技术需求**：最后总结，说明因此迫切需要一种新的技术方案（即本发明）来解决上述问题。
5. **语言风格**：使用专业、严谨的专利法律和技术术语。语气客观、中立。
6. **格式**：分段撰写，逻辑清晰。500字以内。不要包含"发明内容"或具体的技术实现细节，仅聚焦于背景和问题。

请直接输出背景技术的内容，不要包含Markdown标题（如# 背景技术）或其他开场白。`;

// 创建 prompt 模板
const backgroundPromptTemplate = ChatPromptTemplate.fromTemplate(
  BACKGROUND_GENERATION_TEMPLATE_STRING,
);

// 创建 OpenAI Compatible 模型实例
const model = new ChatOpenAI({
  modelName: process.env.OPENAI_CHAT_MODEL,
  temperature: 0.4, // 稍微增加一点创造性，但保持严谨
  openAIApiKey: process.env.OPENAI_API_KEY,
  configuration: {
    baseURL: process.env.OPENAI_BASE_URL,
  },
  timeout: 120000, // 120s timeout
  maxRetries: 1,
  streaming: true,
});

// 创建字符串输出解析器
const stringOutputParser = new StringOutputParser();

// 创建处理链
const backgroundGenerationChain = RunnableSequence.from([
  backgroundPromptTemplate,
  model,
  stringOutputParser,
]);

/**
 * 流式生成专利背景技术
 * @param params 包含发明名称、技术领域和现有技术问题的对象
 * @returns ReadableStream
 */
export async function streamBackground(params: {
  inventionName: string;
  technicalField: string;
  existingProblems: string;
}) {
  try {
    const stream = await backgroundGenerationChain.stream(params, {
      callbacks: [langfuseHandler],
    });
    return stream;
  } catch (error) {
    console.error("背景技术生成时发生错误:", error);
    throw new Error("背景技术生成失败");
  }
}

/** 服务端工作流使用的非流式入口，避免通过本项目 HTTP 接口绕行。 */
export async function generateBackground(params: {
  inventionName: string;
  technicalField: string;
  existingProblems: string;
}): Promise<string> {
  try {
    return String(
      await backgroundGenerationChain.invoke(params, {
        callbacks: [langfuseHandler],
      }),
    ).trim();
  } catch (error) {
    console.error("背景技术生成时发生错误:", error);
    throw new Error("背景技术生成失败");
  }
}

export { backgroundGenerationChain };
