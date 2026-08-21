import { z } from "zod";

import { mastra } from "@/src/mastra";
import { patentMemory } from "@/src/mastra/memory";
import { resolveAgentResource } from "@/src/mastra/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const requestSchema = z.object({
  message: z.string().trim().min(1).max(20_000),
  threadId: z.string().uuid(),
});

const threadSchema = z.string().uuid();

function createThreadTitle(message: string) {
  const normalized = message.replace(/\s+/g, " ").trim();
  return normalized.length > 32 ? `${normalized.slice(0, 32)}…` : normalized;
}

function createHeaders(setCookie?: string) {
  const headers = new Headers({
    "Cache-Control": "no-cache, no-store, must-revalidate",
    "X-Content-Type-Options": "nosniff",
  });

  if (setCookie) headers.set("Set-Cookie", setCookie);
  return headers;
}

function extractText(parts: Array<Record<string, unknown>>) {
  return parts
    .filter((part) => part.type === "text" && typeof part.text === "string")
    .map((part) => String(part.text))
    .join("");
}

export async function GET(request: Request) {
  try {
    const threadId = new URL(request.url).searchParams.get("threadId");
    const { resourceId, setCookie } = resolveAgentResource(request);

    if (!threadId) {
      const result = await patentMemory.listThreads({
        page: 0,
        perPage: 100,
        orderBy: { field: "updatedAt", direction: "DESC" },
        filter: { resourceId },
      });

      return Response.json(
        {
          threads: result.threads.map((thread) => ({
            id: thread.id,
            title: thread.title || "新对话",
            createdAt: new Date(thread.createdAt).toISOString(),
            updatedAt: new Date(thread.updatedAt).toISOString(),
          })),
        },
        { headers: createHeaders(setCookie) },
      );
    }

    const validatedThreadId = threadSchema.parse(threadId);
    const thread = await patentMemory.getThreadById({
      threadId: validatedThreadId,
      resourceId,
    });

    if (!thread) {
      return Response.json(
        { messages: [] },
        { headers: createHeaders(setCookie) },
      );
    }

    const recalled = await patentMemory.recall({
      threadId: validatedThreadId,
      resourceId,
      perPage: false,
    });
    const messages = recalled.messages
      .filter(
        (message) => message.role === "user" || message.role === "assistant",
      )
      .map((message) => ({
        id: message.id,
        role: message.role,
        content: extractText(
          message.content.parts as Array<Record<string, unknown>>,
        ),
        timestamp: message.createdAt.toISOString(),
      }))
      .filter((message) => message.content.length > 0);

    return Response.json(
      { messages },
      { headers: createHeaders(setCookie) },
    );
  } catch (error) {
    if (error instanceof z.ZodError) {
      return Response.json({ error: "会话编号不正确" }, { status: 400 });
    }

    console.error("Patent agent history request failed", error);
    return Response.json({ error: "对话记录加载失败" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const { message, threadId } = requestSchema.parse(await request.json());
    const { resourceId, setCookie } = resolveAgentResource(request);
    const existingThread = await patentMemory.getThreadById({
      threadId,
      resourceId,
    });
    const shouldCreateTitle =
      !existingThread?.title ||
      existingThread.title === "New Thread" ||
      existingThread.title === "新对话";
    const agent = mastra.getAgent("patentCopilot");
    const output = await agent.stream(message, {
      memory: {
        thread: threadId,
        resource: resourceId,
      },
      maxSteps: 6,
    });

    const encoder = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      async start(controller) {
        try {
          for await (const chunk of output.textStream) {
            controller.enqueue(encoder.encode(chunk));
          }
          if (shouldCreateTitle) {
            try {
              await patentMemory.updateThread({
                id: threadId,
                title: createThreadTitle(message),
              });
            } catch (error) {
              console.error("Patent agent thread title update failed", error);
            }
          }
          controller.close();
        } catch (error) {
          controller.error(error);
        }
      },
    });

    const headers = createHeaders(setCookie);
    headers.set("Content-Type", "text/plain; charset=utf-8");
    return new Response(body, { headers });
  } catch (error) {
    if (error instanceof z.ZodError || error instanceof SyntaxError) {
      return Response.json({ error: "请求参数不正确" }, { status: 400 });
    }

    console.error("Patent agent request failed", error);
    return Response.json({ error: "智能体调用失败" }, { status: 500 });
  }
}
