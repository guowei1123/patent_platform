import { ChatOpenAI } from "@langchain/openai";
import { z } from "zod";

export const runtime = "nodejs";

const requestSchema = z.object({
  targetText: z.string().trim().min(20).max(50_000),
  referenceText: z.string().trim().min(20).max(50_000),
});

const responseSchema = z.object({
  category: z.enum(["X", "Y", "A"]),
  confidence: z.enum(["高", "中", "低"]),
  conclusion: z.string(),
  featureMappings: z
    .array(
      z.object({
        targetFeature: z.string(),
        referenceDisclosure: z.string(),
        assessment: z.enum(["已披露", "未披露", "部分披露"]),
      }),
    )
    .max(8),
  reviewNote: z.string(),
});

function toText(value: unknown): string {
  if (typeof value === "string" || typeof value === "number")
    return String(value).trim();
  if (Array.isArray(value)) return value.map(toText).filter(Boolean).join("；");
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return toText(
      record.text ||
        record.content ||
        record.description ||
        record.reason ||
        Object.values(record),
    );
  }
  return "";
}

function normalizeCategory(value: unknown): "X" | "Y" | "A" {
  const text = toText(value).toUpperCase();
  if (text.includes("X")) return "X";
  if (text.includes("Y")) return "Y";
  return "A";
}

function normalizeConfidence(value: unknown): "高" | "中" | "低" {
  const text = toText(value);
  return text.includes("高") ? "高" : text.includes("中") ? "中" : "低";
}

function normalizeAssessment(value: unknown): "已披露" | "未披露" | "部分披露" {
  const text = toText(value);
  if (text.includes("未披露")) return "未披露";
  if (text.includes("部分")) return "部分披露";
  return "已披露";
}

function parseJson(content: unknown) {
  const text = Array.isArray(content)
    ? content.map(toText).filter(Boolean).join("")
    : toText(content);
  const json = text
    .replace(/^\s*```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/, "");
  const parsed = JSON.parse(json) as Record<string, unknown>;
  const mappings = Array.isArray(parsed.featureMappings)
    ? parsed.featureMappings
    : [];

  return responseSchema.parse({
    category: normalizeCategory(parsed.category),
    confidence: normalizeConfidence(parsed.confidence),
    conclusion: toText(parsed.conclusion),
    featureMappings: mappings
      .map((item) => {
        const record =
          item && typeof item === "object"
            ? (item as Record<string, unknown>)
            : {};
        return {
          targetFeature: toText(record.targetFeature),
          referenceDisclosure: toText(record.referenceDisclosure),
          assessment: normalizeAssessment(record.assessment),
        };
      })
      .filter((item) => item.targetFeature)
      .slice(0, 8),
    reviewNote: toText(parsed.reviewNote),
  });
}

function getModel() {
  return new ChatOpenAI({
    modelName: process.env.OPENAI_CHAT_MODEL,
    temperature: 0,
    openAIApiKey: process.env.OPENAI_API_KEY,
    configuration: { baseURL: process.env.OPENAI_BASE_URL },
    timeout: 90_000,
    maxRetries: 1,
  });
}

export async function POST(request: Request) {
  try {
    const { targetText, referenceText } = requestSchema.parse(
      await request.json(),
    );
    const prompt = `你是一名专利检索分析师。请把“对比文献”相对于“目标技术方案”初步归为 X、Y 或 A 类，并逐项比对技术特征。

类别定义：
- X：单篇对比文献已披露目标方案全部必要技术特征，可能单独影响新颖性；只有证据充分时才能标 X。
- Y：单篇文献未完整披露目标方案，但与其他文献结合时可能影响创造性；不得将单篇不完整披露误标为 X。
- A：相关背景技术或一般相关文献，不足以单独或显而易见地组合影响目标方案。

要求：
1. 仅基于给定文本；缺少权利要求、公开日或完整内容时降低置信度，并在 reviewNote 说明。
2. 这只是检索辅助标注，不是法律结论；不得断言专利必然无效或必然具备新颖性/创造性。
3. featureMappings 最多 8 项，assessment 只能为“已披露”“未披露”或“部分披露”。
4. 只返回 JSON：{"category":"X/Y/A","confidence":"高/中/低","conclusion":"简短结论","featureMappings":[{"targetFeature":"目标技术特征","referenceDisclosure":"对比文献对应披露或未披露说明","assessment":"已披露/未披露/部分披露"}],"reviewNote":"人工复核提示"}。

目标技术方案：
${targetText}

对比文献：
${referenceText}`;

    const response = await getModel().invoke(prompt);
    return Response.json(parseJson(response.content));
  } catch (error) {
    if (error instanceof z.ZodError || error instanceof SyntaxError) {
      return Response.json(
        { error: "请求参数或模型返回格式不正确" },
        { status: 400 },
      );
    }
    console.error("Patent document relevance classification failed", error);
    return Response.json(
      { error: "对比文献分类失败，请稍后重试" },
      { status: 500 },
    );
  }
}
