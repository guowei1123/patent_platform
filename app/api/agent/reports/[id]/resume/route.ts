import { z } from "zod";
import { getAnonymousResourceId } from "@/src/mastra/anonymous-session";
import { reportApprovalSchema } from "@/src/mastra/report/contracts";
import { resumeReportWorkflow } from "@/src/mastra/report/runtime";
import {
  claimReportApproval,
  getReportTask,
} from "@/src/mastra/report/task-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const stepByKind = {
  strategy: "confirm-report-strategy",
  "document-selection": "select-report-documents",
  "classification-review": "review-report-classifications",
  "evaluation-input": "collect-report-evaluation-input",
  "final-report": "confirm-final-report",
} as const;

const requestSchema = reportApprovalSchema.extend({
  kind: z.enum([
    "strategy",
    "document-selection",
    "classification-review",
    "evaluation-input",
    "final-report",
  ]),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const input = requestSchema.parse(await request.json());
    const resourceId = await getAnonymousResourceId();
    const task = await getReportTask(resourceId, (await params).id);
    if (!task || task.status !== "awaiting_approval" || !task.pendingApproval)
      return Response.json({ error: "没有待处理的报告确认" }, { status: 404 });
    if (task.pendingApproval.kind !== input.kind)
      return Response.json(
        { error: "确认步骤与当前报告状态不匹配" },
        { status: 409 },
      );
    const claimedTask = await claimReportApproval(
      resourceId,
      task.id,
      input.kind,
    );
    if (!claimedTask)
      return Response.json(
        { error: "该确认已处理，请刷新报告状态" },
        { status: 409 },
      );
    const report = await resumeReportWorkflow({
      task: claimedTask,
      resourceId,
      step: stepByKind[input.kind],
      resumeData: { decision: input.decision, data: input.data },
    });
    return Response.json({ report });
  } catch (error) {
    if (error instanceof z.ZodError || error instanceof SyntaxError)
      return Response.json({ error: "报告确认参数不正确" }, { status: 400 });
    console.error("Resume report workflow failed", error);
    return Response.json({ error: "报告工作流恢复失败" }, { status: 500 });
  }
}
