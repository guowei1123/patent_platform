import { z } from "zod";
import {
  classifyDocumentRelevance,
  documentClassificationInputSchema,
} from "./service";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const input = documentClassificationInputSchema.parse(await request.json());
    return Response.json(await classifyDocumentRelevance(input));
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
