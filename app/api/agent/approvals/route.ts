import { NextResponse } from "next/server";
import { z } from "zod";
import { getAnonymousResourceId } from "@/src/mastra/anonymous-session";
import { searchResumeSchema } from "@/src/mastra/contracts";
import { getConversation } from "@/src/mastra/conversation-service";
import { createAgentResponse, agentStreamHeaders } from "@/src/mastra/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const requestSchema = z.object({
  conversationId: z.string().uuid(),
  runId: z.string().min(1),
  toolCallId: z.string().min(1),
  decision: z.enum(["approve", "edit-and-approve", "cancel"]),
  strategy: z.unknown().optional(),
});

export async function POST(request: Request) {
  try {
    const input = requestSchema.parse(await request.json());
    const resourceId = await getAnonymousResourceId();
    const conversation = await getConversation(
      resourceId,
      input.conversationId,
    );
    if (!conversation || conversation.status !== "awaiting_approval")
      return NextResponse.json(
        { error: "没有待处理的检索确认" },
        { status: 404 },
      );
    const pending = conversation.pendingApproval as {
      runId?: string;
      toolCallId?: string;
    } | null;
    if (
      pending?.runId !== input.runId ||
      pending.toolCallId !== input.toolCallId
    )
      return NextResponse.json(
        { error: "确认请求与当前任务不匹配" },
        { status: 409 },
      );
    const resume = searchResumeSchema.parse({
      decision: input.decision === "cancel" ? "cancel" : "approve",
      strategy:
        input.decision === "edit-and-approve" ? input.strategy : undefined,
    });
    return new Response(
      createAgentResponse({ conversation, resourceId, mode: "search", resume }),
      { headers: agentStreamHeaders },
    );
  } catch (error) {
    if (error instanceof z.ZodError || error instanceof SyntaxError)
      return NextResponse.json({ error: "确认参数不正确" }, { status: 400 });
    console.error("Agent approval failed", error);
    return NextResponse.json({ error: "确认处理失败" }, { status: 500 });
  }
}
