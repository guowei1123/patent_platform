import { NextRequest, NextResponse } from "next/server";
import { streamBackground } from "./service";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      inventionName,
      technicalField,
      existingProblems,
      userDraft,
      technicalSolution,
    } = body;

    if (
      !inventionName ||
      !technicalField ||
      typeof userDraft !== "string" ||
      !userDraft.trim() ||
      typeof technicalSolution !== "string" ||
      !technicalSolution.trim()
    ) {
      return NextResponse.json(
        { error: "请先提供背景原稿和核心技术方案，并填写发明名称、技术领域" },
        { status: 400 },
      );
    }

    const stream = await streamBackground({
      inventionName,
      technicalField,
      userDraft,
      technicalSolution,
      existingProblems: existingProblems || userDraft,
    });

    const encoder = new TextEncoder();
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
      },
    });
  } catch (error) {
    console.error("背景技术生成 API 处理错误:", error);
    return NextResponse.json({ error: "服务器内部错误" }, { status: 500 });
  }
}
