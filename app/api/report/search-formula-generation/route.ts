import { NextRequest, NextResponse } from "next/server";
import { generateFormula, streamFormula } from "./service";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { keywords, ipcCodes, outputFormat, stream } = body;

    if (!keywords) {
      return NextResponse.json(
        { error: "缺少必要参数：keywords" },
        { status: 400 },
      );
    }

    if (!Array.isArray(keywords) || keywords.length === 0) {
      return NextResponse.json(
        { error: "keywords 必须是非空数组" },
        { status: 400 },
      );
    }

    if (ipcCodes !== undefined && !Array.isArray(ipcCodes)) {
      return NextResponse.json(
        { error: "ipcCodes 必须是数组" },
        { status: 400 },
      );
    }

    if (outputFormat && !["format1", "format2"].includes(outputFormat)) {
      return NextResponse.json(
        { error: "outputFormat 必须是 'format1' 或 'format2'" },
        { status: 400 },
      );
    }

    const params = {
      keywords,
      ipcCodes: Array.isArray(ipcCodes) ? ipcCodes : [],
      outputFormat: outputFormat || "format1",
    };

    if (stream) {
      const result = await streamFormula(params);

      const encoder = new TextEncoder();
      const streamResponse = new ReadableStream({
        async start(controller) {
          try {
            for await (const chunk of result.stream) {
              controller.enqueue(
                encoder.encode(
                  `data: ${JSON.stringify({ type: "formula", content: chunk })}\n\n`,
                ),
              );
            }
            controller.close();
          } catch (error) {
            controller.error(error);
          }
        },
      });

      return new Response(streamResponse, {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
        },
      });
    } else {
      const result = await generateFormula(params);
      return NextResponse.json(result);
    }
  } catch (error) {
    console.error("检索式生成API错误:", error);
    return NextResponse.json({ error: "检索式生成失败" }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  return NextResponse.json({
    message: "专利检索式生成 API",
    endpoints: {
      POST: "/api/report/search-formula-generation",
      description: "根据Incopat标准生成专利检索式",
      parameters: {
        keywords: "关键词列表（数组）",
        ipcCodes: "IPC/CPC分类号列表（数组）",
        outputFormat:
          "输出格式：'format1'（关键词+IPC/CPC）或 'format2'（仅关键词）（可选，默认'format1'）",
        stream: "是否使用流式输出（布尔值，可选）",
      },
      response: {
        formula: "生成的检索式",
      },
      formatDescription: {
        format1: "包含关键词和IPC/CPC分类号的检索式",
        format2: "仅包含关键词的检索式",
      },
    },
  });
}
