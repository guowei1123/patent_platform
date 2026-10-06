import { NextRequest, NextResponse } from "next/server";
import { streamProposalText } from "./service";
import {
  inspectTechnicalSolution,
  TechnicalSolutionPolicyError,
} from "@/src/mastra/disclosure/technical-solution-policy";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { text, optimizationType } = body;

    // 检查必填字段
    const assessment = inspectTechnicalSolution(
      typeof text === "string" ? text : "",
    );
    if (!assessment.ready) {
      return NextResponse.json({ error: assessment.message }, { status: 400 });
    }

    // 调用服务处理
    const stream = await streamProposalText({
      text,
      optimizationType: optimizationType || "standard",
    });

    // 创建可读流式响应
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
    console.error("技术方案优化 API 处理错误:", error);
    return NextResponse.json(
      {
        error:
          error instanceof TechnicalSolutionPolicyError
            ? error.message
            : "技术方案语言和格式优化暂未完成，原文未修改",
      },
      { status: error instanceof TechnicalSolutionPolicyError ? 422 : 500 },
    );
  }
}

// 添加GET方法用于测试
export async function GET() {
  return NextResponse.json({
    message: "专利技术方案优化 API 正常运行",
    endpoint: "/api/disclosure/proposal-text-optimization",
    method: "POST",
    required_fields: {
      text: "技术方案文本",
      optimizationType: "优化类型 (standard/detailed/concise/legal, 可选)",
    },
  });
}
