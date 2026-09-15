import { NextResponse } from "next/server";
import { z } from "zod";
import { getAnonymousResourceId } from "@/src/mastra/anonymous-session";
import { agentModeSchema } from "@/src/mastra/contracts";
import {
  createConversation,
  getConversation,
  titleFromMessage,
  updateConversation,
} from "@/src/mastra/conversation-service";
import { createAgentResponse, agentStreamHeaders } from "@/src/mastra/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const requestSchema = z.object({
  conversationId: z.string().uuid().optional(),
  message: z.string().trim().min(1).max(20_000),
  mode: agentModeSchema.default("auto"),
});

export async function POST(request: Request) {
  try {
    const input = requestSchema.parse(await request.json());
    if (
      input.mode === "disclosure" ||
      (input.mode === "auto" &&
        /(?:撰写|编写|生成|写|修改).*交底书|交底书.*(?:撰写|编写|生成|修改)/.test(
          input.message,
        ))
    )
      return NextResponse.json(
        {
          error: "请进入交底书工作台创建或继续撰写任务。",
          redirect: "/disclosure",
        },
        { status: 409 },
      );
    if (input.mode === "report")
      return NextResponse.json(
        { error: "专利检索报告请通过 /api/agent/reports 上传交底书启动。" },
        { status: 400 },
      );
    const resourceId = await getAnonymousResourceId();
    let conversation = input.conversationId
      ? await getConversation(resourceId, input.conversationId)
      : null;
    if (input.conversationId && !conversation)
      return NextResponse.json(
        { error: "对话不存在或已过期" },
        { status: 404 },
      );
    const type = input.mode === "search" ? "search" : "qa";
    if (!conversation)
      conversation = await createConversation(
        resourceId,
        type,
        titleFromMessage(input.message),
      );
    if (conversation.type !== type)
      return NextResponse.json(
        { error: "问答与专利检索使用独立会话，请在对应页面新建对话。" },
        { status: 409 },
      );
    if (conversation.status === "awaiting_approval")
      return NextResponse.json(
        { error: "当前检索策略待确认，请先确认、修改或取消。" },
        { status: 409 },
      );
    await updateConversation(resourceId, conversation.id, {
      status: "active",
      lastMessagePreview: input.message.slice(0, 160),
    });
    return new Response(
      createAgentResponse({
        conversation,
        resourceId,
        message: input.message,
        mode: input.mode,
      }),
      { headers: agentStreamHeaders },
    );
  } catch (error) {
    if (error instanceof z.ZodError || error instanceof SyntaxError)
      return NextResponse.json({ error: "请求参数不正确" }, { status: 400 });
    console.error("Agent chat failed", error);
    return NextResponse.json({ error: "智能体服务暂不可用" }, { status: 500 });
  }
}
