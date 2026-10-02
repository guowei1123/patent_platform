import { ChatPromptTemplate } from "@langchain/core/prompts";
import { RunnableSequence } from "@langchain/core/runnables";
import { JsonOutputParser } from "@langchain/core/output_parsers";
import { ChatOpenAI } from "@langchain/openai";
import { CallbackHandler } from "@langfuse/langchain";

const langfuseHandler = new CallbackHandler();

// 1. 核心改动：将“背景技术生成”提示词改为“关键词推荐”提示词
const KEYWORD_RECOMMENDATION_TEMPLATE = `你是一位资深的专利检索专家。请根据用户提供的核心专利关键词，生成可用于专利检索的关联词。

输入信息：
1. 核心专利关键词：{coreKeyword}
2. 期望关联词数量：{desiredCount}

生成要求：
1. 按以下五类分别给出推荐：上位概念、下位概念、同类词、英文同类词、英文简写。
2. 联想词应同时覆盖中文、英文和行业缩写：核心词为中文时，在 englishTerms、abbreviations 中给出英文对译与缩写；核心词为英文时，在 similarTerms 中给出中文对译或中文同类词。
3. 每一类给出 0 至 3 个专业、精准的词；没有可靠候选时返回空数组，不要编造。
4. 输出合法 JSON，字段为 upperConcepts、lowerConcepts、similarTerms、englishTerms、abbreviations。
   示例：{{"upperConcepts":["人工智能"],"lowerConcepts":["卷积神经网络"],"similarTerms":["智能计算"],"englishTerms":["artificial intelligence"],"abbreviations":["AI"]}}

请直接输出 JSON 结果，不要包含 Markdown 代码块标记（如 \`\`\`json），也不要包含开场白。`;

// 创建提示词模板
const keywordPromptTemplate = ChatPromptTemplate.fromTemplate(
  KEYWORD_RECOMMENDATION_TEMPLATE,
);

// 2. 模型配置
const model = new ChatOpenAI({
  modelName: process.env.OPENAI_CHAT_MODEL, // 使用统一的模型配置
  temperature: 0.3, // 较低的温度，保持稳定性
  openAIApiKey: process.env.OPENAI_API_KEY, // 使用统一的 OPENAI_API_KEY
  configuration: {
    baseURL: process.env.OPENAI_BASE_URL, // 使用统一的 OPENAI_BASE_URL
  },
  timeout: 120000, // 120秒超时
  maxRetries: 1,
  streaming: false,
});

// 创建 JSON 输出解析器
const jsonOutputParser = new JsonOutputParser();

// 创建处理链
const keywordRecommendationChain = RunnableSequence.from([
  keywordPromptTemplate,
  model,
  jsonOutputParser,
]);

/**
 * 生成专利关键词关联词
 * @param params 包含核心关键词和期望数量的对象
 * @returns Promise<object> 生成的关联词对象
 */
export type KeywordRecommendationGroups = {
  upperConcepts: string[];
  lowerConcepts: string[];
  similarTerms: string[];
  englishTerms: string[];
  abbreviations: string[];
};

export async function generateKeywords(params: {
  coreKeyword: string;
  desiredCount: number;
}): Promise<KeywordRecommendationGroups> {
  try {
    const timeoutPromise = new Promise<object>((_, reject) => {
      setTimeout(() => reject(new Error("关键词推荐生成超时")), 20000);
    });

    const result = await Promise.race([
      keywordRecommendationChain.invoke(params, {
        callbacks: [langfuseHandler],
      }),
      timeoutPromise,
    ]);

    const raw =
      result && typeof result === "object"
        ? (result as Record<string, unknown>)
        : {};
    const list = (value: unknown) =>
      Array.isArray(value)
        ? [
            ...new Set(
              value
                .filter((item): item is string => typeof item === "string")
                .map((item) => item.trim())
                .filter(Boolean),
            ),
          ].slice(0, 3)
        : [];
    return {
      upperConcepts: list(raw.upperConcepts),
      lowerConcepts: list(raw.lowerConcepts),
      similarTerms: list(raw.similarTerms),
      englishTerms: list(raw.englishTerms),
      abbreviations: list(raw.abbreviations),
    };
  } catch (error) {
    console.error("关键词推荐生成时发生错误:", error);
    throw error;
  }
}

// 可选导出链，供需要时使用
export { keywordRecommendationChain };
