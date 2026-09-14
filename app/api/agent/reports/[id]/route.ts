import { getAnonymousResourceId } from "@/src/mastra/anonymous-session";
import { getReportTask } from "@/src/mastra/report/task-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const resourceId = await getAnonymousResourceId();
  const task = await getReportTask(resourceId, (await params).id);
  if (!task)
    return Response.json({ error: "报告任务不存在或已过期" }, { status: 404 });
  return Response.json({ report: task });
}
