import { z } from "zod";
import {
  parsePatentContent,
  patentParseRequestSchema,
  PatentModelResponseError,
} from "@/app/api/patent/parse/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const input = patentParseRequestSchema.parse(await request.json());
    const { result, meta } = await parsePatentContent(input);
    return Response.json({ success: true, data: result, meta });
  } catch (error) {
    if (error instanceof SyntaxError || error instanceof z.ZodError) {
      return Response.json(
        {
          error:
            "专利内容不符合要求，请提供合计不少于 80 字的摘要、说明书、权利要求书或附图说明",
        },
        { status: 400 },
      );
    }
    if (error instanceof PatentModelResponseError) {
      console.error("Patent model response parsing failed", error);
      return Response.json(
        { error: "模型返回格式异常，请稍后重试" },
        { status: 502 },
      );
    }

    console.error("Patent parse failed", error);
    return Response.json(
      { error: "专利解析失败，请检查模型配置或稍后重试" },
      { status: 500 },
    );
  }
}
