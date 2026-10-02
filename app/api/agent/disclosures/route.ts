import { z } from "zod";
import { getAnonymousResourceId } from "@/src/mastra/anonymous-session";
import { createConversation } from "@/src/mastra/conversation-service";
import {
  createDisclosureTask,
  getDisclosureTaskByConversationId,
  listDisclosureTasks,
} from "@/src/mastra/disclosure/task-service";
import { disclosureError } from "@/src/mastra/disclosure/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try {
    const conversationId = new URL(request.url).searchParams.get(
      "conversationId",
    );
    if (conversationId) {
      const parsed = z.string().uuid().safeParse(conversationId);
      if (!parsed.success)
        return Response.json({ error: "对话编号不正确" }, { status: 400 });
      const task = await getDisclosureTaskByConversationId(
        await getAnonymousResourceId(),
        parsed.data,
      );
      return task
        ? Response.json({ task })
        : Response.json({ error: "交底书任务不存在" }, { status: 404 });
    }
    return Response.json({
      items: await listDisclosureTasks(await getAnonymousResourceId()),
    });
  } catch (error) {
    return disclosureError(error);
  }
}
export async function POST(request: Request) {
  try {
    const { title } = z
      .object({ title: z.string().trim().min(1).max(80).default("新交底书") })
      .parse(await request.json());
    const resourceId = await getAnonymousResourceId();
    const conversation = await createConversation(
      resourceId,
      "disclosure",
      title,
    );
    return Response.json(
      { task: await createDisclosureTask(resourceId, conversation.id) },
      { status: 201 },
    );
  } catch (error) {
    return disclosureError(error);
  }
}
