import { NextRequest, NextResponse } from "next/server";
import { generateKeywords } from "./service"; // 导入服务

export const dynamic = "force-dynamic";

// 处理 POST 请求（一次性返回 JSON）
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { coreKeyword, desiredCount } = body;

    // 参数验证
    if (!coreKeyword) {
      return NextResponse.json(
        { error: "核心关键词是必需的" },
        { status: 400 },
      );
    }

    // 设置默认值
    const count = desiredCount || 5;

    // 直接生成关键词
    const result = await generateKeywords({
      coreKeyword,
      desiredCount: count,
    });

    const recommendations = Object.values(result).flat();
    return NextResponse.json({
      success: true,
      data: {
        coreKeyword,
        desiredCount: count,
        recommendations,
        groups: result,
      },
    });
  } catch (error) {
    console.error("关键词推荐 API 处理错误:", error);
    return NextResponse.json({ error: "服务器内部错误" }, { status: 500 });
  }
}

// 处理 GET 请求
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const coreKeyword = searchParams.get("keyword");
    const desiredCount = Number(searchParams.get("count")) || 5;

    if (!coreKeyword) {
      return NextResponse.json(
        {
          error:
            "缺少必要参数。请使用格式：/api/report/keyword-recommendation?keyword=智能座舱&count=5",
        },
        { status: 400 },
      );
    }

    const result = await generateKeywords({
      coreKeyword,
      desiredCount,
    });

    const recommendations = Object.values(result).flat();
    return NextResponse.json({
      success: true,
      data: {
        coreKeyword,
        desiredCount,
        recommendations,
        groups: result,
      },
    });
  } catch (error) {
    console.error("关键词推荐 API 处理错误:", error);
    return NextResponse.json({ error: "服务器内部错误" }, { status: 500 });
  }
}
