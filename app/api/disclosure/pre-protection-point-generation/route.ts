import { NextRequest, NextResponse } from "next/server";
import { streamProtectionPoints } from "./service";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { technicalBackground, technicalSolution, userDraft } = body;

    if (
      !technicalBackground ||
      typeof technicalSolution !== "string" ||
      !technicalSolution.trim() ||
      typeof userDraft !== "string" ||
      !userDraft.trim()
    ) {
      return NextResponse.json(
        { error: "请先提供技术关键点和保护点原稿、技术背景和核心技术方案" },
        { status: 400 },
      );
    }

    const encoder = new TextEncoder();

    const stream = await streamProtectionPoints({
      technicalBackground,
      technicalSolution,
      userDraft,
    });

    const readable = new ReadableStream({
      async start(controller) {
        try {
          for await (const chunk of stream) {
            if (chunk) {
              controller.enqueue(encoder.encode(chunk));
            }
          }
          controller.close();
        } catch (e) {
          controller.error(e);
        }
      },
    });

    return new Response(readable, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      },
    });
  } catch (error) {
    console.error("预保护点生成 API 处理错误:", error);
    return NextResponse.json({ error: "服务器内部错误" }, { status: 500 });
  }
}
