import { z } from "zod";
import { generateReportDocumentFromTemplate } from "@/app/api/report/template-export/service";
import { getAnonymousResourceId } from "@/src/mastra/anonymous-session";
import { reportWorkflowContextSchema } from "@/src/mastra/report/contracts";
import { getReportTask } from "@/src/mastra/report/task-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const resourceId = await getAnonymousResourceId();
    const task = await getReportTask(resourceId, (await params).id);
    if (!task)
      return Response.json(
        { error: "报告任务不存在或已过期" },
        { status: 404 },
      );
    if (task.status !== "completed" || !task.state)
      return Response.json(
        { error: "报告尚未完成最终确认，暂不可导出" },
        { status: 409 },
      );

    const state = reportWorkflowContextSchema.parse(task.state);
    if (!state.generatedFormula || !state.evaluation || !state.conclusion)
      return Response.json({ error: "报告数据不完整" }, { status: 422 });

    const searchResults = (state.classifications || [])
      .filter(({ classification }) =>
        ["X", "Y", "A"].includes(classification.category),
      )
      .map(({ patent, classification }) => ({
        id: patent.id,
        title: patent.title,
        applicant: patent.applicant,
        publicationNumber: patent.docNumber,
        publicationDate: patent.pubDate,
        relevance: 0,
        similarities: classification.featureMappings
          .filter((item) => item.assessment !== "未披露")
          .map(
            (item) =>
              `${item.targetFeature}：${item.referenceDisclosure || item.assessment}`,
          )
          .join("；"),
        differences: classification.featureMappings
          .filter((item) => item.assessment === "未披露")
          .map((item) => item.targetFeature)
          .join("；"),
        category: classification.category as "X" | "Y" | "A",
      }));
    const proposalName = state.disclosure.inventionName || "专利检索报告";
    const buffer = await generateReportDocumentFromTemplate({
      proposalName,
      ipcList: state.strategy?.ipcCodes.map((code) => ({ code })) || [],
      generatedFormula: state.generatedFormula,
      searchResults,
      standardAdaptation:
        state.evaluationInput?.isStandardEssentialPatent || false,
      vehicleApplication: state.evaluationInput?.isUsedOnProduct || false,
      usageProspect: state.evaluation.usageProspect,
      authorizationProspect: state.evaluation.authorizationProspect,
      proposalGrade: state.evaluation.proposalGrade,
      conclusion: state.conclusion,
    });
    const encodedFilename = encodeURIComponent(`${proposalName}.docx`);
    return new Response(new Uint8Array(buffer), {
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "Content-Disposition": `attachment; filename*=UTF-8''${encodedFilename}`,
      },
    });
  } catch (error) {
    if (error instanceof z.ZodError)
      return Response.json({ error: "报告数据格式不正确" }, { status: 422 });
    console.error("Export agent report failed", error);
    return Response.json({ error: "报告导出失败" }, { status: 500 });
  }
}
