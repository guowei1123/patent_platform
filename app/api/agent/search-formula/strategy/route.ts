import { z } from "zod";
import { getAnonymousResourceId } from "@/src/mastra/anonymous-session";
import { mastra } from "@/src/mastra";
import {
  searchFormulaWorkflowInputSchema,
  searchFormulaWorkflowOutputSchema,
} from "@/src/mastra/search-formula/contracts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let input: z.infer<typeof searchFormulaWorkflowInputSchema>;
  try {
    input = searchFormulaWorkflowInputSchema.parse(await request.json());
  } catch (error) {
    if (error instanceof z.ZodError) {
      console.warn("Invalid search formula strategy input", error.issues);
      return Response.json({ error: "检索策略参数不正确" }, { status: 400 });
    }
    if (error instanceof SyntaxError)
      return Response.json({ error: "检索策略参数不正确" }, { status: 400 });
    return Response.json({ error: "检索策略请求无效" }, { status: 400 });
  }
  try {
    const run = await mastra.getWorkflow("searchFormulaWorkflow").createRun({
      resourceId: await getAnonymousResourceId(),
    });
    const result = await run.start({ inputData: input });
    if (result.status !== "success")
      throw new Error("智能体未能完成检索策略生成");
    return Response.json(
      searchFormulaWorkflowOutputSchema.parse(result.result),
    );
  } catch (error) {
    console.error("Search formula workflow failed", error);
    return Response.json(
      { error: "智能体生成检索策略失败，请稍后重试" },
      { status: 500 },
    );
  }
}
