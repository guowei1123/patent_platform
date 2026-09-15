import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { JsonOutputParser } from "@langchain/core/output_parsers";
import { RunnableSequence } from "@langchain/core/runnables";
import { ChatOpenAI } from "@langchain/openai";
import { imageReviewSchema } from "./contracts";

const model = new ChatOpenAI({
  modelName: process.env.OPENAI_VISION_MODEL,
  temperature: 0,
  openAIApiKey: process.env.OPENAI_API_KEY,
  configuration: { baseURL: process.env.OPENAI_BASE_URL },
  maxRetries: 1,
  timeout: 60000,
});

const chain = RunnableSequence.from([
  (input: { imageUrl: string; caption: string; technicalSolution: string }) => [
    new SystemMessage(`你是专利交底书的图文一致性核验员。只依据图片、附图说明和技术方案文本进行核验，不能编造图中标号或部件。
检查：图中可读标号/文字是否在正文或图注得到解释；图注与图中对象是否冲突；正文是否声称图中没有显示的关键结构。
返回严格 JSON：status 只能是 passed、warning 或 failed；summary 是简短结论；detectedLabels 是实际可读的标号或文字；issues 是可定位的待复核项。图片模糊、不可读或无法判断时必须为 failed 或 warning，不能说通过。`),
    new HumanMessage({
      content: [
        {
          type: "text",
          text: `附图说明：${input.caption || "（未填写）"}\n技术方案：${input.technicalSolution.slice(0, 16000) || "（未填写）"}`,
        },
        { type: "image_url", image_url: { url: input.imageUrl } },
      ],
    }),
  ],
  model,
  new JsonOutputParser(),
]);

export async function crossCheckDisclosureImage(input: {
  imageUrl: string;
  caption: string;
  technicalSolution: string;
}) {
  const result = await chain.invoke(input);
  return imageReviewSchema.parse(result);
}
