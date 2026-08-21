import { z } from "zod";

import { mastra } from "@/src/mastra";
import { resolveAgentResource } from "@/src/mastra/session";
import type { DisclosureDraft } from "@/src/mastra/workflows/disclosure";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const runIdSchema = z.string().uuid();
const requestSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("start"),
    draft: z.unknown(),
  }),
  z.object({
    action: z.literal("resume"),
    runId: runIdSchema,
    stepId: z.enum([
      "prepare-background",
      "analyze-technical-solution",
      "generate-benefits-and-protection",
      "review-and-approve",
    ]),
    draft: z.unknown(),
    approved: z.boolean().optional(),
  }),
]);

function responseHeaders(setCookie?: string) {
  const headers = new Headers({
    "Cache-Control": "no-cache, no-store, must-revalidate",
    "X-Content-Type-Options": "nosniff",
  });
  if (setCookie) headers.set("Set-Cookie", setCookie);
  return headers;
}

function serializeResult(runId: string, result: Record<string, any>) {
  if (result.status === "failed") {
    throw new Error(result.error?.message || "交底书流程执行失败");
  }
  if (result.status === "suspended") {
    const suspendedStep = Array.isArray(result.suspended?.[0])
      ? result.suspended[0].at(-1)
      : undefined;
    const stepResult = suspendedStep
      ? result.steps?.[suspendedStep]
      : undefined;
    const suspendPayload =
      result.suspendPayload || stepResult?.suspendPayload;
    const stepById: Record<string, number> = {
      "prepare-background": 2,
      "analyze-technical-solution": 3,
      "generate-benefits-and-protection": 4,
      "review-and-approve": 5,
    };
    return {
      runId,
      status: result.status,
      step: suspendPayload?.step || (suspendedStep && stepById[suspendedStep]),
      draft:
        suspendPayload?.draft || stepResult?.payload || result.input,
      suspendedStep,
    };
  }
  return {
    runId,
    status: result.status,
    step: result.status === "success" ? 5 : undefined,
    draft:
      result.status === "success" ? result.result?.draft : result.result,
    document:
      result.status === "success" ? result.result?.document : undefined,
  };
}

function serializeStoredRun(state: Record<string, any>) {
  const suspendedEntry = Object.entries(state.steps || {}).find(
    ([, value]) =>
      !Array.isArray(value) &&
      value &&
      typeof value === "object" &&
      (value as Record<string, unknown>).status === "suspended",
  );
  const suspendedStep = suspendedEntry?.[0];
  const suspendedValue = suspendedEntry?.[1] as
    | Record<string, any>
    | undefined;
  return {
    runId: state.runId,
    status: state.status,
    step:
      suspendedValue?.suspendPayload?.step ||
      (state.status === "success" ? 5 : undefined),
    draft:
      suspendedValue?.suspendPayload?.draft ||
      (state.status === "success" ? state.result?.draft : state.result),
    document:
      state.status === "success" ? state.result?.document : undefined,
    suspendedStep,
  };
}

export async function GET(request: Request) {
  try {
    const runId = runIdSchema.parse(
      new URL(request.url).searchParams.get("runId"),
    );
    const { resourceId, setCookie } = resolveAgentResource(request);
    const workflow = mastra.getWorkflow("disclosureWorkflow");
    const state = await workflow.getWorkflowRunById(runId);

    if (!state || state.resourceId !== resourceId) {
      return Response.json(
        { error: "交底书流程不存在" },
        { status: 404, headers: responseHeaders(setCookie) },
      );
    }
    return Response.json(serializeStoredRun(state), {
      headers: responseHeaders(setCookie),
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return Response.json({ error: "流程编号不正确" }, { status: 400 });
    }
    console.error("Disclosure workflow state request failed", error);
    return Response.json({ error: "交底书流程加载失败" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = requestSchema.parse(await request.json());
    const { resourceId, setCookie } = resolveAgentResource(request);
    const workflow = mastra.getWorkflow("disclosureWorkflow");

    if (body.action === "start") {
      const run = await workflow.createRun({ resourceId });
      const result = await run.start({
        inputData: body.draft as DisclosureDraft,
      });
      return Response.json(serializeResult(run.runId, result), {
        headers: responseHeaders(setCookie),
      });
    }

    const state = await workflow.getWorkflowRunById(body.runId);
    if (!state || state.resourceId !== resourceId) {
      return Response.json(
        { error: "交底书流程不存在" },
        { status: 404, headers: responseHeaders(setCookie) },
      );
    }
    if (state.status !== "suspended") {
      return Response.json(
        { error: "交底书流程当前不可继续" },
        { status: 409, headers: responseHeaders(setCookie) },
      );
    }

    const run = await workflow.createRun({
      runId: body.runId,
      resourceId,
    });
    const resumeData =
      body.stepId === "review-and-approve"
        ? { approved: body.approved === true, draft: body.draft }
        : { draft: body.draft };
    const result = await run.resume({
      step: body.stepId,
      resumeData,
    });
    return Response.json(serializeResult(run.runId, result), {
      headers: responseHeaders(setCookie),
    });
  } catch (error) {
    if (error instanceof z.ZodError || error instanceof SyntaxError) {
      return Response.json({ error: "交底书流程参数不正确" }, { status: 400 });
    }
    console.error("Disclosure workflow request failed", error);
    return Response.json(
      {
        error:
          error instanceof Error ? error.message : "交底书流程执行失败",
      },
      { status: 500 },
    );
  }
}
