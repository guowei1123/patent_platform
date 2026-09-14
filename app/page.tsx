"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronUp, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { ChatInput } from "@/components/chat-input";
import { ChatMessage, type Message } from "@/components/chat-message";
import {
  ChatSidebar,
  type SidebarConversation,
} from "@/components/chat-sidebar";
import { Button } from "@/components/ui/button";
import type { RagResult } from "@/lib/rag/types";

type Strategy = {
  topic: string;
  keywords: string[];
  ipcCodes: string[];
  limit: number;
  explanation: string;
};
type Approval = { runId: string; toolCallId: string; strategy: Strategy };
type Patent = {
  id: string;
  kind?: string;
  title: string;
  docNumber?: string;
  applicant?: string;
  pubDate?: string;
  abstract?: string;
  ipcCodes?: string[];
};
type StoredMessage = {
  id?: string;
  role: string;
  content: unknown;
  createdAt?: string;
};

function extractHistoryText(content: unknown): string {
  let value = content;
  if (typeof value === "string") {
    const raw = value;
    try {
      value = JSON.parse(value) as unknown;
    } catch {
      return raw;
    }
  }
  if (!value || typeof value !== "object") return "";
  const record = value as Record<string, unknown>;
  if (Array.isArray(record.parts)) {
    return record.parts
      .filter(
        (part): part is Record<string, unknown> =>
          Boolean(part) &&
          typeof part === "object" &&
          (part as Record<string, unknown>).type === "text",
      )
      .map((part) => (typeof part.text === "string" ? part.text : ""))
      .join("")
      .trim();
  }
  return typeof record.content === "string" ? record.content : "";
}

export function AssistantWorkspace({ mode }: { mode: "qa" | "search" }) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [conversations, setConversations] = useState<SidebarConversation[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [approval, setApproval] = useState<Approval | null>(null);
  const [editingStrategy, setEditingStrategy] = useState(false);
  const [results, setResults] = useState<Patent[]>([]);
  const [expandedPatentIds, setExpandedPatentIds] = useState<Set<string>>(
    new Set(),
  );
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const messageRefs = useRef(new Map<string, HTMLDivElement>());
  const [messageStops, setMessageStops] = useState<
    { id: string; position: number; label: string }[]
  >([]);
  const [activeMessageId, setActiveMessageId] = useState<string | null>(null);

  const updateMessageNavigator = useCallback(() => {
    const container = scrollAreaRef.current;
    if (!container) return;

    const stops = messages.flatMap((message) => {
      const element = messageRefs.current.get(message.id);
      if (!element) return [];
      return [
        {
          id: message.id,
          position: Math.min(
            1,
            Math.max(
              0,
              element.offsetTop / Math.max(container.scrollHeight, 1),
            ),
          ),
          label: message.content.replace(/\s+/g, " ").trim().slice(0, 48),
        },
      ];
    });
    setMessageStops(stops);

    const viewportFocus = container.scrollTop + container.clientHeight * 0.38;
    const closest = stops.reduce<{ id: string; distance: number } | undefined>(
      (current, stop) => {
        const element = messageRefs.current.get(stop.id);
        const distance = Math.abs((element?.offsetTop || 0) - viewportFocus);
        return !current || distance < current.distance
          ? { id: stop.id, distance }
          : current;
      },
      undefined,
    );
    setActiveMessageId(closest?.id || null);
  }, [messages]);

  const loadConversations = async () => {
    const response = await fetch("/api/agent/conversations");
    if (!response.ok) throw new Error("读取历史失败");
    setConversations(
      ((await response.json()) as { items: SidebarConversation[] }).items,
    );
  };

  useEffect(() => {
    loadConversations().catch(() => toast.error("无法读取历史对话"));
  }, [mode]);
  useEffect(() => {
    if (scrollAreaRef.current)
      scrollAreaRef.current.scrollTop = scrollAreaRef.current.scrollHeight;
  }, [messages, isLoading, approval, results]);

  useEffect(() => {
    const container = scrollAreaRef.current;
    if (!container) return;
    let frame = requestAnimationFrame(updateMessageNavigator);
    const handleScroll = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(updateMessageNavigator);
    };
    const observer = new ResizeObserver(handleScroll);
    observer.observe(container);
    container.addEventListener("scroll", handleScroll, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      container.removeEventListener("scroll", handleScroll);
    };
  }, [updateMessageNavigator, approval, results]);

  const setMessageRef = useCallback(
    (id: string, element: HTMLDivElement | null) => {
      if (element) messageRefs.current.set(id, element);
      else messageRefs.current.delete(id);
    },
    [],
  );

  const scrollToMessage = (id: string) => {
    const container = scrollAreaRef.current;
    const element = messageRefs.current.get(id);
    if (!container || !element) return;
    container.scrollTo({
      top: Math.max(0, element.offsetTop - 20),
      behavior: "smooth",
    });
  };

  const consumeStream = async (response: Response) => {
    const reader = response.body?.getReader();
    if (!reader) throw new Error("未获得智能体响应流");
    const decoder = new TextDecoder();
    let buffer = "";
    let assistantId: string | null = null;
    let rag: RagResult | undefined;
    const appendText = (content: string) => {
      if (!assistantId) {
        assistantId = crypto.randomUUID();
        setMessages((current) => [
          ...current,
          {
            id: assistantId!,
            role: "assistant",
            content: "",
            timestamp: new Date(),
            rag,
          },
        ]);
      }
      setMessages((current) =>
        current.map((item) =>
          item.id === assistantId
            ? { ...item, content: item.content + content }
            : item,
        ),
      );
    };
    const clearTransientSearchErrors = () =>
      setMessages((current) =>
        current.filter(
          (item) =>
            !(
              item.role === "assistant" &&
              (item.content.startsWith("检索未完成：") ||
                item.content.startsWith("请求未完成："))
            ),
        ),
      );
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const events = buffer.split("\n\n");
      buffer = events.pop() || "";
      for (const event of events) {
        if (!event.startsWith("data: ")) continue;
        const payload = JSON.parse(event.slice(6)) as {
          type: string;
          [key: string]: unknown;
        };
        if (
          payload.type === "conversation" &&
          typeof payload.conversationId === "string"
        )
          setConversationId(payload.conversationId);
        if (
          payload.type === "text-delta" &&
          typeof payload.content === "string"
        )
          appendText(payload.content);
        if (payload.type === "rag-sources") {
          rag = payload.data as RagResult;
          appendText("");
          setMessages((current) =>
            current.map((item) =>
              item.id === assistantId ? { ...item, rag } : item,
            ),
          );
        }
        if (payload.type === "approval-required") {
          clearTransientSearchErrors();
          setApproval(payload as unknown as Approval);
        }
        if (payload.type === "search-results") {
          clearTransientSearchErrors();
          setResults((payload.data as { items?: Patent[] }).items || []);
        }
        if (payload.type === "error") {
          const message =
            typeof payload.message === "string"
              ? payload.message
              : "智能体执行失败";
          setApproval(null);
          toast.error(message);
          setMessages((current) => [
            ...current,
            {
              id: crypto.randomUUID(),
              role: "assistant",
              content: `请求未完成：${message}`,
              timestamp: new Date(),
            },
          ]);
        }
      }
    }
    await loadConversations();
  };

  const handleSend = async (content: string) => {
    if (isLoading || approval) return;
    setIsLoading(true);
    setResults([]);
    setExpandedPatentIds(new Set());
    setMessages((current) => [
      ...current,
      {
        id: crypto.randomUUID(),
        role: "user",
        content,
        timestamp: new Date(),
        tool: mode === "search" ? "专利检索" : undefined,
      },
    ]);
    try {
      const response = await fetch("/api/agent/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversationId: conversationId || undefined,
          message: content,
          mode,
        }),
      });
      if (!response.ok)
        throw new Error((await response.json()).error || "请求失败");
      await consumeStream(response);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "发送失败，请稍后重试",
      );
    } finally {
      setIsLoading(false);
    }
  };

  const handleApproval = async (
    decision: "approve" | "edit-and-approve" | "cancel",
  ) => {
    if (!approval || !conversationId) return;
    setIsLoading(true);
    try {
      const response = await fetch("/api/agent/approvals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversationId,
          ...approval,
          decision,
          strategy:
            decision === "edit-and-approve" ? approval.strategy : undefined,
        }),
      });
      if (!response.ok)
        throw new Error((await response.json()).error || "确认失败");
      setApproval(null);
      setEditingStrategy(false);
      await consumeStream(response);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "确认失败");
    } finally {
      setIsLoading(false);
    }
  };

  const handleNewChat = () => {
    setConversationId(null);
    setMessages([]);
    setResults([]);
    setApproval(null);
    setEditingStrategy(false);
  };

  const handleDeleteConversation = async (id: string) => {
    try {
      const response = await fetch(`/api/agent/conversations/${id}`, {
        method: "DELETE",
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "删除对话失败");
      if (id === conversationId) handleNewChat();
      await loadConversations();
      toast.success("已删除历史对话");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "删除对话失败");
    }
  };

  const handleSelectConversation = async (id: string) => {
    try {
      const response = await fetch(`/api/agent/conversations/${id}`);
      if (!response.ok) throw new Error("读取对话失败");
      const data = (await response.json()) as {
        conversation: SidebarConversation;
        messages: StoredMessage[];
        ragSources?: Record<string, RagResult>;
        searchResults?: { items?: Patent[] };
      };
      setConversationId(id);
      setApproval(
        (data.conversation.pendingApproval as Approval | null) || null,
      );
      setEditingStrategy(false);
      setResults(
        data.conversation.type === "search"
          ? data.searchResults?.items || []
          : [],
      );
      setMessages(
        data.messages
          .filter((item) => item.role === "user" || item.role === "assistant")
          .map((item, index) => ({
            id: item.id || `${id}-${index}`,
            role: item.role as "user" | "assistant",
            content: extractHistoryText(item.content),
            timestamp: new Date(item.createdAt || Date.now()),
            rag: item.id ? data.ragSources?.[item.id] : undefined,
          }))
          .filter((item) => item.content),
      );
    } catch {
      toast.error("无法打开该对话");
    }
  };

  return (
    <div className="flex h-dvh min-h-0 overflow-hidden bg-background">
      <ChatSidebar
        conversations={conversations}
        activeConversationId={conversationId}
        onNewChat={handleNewChat}
        onSelectConversation={handleSelectConversation}
        onDeleteConversation={handleDeleteConversation}
        mode={mode}
      />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <header className="flex h-14 shrink-0 items-center border-b border-border bg-card px-5 text-sm text-muted-foreground">
          {mode === "qa" ? "通用问答" : "专利检索"} · 历史记录保存 30 天
        </header>
        <main className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <div className="relative h-0 min-h-0 flex-1 overflow-hidden">
            <div
              className="h-full overflow-y-auto overscroll-contain custom-scrollbar"
              ref={scrollAreaRef}
            >
              {messages.length === 0 ? (
                <div className="flex h-full flex-col items-center justify-center px-4 text-center">
                  <h1 className="mb-2 text-3xl font-semibold">
                    {mode === "qa" ? "通用专利问答" : "本地专利检索"}
                  </h1>
                  <p className="max-w-lg text-muted-foreground">
                    {mode === "qa"
                      ? "基于知识库资料回答专利相关问题。"
                      : "生成检索策略后，等待您的确认再查询专利库。"}
                  </p>
                  <div className="mt-8 w-full max-w-3xl">
                    <ChatInput
                      onSend={handleSend}
                      mode={mode}
                      disabled={isLoading || Boolean(approval)}
                    />
                  </div>
                </div>
              ) : (
                <div>
                  {messages.map((message) => (
                    <div
                      key={message.id}
                      ref={(element) => setMessageRef(message.id, element)}
                    >
                      <ChatMessage message={message} />
                    </div>
                  ))}
                </div>
              )}
              {mode === "search" && approval && (
                <section className="mx-auto mb-6 max-w-3xl rounded-xl border border-primary/30 bg-primary/5 p-5">
                  <h2 className="font-semibold">请确认检索策略</h2>
                  <p className="mt-2 text-sm text-muted-foreground">
                    {approval.strategy.explanation || approval.strategy.topic}
                  </p>
                  <div className="mt-3 grid gap-2 text-sm">
                    <label className="grid gap-1">
                      <span className="font-medium">关键词：</span>
                      {editingStrategy ? (
                        <input
                          value={approval.strategy.keywords.join("、")}
                          onChange={(event) =>
                            setApproval((current) =>
                              current
                                ? {
                                    ...current,
                                    strategy: {
                                      ...current.strategy,
                                      keywords: event.target.value
                                        .split(/[、,，]/)
                                        .map((item) => item.trim())
                                        .filter(Boolean),
                                    },
                                  }
                                : current,
                            )
                          }
                          className="rounded border bg-background px-2 py-1"
                        />
                      ) : (
                        <span>{approval.strategy.keywords.join("、")}</span>
                      )}
                    </label>
                    <label className="grid gap-1">
                      <span className="font-medium">IPC：</span>
                      {editingStrategy ? (
                        <input
                          value={approval.strategy.ipcCodes.join("、")}
                          onChange={(event) =>
                            setApproval((current) =>
                              current
                                ? {
                                    ...current,
                                    strategy: {
                                      ...current.strategy,
                                      ipcCodes: event.target.value
                                        .split(/[、,，]/)
                                        .map((item) =>
                                          item.trim().toUpperCase(),
                                        )
                                        .filter(Boolean),
                                    },
                                  }
                                : current,
                            )
                          }
                          placeholder="例如 G06F、H01M"
                          className="rounded border bg-background px-2 py-1"
                        />
                      ) : (
                        <span>
                          {approval.strategy.ipcCodes.length
                            ? approval.strategy.ipcCodes.join("、")
                            : "不限"}
                        </span>
                      )}
                    </label>
                    <label className="grid gap-1">
                      <span className="font-medium">结果数量：</span>
                      {editingStrategy ? (
                        <input
                          type="number"
                          min="1"
                          max="50"
                          value={approval.strategy.limit}
                          onChange={(event) =>
                            setApproval((current) =>
                              current
                                ? {
                                    ...current,
                                    strategy: {
                                      ...current.strategy,
                                      limit: Math.max(
                                        1,
                                        Math.min(
                                          50,
                                          Number(event.target.value) || 1,
                                        ),
                                      ),
                                    },
                                  }
                                : current,
                            )
                          }
                          className="w-24 rounded border bg-background px-2 py-1"
                        />
                      ) : (
                        <span>{approval.strategy.limit} 条</span>
                      )}
                    </label>
                    <details className="text-muted-foreground">
                      <summary className="cursor-pointer">高级条件</summary>
                      <p>
                        申请人：{(approval.strategy as any).applicant || "不限"}
                        ；公开日期：
                        {(approval.strategy as any).dateFrom || "不限"} 至{" "}
                        {(approval.strategy as any).dateTo || "不限"}；类型：
                        {(approval.strategy as any).kind || "不限"}；排序：
                        {(approval.strategy as any).sortBy || "最新公开"}
                      </p>
                    </details>
                  </div>
                  <div className="mt-4 flex gap-2">
                    {editingStrategy ? (
                      <Button
                        onClick={() => handleApproval("edit-and-approve")}
                        disabled={
                          isLoading || approval.strategy.keywords.length === 0
                        }
                      >
                        保存并检索
                      </Button>
                    ) : (
                      <>
                        <Button
                          onClick={() => handleApproval("approve")}
                          disabled={isLoading}
                        >
                          确认并检索
                        </Button>
                        <Button
                          variant="outline"
                          onClick={() => setEditingStrategy(true)}
                          disabled={isLoading}
                        >
                          修改
                        </Button>
                      </>
                    )}
                    <Button
                      variant="outline"
                      onClick={() => handleApproval("cancel")}
                      disabled={isLoading}
                    >
                      取消
                    </Button>
                  </div>
                </section>
              )}
              {mode === "search" && results.length > 0 && (
                <section className="mx-auto mb-6 max-w-3xl space-y-4 px-4">
                  <h2 className="font-semibold">本地专利库检索结果</h2>
                  {results.map((item) => {
                    const expanded = expandedPatentIds.has(item.id);
                    const abstract = item.abstract || "暂无摘要";
                    const shouldCollapse = abstract.length > 180;
                    return (
                      <article
                        key={item.id}
                        className="rounded-2xl border border-sky-200 bg-card p-5 shadow-sm"
                      >
                        <div className="flex items-start justify-between gap-4">
                          <a
                            href={`/patents/${item.id}`}
                            className="min-w-0 hover:text-primary"
                          >
                            <div className="flex flex-wrap items-center gap-2 text-sm">
                              <span className="font-semibold text-sky-600">
                                {item.docNumber || "公开号未知"}
                              </span>
                              {item.kind && (
                                <span className="rounded-md bg-blue-100 px-2 py-0.5 font-medium text-blue-700">
                                  {item.kind}
                                </span>
                              )}
                              <span className="text-muted-foreground">
                                {item.pubDate || "日期未知"}
                              </span>
                            </div>
                            <h3 className="mt-2 text-lg font-semibold leading-7">
                              {item.title || "未命名专利"}
                            </h3>
                          </a>
                          <a
                            href={`/patents/${item.id}`}
                            className="shrink-0 rounded-md border px-3 py-1.5 text-sm font-medium text-primary hover:bg-primary/5"
                          >
                            专利解析
                          </a>
                          {shouldCollapse && (
                            <button
                              type="button"
                              onClick={() =>
                                setExpandedPatentIds((current) => {
                                  const next = new Set(current);
                                  if (next.has(item.id)) next.delete(item.id);
                                  else next.add(item.id);
                                  return next;
                                })
                              }
                              className="flex shrink-0 items-center gap-1 text-sm font-medium hover:text-primary"
                            >
                              {expanded ? "收起" : "展开"}
                              {expanded ? (
                                <ChevronUp className="h-4 w-4" />
                              ) : (
                                <ChevronDown className="h-4 w-4" />
                              )}
                            </button>
                          )}
                        </div>
                        <p className="mt-3 text-sm text-muted-foreground">
                          申请人：{item.applicant || "未知"}
                        </p>
                        {item.ipcCodes?.length ? (
                          <div className="mt-3 flex flex-wrap gap-2">
                            {item.ipcCodes.map((ipc) => (
                              <span
                                key={ipc}
                                className="rounded-full border border-sky-200 bg-sky-50 px-3 py-1 font-mono text-xs text-slate-700"
                              >
                                {ipc}
                              </span>
                            ))}
                          </div>
                        ) : null}
                        <p className="mt-4 border-t pt-4 text-sm leading-6 text-muted-foreground">
                          {expanded || !shouldCollapse
                            ? abstract
                            : `${abstract.slice(0, 180)}…`}
                        </p>
                      </article>
                    );
                  })}
                </section>
              )}
              {isLoading && (
                <div className="mx-auto flex max-w-3xl items-center gap-2 px-4 pb-4 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  智能体正在处理…
                </div>
              )}
            </div>
            {messageStops.length > 1 && (
              <nav
                aria-label="对话内容定位"
                className="pointer-events-none absolute inset-y-6 right-2 z-10 hidden w-5 flex-col items-center justify-center gap-1.5 md:flex"
              >
                {messageStops.map((stop, index) => (
                  <button
                    key={stop.id}
                    type="button"
                    title={`定位到第 ${index + 1} 条：${stop.label || "消息"}`}
                    aria-label={`定位到第 ${index + 1} 条消息`}
                    onClick={() => scrollToMessage(stop.id)}
                    className={`pointer-events-auto h-0.5 w-3 shrink-0 rounded-full transition-colors ${
                      activeMessageId === stop.id
                        ? "bg-primary"
                        : "bg-muted-foreground/30 hover:bg-muted-foreground/65"
                    }`}
                  />
                ))}
              </nav>
            )}
          </div>
          {messages.length > 0 && (
            <div className="shrink-0 border-t bg-background">
              <ChatInput
                onSend={handleSend}
                mode={mode}
                disabled={isLoading || Boolean(approval)}
              />
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

export default function Home() {
  return <AssistantWorkspace mode="qa" />;
}
