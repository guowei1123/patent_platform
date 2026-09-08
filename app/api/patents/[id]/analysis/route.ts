import { NextResponse } from "next/server";
import { ChatOpenAI } from "@langchain/openai";
import { searchPatents } from "@/app/api/report/patent-search/service";

export const runtime = "nodejs";
export async function POST(
  _: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const id = (await params).id;
  const result = await searchPatents({ id, limit: 1 });
  const patent = result.items.find((item) => item.id === id);
  if (!patent)
    return NextResponse.json({ error: "专利不存在" }, { status: 404 });
  const model = new ChatOpenAI({
    modelName: process.env.OPENAI_CHAT_MODEL,
    temperature: 0.2,
  });
  const response = await model.invoke(
    `仅根据下列专利标题、摘要与IPC，用中文输出“技术问题、核心方案、关键特征、有益效果、检索关键词”。不得推断权利要求、说明书或法律状态。开头写“基于摘要解析”。\n${JSON.stringify(patent)}`,
  );
  return NextResponse.json({
    data: {
      content:
        typeof response.content === "string"
          ? response.content
          : String(response.content),
    },
  });
}
