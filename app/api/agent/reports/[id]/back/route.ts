import { z } from "zod";
import { getAnonymousResourceId } from "@/src/mastra/anonymous-session";
import { reportWorkflowContextSchema } from "@/src/mastra/report/contracts";
import { restartReportWorkflow } from "@/src/mastra/report/runtime";
import { getReportTask } from "@/src/mastra/report/task-service";

export const runtime = "nodejs";

const requestSchema = z.object({
  kind: z.enum([
    "document-selection",
    "classification-review",
    "evaluation-input",
    "final-report",
  ]),
});

const previous = {
  "document-selection": "strategy",
  "classification-review": "document-selection",
  "evaluation-input": "classification-review",
  "final-report": "evaluation-input",
} as const;

function rewind(
  state: z.infer<typeof reportWorkflowContextSchema>,
  target: (typeof previous)[keyof typeof previous],
) {
  const base = { ...state, status: "active" as const, returnTo: target };
  if (target === "strategy") {
    const {
      retrievalPlan,
      retrievalRounds,
      searchResult,
      candidateScreening,
      selectedPatentIds,
      classifications,
      evaluationInput,
      evaluation,
      conclusion,
      ...rest
    } = base;
    return rest;
  }
  if (target === "document-selection") {
    const { classifications, evaluationInput, evaluation, conclusion, ...rest } = base;
    return rest;
  }
  if (target === "classification-review") {
    const { evaluationInput, evaluation, conclusion, ...rest } = base;
    return rest;
  }
  const { evaluation, conclusion, ...rest } = base;
  return rest;
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { kind } = requestSchema.parse(await request.json());
    const resourceId = await getAnonymousResourceId();
    const task = await getReportTask(resourceId, (await context.params).id);
    if (!task || task.status !== "awaiting_approval" || !task.pendingApproval)
      return Response.json({ error: "当前没有可返回的确认步骤" }, { status: 409 });
    if (task.pendingApproval.kind !== kind)
      return Response.json({ error: "返回步骤与当前报告状态不一致" }, { status: 409 });
    if (!task.state)
      return Response.json({ error: "报告状态不完整，无法返回上一步" }, { status: 422 });
    const report = await restartReportWorkflow({
      task,
      resourceId,
      state: rewind(reportWorkflowContextSchema.parse(task.state), previous[kind]),
    });
    return Response.json({ report });
  } catch (error) {
    if (error instanceof z.ZodError || error instanceof SyntaxError)
      return Response.json({ error: "返回上一步参数不正确" }, { status: 400 });
    console.error("Return report workflow failed", error);
    return Response.json({ error: "返回上一步失败" }, { status: 500 });
  }
}
