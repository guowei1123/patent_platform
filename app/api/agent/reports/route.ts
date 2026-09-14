import { z } from "zod";
import {
  DisclosureParseInputError,
  parseDisclosureFile,
} from "@/app/api/report/disclosure-parse/service";
import { getAnonymousResourceId } from "@/src/mastra/anonymous-session";
import {
  createConversation,
  titleFromMessage,
} from "@/src/mastra/conversation-service";
import { startReportWorkflow } from "@/src/mastra/report/runtime";
import {
  createReportTask,
  getReportTaskByConversation,
} from "@/src/mastra/report/task-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const conversationId = new URL(request.url).searchParams.get(
    "conversationId",
  );
  if (!conversationId || !z.string().uuid().safeParse(conversationId).success)
    return Response.json({ error: "对话编号不正确" }, { status: 400 });
  const report = await getReportTaskByConversation(
    await getAnonymousResourceId(),
    conversationId,
  );
  if (!report)
    return Response.json({ error: "报告任务不存在或已过期" }, { status: 404 });
  return Response.json({ report });
}

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const file = formData.get("file");
    if (!(file instanceof File)) {
      return Response.json({ error: "请上传专利交底书文件" }, { status: 400 });
    }
    const resourceId = await getAnonymousResourceId();
    const disclosure = await parseDisclosureFile({
      fileName: file.name,
      buffer: Buffer.from(await file.arrayBuffer()),
    });
    if (
      [disclosure.technicalSolution, ...disclosure.keyTechnicalFeatures]
        .join("")
        .trim().length < 20
    ) {
      return Response.json(
        { error: "交底书缺少足够的技术方案或关键技术特征，无法进行文献比对" },
        { status: 422 },
      );
    }
    const title = titleFromMessage(
      disclosure.inventionName || file.name.replace(/\.docx$/i, ""),
    );
    const conversation = await createConversation(resourceId, "report", title);
    const task = await createReportTask(resourceId, conversation.id);
    const report = await startReportWorkflow({ task, resourceId, disclosure });
    return Response.json({ conversation, report }, { status: 201 });
  } catch (error) {
    if (error instanceof DisclosureParseInputError) {
      return Response.json({ error: error.message }, { status: error.status });
    }
    if (error instanceof z.ZodError || error instanceof SyntaxError) {
      return Response.json(
        { error: "交底书或模型返回的数据格式不正确" },
        { status: 400 },
      );
    }
    console.error("Create report task failed", error);
    return Response.json(
      { error: "创建专利检索报告任务失败" },
      { status: 500 },
    );
  }
}
