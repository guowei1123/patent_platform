import { NextResponse } from "next/server";
import { z } from "zod";
import { getAnonymousResourceId } from "@/src/mastra/anonymous-session";
import { conversationTypeSchema } from "@/src/mastra/contracts";
import {
  createConversation,
  listConversations,
} from "@/src/mastra/conversation-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const type = conversationTypeSchema.safeParse(
      new URL(request.url).searchParams.get("type") || undefined,
    );
    if (!type.success && new URL(request.url).searchParams.has("type"))
      return NextResponse.json({ error: "对话类型不正确" }, { status: 400 });
    return NextResponse.json({
      items: await listConversations(
        await getAnonymousResourceId(),
        type.success ? type.data : undefined,
      ),
    });
  } catch (error) {
    console.error("Conversation list failed", error);
    return NextResponse.json({ error: "读取对话历史失败" }, { status: 500 });
  }
}

const createSchema = z.object({
  type: conversationTypeSchema.default("qa"),
  title: z.string().trim().min(1).max(80).default("新对话"),
});
export async function POST(request: Request) {
  try {
    const input = createSchema.parse(await request.json());
    return NextResponse.json(
      await createConversation(
        await getAnonymousResourceId(),
        input.type,
        input.title,
      ),
      { status: 201 },
    );
  } catch (error) {
    if (error instanceof z.ZodError || error instanceof SyntaxError)
      return NextResponse.json({ error: "创建参数不正确" }, { status: 400 });
    return NextResponse.json({ error: "创建对话失败" }, { status: 500 });
  }
}
