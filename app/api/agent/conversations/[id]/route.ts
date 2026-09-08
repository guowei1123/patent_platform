import { NextResponse } from "next/server";
import { z } from "zod";
import { getAnonymousResourceId } from "@/src/mastra/anonymous-session";
import {
  deleteConversation,
  getConversationMessages,
  updateConversation,
} from "@/src/mastra/conversation-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const paramsSchema = z.object({ id: z.string().uuid() });

export async function GET(
  _: Request,
  context: { params: Promise<{ id: string }> },
) {
  const parsed = paramsSchema.safeParse(await context.params);
  if (!parsed.success)
    return NextResponse.json({ error: "对话编号不正确" }, { status: 400 });
  const result = await getConversationMessages(
    await getAnonymousResourceId(),
    parsed.data.id,
  );
  return result
    ? NextResponse.json(result)
    : NextResponse.json({ error: "对话不存在" }, { status: 404 });
}

const updateSchema = z.object({ title: z.string().trim().min(1).max(80) });
export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const params = paramsSchema.parse(await context.params);
    const input = updateSchema.parse(await request.json());
    const conversation = await updateConversation(
      await getAnonymousResourceId(),
      params.id,
      { title: input.title },
    );
    return conversation
      ? NextResponse.json(conversation)
      : NextResponse.json({ error: "对话不存在" }, { status: 404 });
  } catch (error) {
    if (error instanceof z.ZodError || error instanceof SyntaxError)
      return NextResponse.json({ error: "更新参数不正确" }, { status: 400 });
    return NextResponse.json({ error: "更新对话失败" }, { status: 500 });
  }
}

export async function DELETE(
  _: Request,
  context: { params: Promise<{ id: string }> },
) {
  const parsed = paramsSchema.safeParse(await context.params);
  if (!parsed.success)
    return NextResponse.json({ error: "对话编号不正确" }, { status: 400 });
  return (await deleteConversation(
    await getAnonymousResourceId(),
    parsed.data.id,
  ))
    ? NextResponse.json({ success: true })
    : NextResponse.json({ error: "对话不存在" }, { status: 404 });
}
