import type { ParsedDisclosure } from "@/app/api/report/disclosure-parse/service";
import { mastra } from "../index";
import {
  reportSuspendPayloadSchema,
  reportWorkflowContextSchema,
  type ReportWorkflowContext,
} from "./contracts";
import {
  restartReportTask,
  type ReportTaskRecord,
  updateReportTask,
} from "./task-service";

function getStepRecords(result: any) {
  return Object.values(result?.stepResults || result?.steps || {}) as Array<
    Record<string, unknown>
  >;
}

function extractContext(result: any): ReportWorkflowContext | undefined {
  const candidates: unknown[] = [];
  if (result?.result) candidates.push(result.result);
  for (const record of getStepRecords(result).reverse()) {
    candidates.push(record.output, record.payload);
  }
  for (const candidate of candidates) {
    const parsed = reportWorkflowContextSchema.safeParse(candidate);
    if (parsed.success) return parsed.data;
  }
  return undefined;
}

function extractErrorMessage(result: any) {
  const candidates: unknown[] = [result?.error];
  for (const record of getStepRecords(result).reverse())
    candidates.push(record.error);
  for (const candidate of candidates) {
    if (candidate instanceof Error && candidate.message)
      return candidate.message;
    if (candidate && typeof candidate === "object") {
      const message = (candidate as Record<string, unknown>).message;
      if (typeof message === "string" && message.trim()) return message.trim();
    }
    if (typeof candidate === "string" && candidate.trim())
      return candidate.trim();
  }
  return "报告工作流执行失败";
}

function extractSuspendPayload(result: any) {
  const candidates: unknown[] = [result?.suspendPayload];
  for (const record of getStepRecords(result)) {
    candidates.push(record.suspendPayload);
  }
  for (const candidate of candidates) {
    const parsed = reportSuspendPayloadSchema.safeParse(candidate);
    if (parsed.success) return parsed.data;
  }
  throw new Error("工作流已暂停，但未取得有效的人工确认数据");
}

async function persistResult(
  task: ReportTaskRecord,
  resourceId: string,
  result: any,
) {
  const state = extractContext(result) || task.state || undefined;
  if (result.status === "suspended") {
    const pendingApproval = extractSuspendPayload(result);
    return updateReportTask(resourceId, task.id, {
      status: "awaiting_approval",
      currentStage: pendingApproval.kind,
      state,
      pendingApproval,
      errorMessage: null,
    });
  }
  if (result.status === "success") {
    return updateReportTask(resourceId, task.id, {
      status: state?.status || "completed",
      currentStage: state?.status === "cancelled" ? "cancelled" : "completed",
      state,
      pendingApproval: null,
      errorMessage: null,
    });
  }
  return updateReportTask(resourceId, task.id, {
    status: "failed",
    currentStage: "failed",
    state,
    pendingApproval: null,
    errorMessage: extractErrorMessage(result),
  });
}

export async function startReportWorkflow(input: {
  task: ReportTaskRecord;
  resourceId: string;
  disclosure: ParsedDisclosure;
}) {
  const initialState = reportWorkflowContextSchema.parse({
    reportId: input.task.id,
    status: "active",
    disclosure: input.disclosure,
  });
  const initializedTask =
    (await updateReportTask(input.resourceId, input.task.id, {
      status: "active",
      currentStage: "prepare-report-strategy",
      state: initialState,
      pendingApproval: null,
      errorMessage: null,
    })) || input.task;
  try {
    const workflow = mastra.getWorkflow("reportWorkflow");
    const run = await workflow.createRun({
      runId: input.task.workflowRunId,
      resourceId: input.resourceId,
    });
    const result = await run.start({
      inputData: initialState,
    });
    return persistResult(initializedTask, input.resourceId, result);
  } catch (error) {
    await updateReportTask(input.resourceId, input.task.id, {
      status: "failed",
      currentStage: "failed",
      state: initialState,
      pendingApproval: null,
      errorMessage:
        error instanceof Error ? error.message : "报告工作流启动失败",
    });
    throw error;
  }
}

export async function resumeReportWorkflow(input: {
  task: ReportTaskRecord;
  resourceId: string;
  step: string;
  resumeData: unknown;
}) {
  try {
    const workflow = mastra.getWorkflow("reportWorkflow");
    const run = await workflow.createRun({
      runId: input.task.workflowRunId,
      resourceId: input.resourceId,
    });
    const result = await run.resume({
      step: input.step,
      resumeData: input.resumeData,
    });
    return persistResult(input.task, input.resourceId, result);
  } catch (error) {
    await updateReportTask(input.resourceId, input.task.id, {
      status: "failed",
      currentStage: "failed",
      state: input.task.state,
      pendingApproval: null,
      errorMessage:
        error instanceof Error ? error.message : "报告工作流恢复失败",
    });
    throw error;
  }
}

export async function restartReportWorkflow(input: {
  task: ReportTaskRecord;
  resourceId: string;
  state: ReportWorkflowContext;
}) {
  const task = await restartReportTask(
    input.resourceId,
    input.task.id,
    input.state,
  );
  if (!task) throw new Error("报告任务不存在或已过期");
  try {
    const workflow = mastra.getWorkflow("reportWorkflow");
    const run = await workflow.createRun({
      runId: task.workflowRunId,
      resourceId: input.resourceId,
    });
    return persistResult(
      task,
      input.resourceId,
      await run.start({ inputData: input.state }),
    );
  } catch (error) {
    await updateReportTask(input.resourceId, task.id, {
      status: "failed",
      currentStage: "failed",
      state: input.state,
      pendingApproval: null,
      errorMessage:
        error instanceof Error ? error.message : "报告工作流重新启动失败",
    });
    throw error;
  }
}
