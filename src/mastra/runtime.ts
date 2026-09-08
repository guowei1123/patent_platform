import type { Agent } from "@mastra/core/agent";
import type { MastraModelOutput } from "@mastra/core/stream";
import { hasToolCall } from "ai";
import { prepareQaContext } from "../../lib/rag/qa";
import type { RagHistory, RagResult } from "../../lib/rag/types";
import type { AgentEvent, AgentMode, SearchStrategy } from "./contracts";
import { searchResumeSchema, searchStrategySchema } from "./contracts";
import { mastra } from "./index";
import {
  updateConversation,
  getConversationMessages,
  saveQaSources,
  type ConversationRecord,
} from "./conversation-service";

const encoder = new TextEncoder();

function encode(event: AgentEvent) {
  return encoder.encode(`data: ${JSON.stringify(event)}\n\n`);
}

function labelForTool(tool: string) {
  return (
    {
      recommendKeywordsTool: "生成检索关键词",
      recommendIpcTool: "推荐IPC分类号",
      generateSearchFormulaTool: "生成检索式",
      searchPatentsTool: "准备专利检索",
    }[tool] || "调用专业工具"
  );
}

function chooseAgent(
  mode: AgentMode,
  message: string,
): { agent: Agent; type: "qa" | "search" } {
  if (
    mode === "search" ||
    (mode === "auto" &&
      /(检索|专利库|ipc|分类号|申请人|公开号|查专利)/i.test(message))
  )
    return { agent: mastra.getAgent("searchAgent"), type: "search" };
  return { agent: mastra.getAgent("qaAgent"), type: "qa" };
}

async function forwardOutput(
  output: MastraModelOutput,
  conversation: ConversationRecord,
  resourceId: string,
  send: (event: AgentEvent) => void,
  options: { searchMode: boolean },
) {
  let suspended = false;
  let searchExecuted = false;
  for await (const chunk of output.fullStream as AsyncIterable<any>) {
    // 检索工具执行前的自然语言文本不作为检索事实展示，避免模型编造结果。
    if (chunk.type === "text-delta" && !options.searchMode)
      send({ type: "text-delta", content: chunk.payload.text });
    if (chunk.type === "tool-call") {
      send({
        type: "tool-start",
        tool: chunk.payload.toolName,
        label: labelForTool(chunk.payload.toolName),
      });
    }
    if (
      chunk.type === "tool-call-approval" &&
      chunk.payload.toolName === "searchPatentsTool"
    ) {
      suspended = true;
      const strategy = searchStrategySchema.parse(chunk.payload.args);
      await updateConversation(resourceId, conversation.id, {
        status: "awaiting_approval",
        activeRunId: output.runId,
        pendingApproval: {
          runId: output.runId,
          toolCallId: chunk.payload.toolCallId,
          strategy,
        },
      });
      send({
        type: "approval-required",
        runId: output.runId,
        toolCallId: chunk.payload.toolCallId,
        strategy,
      });
    }
    if (chunk.type === "tool-result") {
      send({
        type: "tool-result",
        tool: chunk.payload.toolName,
        summary: chunk.payload.isError ? "工具执行失败" : "工具执行完成",
      });
      if (
        chunk.payload.toolName === "searchPatentsTool" &&
        !chunk.payload.isError
      ) {
        searchExecuted = !chunk.payload.result?.cancelled;
        if (chunk.payload.result?.items) {
          await updateConversation(resourceId, conversation.id, {
            searchResults: chunk.payload.result,
          });
          send({ type: "search-results", data: chunk.payload.result });
        }
      }
    }
    if (
      chunk.type === "tool-call-suspended" &&
      chunk.payload.toolName === "searchPatentsTool"
    ) {
      suspended = true;
      const strategy = chunk.payload.suspendPayload as SearchStrategy;
      await updateConversation(resourceId, conversation.id, {
        status: "awaiting_approval",
        activeRunId: output.runId,
        pendingApproval: {
          runId: output.runId,
          toolCallId: chunk.payload.toolCallId,
          strategy,
        },
      });
      send({
        type: "approval-required",
        runId: output.runId,
        toolCallId: chunk.payload.toolCallId,
        strategy,
      });
    }
    if (chunk.type === "error") throw new Error("智能体执行失败，请稍后重试。");
  }
  return { suspended, searchExecuted };
}

export function createAgentResponse(input: {
  conversation: ConversationRecord;
  resourceId: string;
  message?: string;
  mode: AgentMode;
  resume?: unknown;
}) {
  const { agent, type } = chooseAgent(input.mode, input.message || "");
  const searchAgent = mastra.getAgent("searchAgent");
  return new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: AgentEvent) => controller.enqueue(encode(event));
      try {
        send({
          type: "conversation",
          conversationId: input.conversation.id,
          title: input.conversation.title,
        });
        if (!input.resume)
          send({
            type: "plan",
            steps:
              type === "search"
                ? [
                    { id: "strategy", title: "制定检索策略" },
                    { id: "approval", title: "等待策略确认" },
                    { id: "search", title: "执行专利检索" },
                  ]
                : [
                    { id: "retrieval", title: "检索问答知识库" },
                    { id: "qa", title: "结合资料回答" },
                  ],
          });
        const memory = {
          thread: input.conversation.id,
          resource: input.resourceId,
        };
        const resumeData = input.resume
          ? searchResumeSchema.parse(input.resume)
          : undefined;
        const pendingApproval = input.conversation.pendingApproval as {
          toolCallId?: string;
        } | null;
        if (resumeData && !input.conversation.activeRunId) {
          throw new Error("待确认检索缺少运行编号");
        }
        let rag: RagResult | undefined;
        if (type === "qa" && !resumeData) {
          send({
            type: "tool-start",
            tool: "knowledgeRetrieval",
            label: "检索参考资料",
          });
          const recalled = await getConversationMessages(
            input.resourceId,
            input.conversation.id,
          );
          const history: RagHistory = (recalled?.messages || []).flatMap(
            (message) => {
              if (message.role !== "user" && message.role !== "assistant")
                return [];
              const content =
                typeof message.content === "string"
                  ? message.content
                  : message.content.parts
                      ?.filter((part) => part.type === "text")
                      .map((part) => ("text" in part ? part.text : ""))
                      .join("") || "";
              return [{ role: message.role, content }];
            },
          );
          rag = await prepareQaContext(input.message || "", history);
          send({ type: "rag-sources", data: rag });
        }
        const output = resumeData
          ? resumeData.decision === "approve"
            ? await searchAgent.approveToolCall({
                runId: input.conversation.activeRunId!,
                toolCallId: pendingApproval?.toolCallId,
                memory,
                // 一次用户确认只授权一次数据库检索，执行完成后结束本轮。
                stopWhen: hasToolCall("searchPatentsTool"),
              })
            : await searchAgent.declineToolCall({
                runId: input.conversation.activeRunId!,
                toolCallId: pendingApproval?.toolCallId,
                reason: "用户取消了本次专利检索",
                memory,
              })
          : await agent.stream(input.message || "", {
              memory,
              ...(rag
                ? {
                    context: [
                      { role: "system" as const, content: rag.context },
                    ],
                  }
                : {}),
              maxSteps: Number(process.env.AGENT_MAX_STEPS || 12),
            });
        let { suspended, searchExecuted } = await forwardOutput(
          output,
          input.conversation,
          input.resourceId,
          send,
          { searchMode: type === "search" },
        );
        if (rag)
          await saveQaSources(
            input.resourceId,
            input.conversation.id,
            output.messageId,
            rag,
          );
        if (type === "search" && !resumeData && !suspended) {
          const correctiveOutput = await searchAgent.stream(
            "继续完成当前专利检索任务。请根据用户原始需求和已经获得的辅助信息，生成完整检索策略并提交用户确认。",
            {
              memory,
              maxSteps: 2,
              toolChoice: {
                type: "tool",
                toolName: "searchPatentsTool",
              },
            },
          );
          const correctiveResult = await forwardOutput(
            correctiveOutput,
            input.conversation,
            input.resourceId,
            send,
            { searchMode: true },
          );
          suspended = correctiveResult.suspended;
          searchExecuted = correctiveResult.searchExecuted;
        }
        const resumeDecision = input.resume
          ? searchResumeSchema.parse(input.resume).decision
          : undefined;
        if (
          (type === "search" && !input.resume && !suspended) ||
          (resumeDecision === "approve" && !searchExecuted)
        ) {
          await updateConversation(input.resourceId, input.conversation.id, {
            status: "failed",
            activeRunId: null,
            pendingApproval: null,
          });
          send({
            type: "error",
            code: "search_tool_not_executed",
            message:
              "本次未完成本地专利库检索，系统不会展示模型生成的非验证结果。请重新发起检索。",
            retryable: true,
          });
          return;
        }
        const currentStatus =
          resumeDecision === "cancel" ? "cancelled" : "completed";
        if (!suspended) {
          await updateConversation(input.resourceId, input.conversation.id, {
            status: currentStatus,
            activeRunId: null,
            pendingApproval: null,
            lastMessagePreview: input.message?.slice(0, 160),
          });
        }
        send({
          type: "done",
          status: suspended ? "awaiting_approval" : currentStatus,
        });
      } catch (error) {
        console.error("Agent runtime failed", error);
        const errorDetail =
          error instanceof Error ? error.message : "未知运行时错误";
        await updateConversation(input.resourceId, input.conversation.id, {
          status: "failed",
          activeRunId: null,
          pendingApproval: null,
        });
        send({
          type: "error",
          code: "agent_failed",
          message:
            process.env.NODE_ENV === "development"
              ? `智能体调用失败：${errorDetail}`
              : "智能体调用失败，请检查模型或数据服务后重试。",
          retryable: true,
        });
      } finally {
        controller.close();
      }
    },
  });
}

export const agentStreamHeaders = {
  "Content-Type": "text/event-stream; charset=utf-8",
  "Cache-Control": "no-cache, no-transform",
  Connection: "keep-alive",
};
