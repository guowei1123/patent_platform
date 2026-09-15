import { RunnableSequence } from "@langchain/core/runnables";
import { JsonOutputParser } from "@langchain/core/output_parsers";
import { ChatOpenAI } from "@langchain/openai";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";

// 图片检测 Prompt 模板
const IMAGE_DETECTION_SYSTEM_PROMPT = `你是一个专业的专利图片审查员。请分析提供的图片，重点检查以下两点：
1. **背景颜色**：检查图片的背景是否为纯白色（或接近纯白色，无杂色背景）。
2. **线条颜色**：检查构成图片的线条是否主要为黑色。

请输出合法的 JSON 格式结果，包含以下字段：
- "isWhiteBackground": boolean, // 背景是否为白色
- "isBlackLines": boolean, // 线条是否为黑色
- "pass": boolean, // 只有当背景为白色且线条为黑色时为 true，否则为 false
- "reason": string // 详细的检测结果说明，如果未通过，请说明具体原因。

请直接输出 JSON 对象，不要包含 Markdown 代码块标记（如 \`\`\`json），也不要包含其他文字。`;

// 创建 OpenAI Compatible 模型实例 (Vision)
const model = new ChatOpenAI({
  modelName: process.env.OPENAI_VISION_MODEL,
  temperature: 0.1,
  openAIApiKey: process.env.OPENAI_API_KEY,
  configuration: {
    baseURL: process.env.OPENAI_BASE_URL,
  },
  maxRetries: 1,
  timeout: 45000,
});

// 创建 JSON 输出解析器
const jsonOutputParser = new JsonOutputParser();

// 创建处理链
const imageDetectionChain = RunnableSequence.from([
  (input: { imageUrl: string }) => {
    return [
      new SystemMessage(IMAGE_DETECTION_SYSTEM_PROMPT),
      new HumanMessage({
        content: [
          { type: "text", text: "请检测这张图片。" },
          {
            type: "image_url",
            image_url: {
              url: input.imageUrl,
            },
          },
        ],
      }),
    ];
  },
  model,
  jsonOutputParser,
]);

/**
 * 检测图片背景和线条颜色
 * @param params 包含图片 URL 或 Base64 的对象
 * @returns Promise<object> 检测结果
 */
export async function detectImageProperties(params: {
  imageUrl: string;
}): Promise<object> {
  try {
    const result = await imageDetectionChain.invoke(params);
    return result;
  } catch (error) {
    console.error("图片检测生成时发生错误:", error);
    throw new Error("图片检测失败");
  }
}

export { imageDetectionChain };
