import { NextRequest, NextResponse } from "next/server";
import { searchPatents, type PatentSortBy } from "./service";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      keywords,
      ipcCodes,
      applicant,
      dateFrom,
      dateTo,
      kind,
      sortBy,
      limit,
      offset,
    } = body;

    // 至少要有一个过滤条件
    const kw = Array.isArray(keywords) ? keywords.filter(Boolean) : [];
    const ipc = Array.isArray(ipcCodes) ? ipcCodes.filter(Boolean) : [];
    const hasApplicant = typeof applicant === "string" && applicant.trim();
    const hasDateFrom = typeof dateFrom === "string" && dateFrom.trim();
    const hasDateTo = typeof dateTo === "string" && dateTo.trim();
    const hasKind = typeof kind === "string" && kind.trim();

    if (
      kw.length === 0 &&
      ipc.length === 0 &&
      !hasApplicant &&
      !hasDateFrom &&
      !hasDateTo &&
      !hasKind
    ) {
      return NextResponse.json(
        {
          error: "至少需要提供 keywords / ipcCodes / applicant / dateFrom / dateTo / kind 中的一个过滤条件",
        },
        { status: 400 },
      );
    }

    const validSortBy: PatentSortBy[] = [
      "pub_date_desc",
      "pub_date_asc",
      "relevance",
    ];
    const finalSortBy: PatentSortBy = validSortBy.includes(sortBy)
      ? (sortBy as PatentSortBy)
      : "pub_date_desc";

    const finalLimit =
      typeof limit === "number" && limit > 0 && limit <= 100
        ? Math.floor(limit)
        : 20;
    const finalOffset =
      typeof offset === "number" && offset >= 0
        ? Math.floor(offset)
        : 0;

    const result = await searchPatents({
      keywords: kw,
      ipcCodes: ipc,
      applicant: hasApplicant ? applicant.trim() : undefined,
      dateFrom: hasDateFrom ? dateFrom.trim() : undefined,
      dateTo: hasDateTo ? dateTo.trim() : undefined,
      kind: hasKind ? kind.trim() : undefined,
      sortBy: finalSortBy,
      limit: finalLimit,
      offset: finalOffset,
    });

    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    console.error("专利检索 API 处理错误:", error);
    return NextResponse.json(
      { error: "专利检索失败" },
      { status: 500 },
    );
  }
}

export async function GET(request: NextRequest) {
  try {
    const sp = request.nextUrl.searchParams;
    const keywords = sp.get("keywords");
    const ipcCodes = sp.get("ipcCodes");
    const applicant = sp.get("applicant");
    const dateFrom = sp.get("dateFrom");
    const dateTo = sp.get("dateTo");
    const kind = sp.get("kind");
    const sortBy = sp.get("sortBy");
    const limit = sp.get("limit");
    const offset = sp.get("offset");

    const kw = keywords
      ? keywords.split(/[，、,\n\r]/).map((s) => s.trim()).filter(Boolean)
      : [];
    const ipc = ipcCodes
      ? ipcCodes.split(/[，、,\n\r]/).map((s) => s.trim()).filter(Boolean)
      : [];

    if (
      kw.length === 0 &&
      ipc.length === 0 &&
      !applicant &&
      !dateFrom &&
      !dateTo &&
      !kind
    ) {
      return NextResponse.json(
        {
          error:
            "至少需要提供 keywords / ipcCodes / applicant / dateFrom / dateTo / kind 中的一个过滤条件",
        },
        { status: 400 },
      );
    }

    const validSortBy: PatentSortBy[] = [
      "pub_date_desc",
      "pub_date_asc",
      "relevance",
    ];
    const finalSortBy: PatentSortBy = (
      validSortBy as readonly string[]
    ).includes(sortBy || "")
      ? (sortBy as PatentSortBy)
      : "pub_date_desc";

    const finalLimit =
      limit && !isNaN(+limit) && +limit > 0 && +limit <= 100
        ? Math.floor(+limit)
        : 20;
    const finalOffset =
      offset && !isNaN(+offset) && +offset >= 0 ? Math.floor(+offset) : 0;

    const result = await searchPatents({
      keywords: kw,
      ipcCodes: ipc,
      applicant: applicant || undefined,
      dateFrom: dateFrom || undefined,
      dateTo: dateTo || undefined,
      kind: kind || undefined,
      sortBy: finalSortBy,
      limit: finalLimit,
      offset: finalOffset,
    });

    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    console.error("专利检索 API 处理错误:", error);
    return NextResponse.json(
      { error: "专利检索失败" },
      { status: 500 },
    );
  }
}
