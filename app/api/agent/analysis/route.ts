import { z } from "zod";
import { getAnonymousResourceId } from "@/src/mastra/anonymous-session";
import {
  createConversation,
  updateConversation,
} from "@/src/mastra/conversation-service";
import {
  patentAnalysisSummarySchema,
  patentParseResultSchema,
} from "@/app/api/patent/parse/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const analysisSchema = z.object({
  title: z.string().trim().min(1).max(80),
  analyses: z
    .array(
      z.object({
        fileName: z.string().trim().min(1).max(240),
        result: patentParseResultSchema,
        meta: z.object({
          inputTextLength: z.number().int().nonnegative(),
          analyzedTextLength: z.number().int().nonnegative(),
          truncated: z.boolean(),
          includedSections: z.array(z.string()),
          figureCount: z.number().int().nonnegative().optional(),
        }),
      }),
    )
    .min(1)
    .max(10),
  summary: patentAnalysisSummarySchema.optional(),
});

export async function POST(request: Request) {
  try {
    const input = analysisSchema.parse(await request.json());
    const resourceId = await getAnonymousResourceId();
    const conversation = await createConversation(
      resourceId,
      "analysis",
      input.title,
    );
    const updated = await updateConversation(resourceId, conversation.id, {
      status: "completed",
      lastMessagePreview: `已解析 ${input.analyses.length} 份文件`,
      searchResults: {
        analyses: input.analyses,
        ...(input.summary ? { summary: input.summary } : {}),
      },
    });
    return Response.json(updated || conversation, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError || error instanceof SyntaxError)
      return Response.json({ error: "解析历史参数不正确" }, { status: 400 });
    console.error("Analysis history save failed", error);
    return Response.json({ error: "保存解析历史失败" }, { status: 500 });
  }
}
