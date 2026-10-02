"use client";

import { useEffect, useRef, useState } from "react";
import { WorkspaceNavigation } from "@/components/workspace-navigation";
import { useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import {
  sectionKeys,
  sectionLabels,
  type DisclosureTask,
  type DisclosureCommand,
  type SectionKey,
} from "@/src/mastra/disclosure/contracts";

type TaskSummary = {
  id: string;
  title: string;
  version: number;
  updatedAt: string;
};
const stageLabels = {
  collecting: "整理材料",
  awaiting_input: "待补充信息",
  draft: "文稿待复核",
  ready: "检查完成",
};
async function requestJson(url: string, init?: RequestInit) {
  const response = await fetch(url, init);
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || "操作失败，请重试");
  return body;
}
export function DisclosureWorkspace() {
  const searchParams = useSearchParams();
  const requestedConversationId = searchParams.get("conversationId");
  const [tasks, setTasks] = useState<TaskSummary[]>([]);
  const [task, setTask] = useState<DisclosureTask | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [selected, setSelected] = useState<SectionKey>("technicalSolution");
  const [editing, setEditing] = useState<string | null>(null);
  const [restoreVersion, setRestoreVersion] = useState(0);
  const [preview, setPreview] = useState(false);
  const [error, setError] = useState("");
  const [mobileView, setMobileView] = useState("assistant");
  const [isDesktop, setIsDesktop] = useState(false);
  const [patentKeywords, setPatentKeywords] = useState("");
  const [selectedPatentIds, setSelectedPatentIds] = useState<string[]>([]);
  const fileInput = useRef<HTMLInputElement>(null);
  const activeId = useRef<string | null>(null);
  const working = busy || task?.status === "running";
  const refreshList = () =>
    requestJson("/api/agent/disclosures").then((data) => setTasks(data.items));
  const applyTask = (next: DisclosureTask) => {
    activeId.current = next.id;
    setTask(next);
    window.history.replaceState(null, "", `/disclosure?id=${next.id}`);
  };
  const load = async (id: string) => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const data = await requestJson(`/api/agent/disclosures/${id}`);
      applyTask(data.task);
      setEditing(null);
      setRestoreVersion(Math.max(0, data.task.version - 1));
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    refreshList().catch((error) => setError(error.message));
    const id = new URLSearchParams(window.location.search).get("id");
    if (id) {
      void load(id);
      return;
    }
    if (requestedConversationId)
      void requestJson(
        `/api/agent/disclosures?conversationId=${encodeURIComponent(requestedConversationId)}`,
      )
        .then((data) => applyTask(data.task))
        .catch((cause) => setError(cause.message));
  }, [requestedConversationId]);
  useEffect(() => {
    const mediaQuery = window.matchMedia("(min-width: 1024px)");
    const syncLayout = () => setIsDesktop(mediaQuery.matches);
    syncLayout();
    mediaQuery.addEventListener("change", syncLayout);
    return () => mediaQuery.removeEventListener("change", syncLayout);
  }, []);
  useEffect(() => {
    if (task?.status !== "running") return;
    const id = task.id;
    const timer = setInterval(() => {
      requestJson(`/api/agent/disclosures/${id}`)
        .then((data) => {
          if (activeId.current === id) setTask(data.task);
        })
        .catch(() => {});
    }, 3000);
    return () => clearInterval(timer);
  }, [task?.id, task?.status]);
  // 兼容二、三期发布前已保存的任务状态，下一次写入会由服务端补齐字段。
  const patentSearches = task?.state.patentSearches || [];
  const patentInsights = task?.state.patentInsights || [];
  const sectionImpacts = task?.state.sectionImpacts || [];
  const latestPatentSearch = patentSearches[0];
  const latestPatentInsight = patentInsights.find(
    (item) => item.searchId === latestPatentSearch?.id,
  );
  useEffect(() => {
    if (!latestPatentSearch) return;
    setSelectedPatentIds((current) =>
      current.filter((id) =>
        latestPatentSearch.items.some((item) => item.id === id),
      ).length
        ? current.filter((id) =>
            latestPatentSearch.items.some((item) => item.id === id),
          )
        : latestPatentSearch.items.slice(0, 5).map((item) => item.id),
    );
  }, [latestPatentSearch?.id]);
  const create = async () => {
    const data = await requestJson("/api/agent/disclosures", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: message.slice(0, 60) || "新交底书" }),
    });
    applyTask(data.task);
    await refreshList();
    return data.task as DisclosureTask;
  };
  const newTask = async () => {
    if (working) return;
    setBusy(true);
    setError("");
    try {
      await create();
      setEditing(null);
      setMessage("");
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const perform = async (
    input: Partial<DisclosureCommand> & { action: DisclosureCommand["action"] },
    retry?: DisclosureCommand,
  ) => {
    if (working) return;
    setBusy(true);
    setError("");
    let current = task;
    try {
      current = current || (await create());
      const command = retry || {
        ...input,
        baseVersion: current.version,
        operationId: crypto.randomUUID(),
      };
      const data = await requestJson(`/api/agent/disclosures/${current.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(command),
      });
      applyTask(data.task);
      setEditing(null);
      if (input.action === "message" || input.action === "revise")
        setMessage("");
      await refreshList();
    } catch (error) {
      setError((error as Error).message);
      if (current)
        await requestJson(`/api/agent/disclosures/${current.id}`)
          .then((data) => setTask(data.task))
          .catch(() => {});
    } finally {
      setBusy(false);
    }
  };
  const upload = async (file: File) => {
    if (working) return;
    setBusy(true);
    setError("");
    let current = task;
    try {
      current = current || (await create());
      const form = new FormData();
      form.set("file", file);
      form.set("baseVersion", String(current.version));
      form.set("operationId", crypto.randomUUID());
      const data = await requestJson(
        `/api/agent/disclosures/${current.id}/upload`,
        { method: "POST", body: form },
      );
      applyTask(data.task);
      await refreshList();
      toast.success("材料已保存");
    } catch (error) {
      setError((error as Error).message);
      if (current)
        await requestJson(`/api/agent/disclosures/${current.id}`)
          .then((data) => setTask(data.task))
          .catch(() => {});
    } finally {
      setBusy(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  };
  const exportFile = async () => {
    if (!task) return;
    try {
      const response = await fetch(
        `/api/agent/disclosures/${task.id}/export?version=${task.version}`,
      );
      if (!response.ok) throw new Error((await response.json()).error);
      const url = URL.createObjectURL(await response.blob()),
        a = document.createElement("a");
      a.href = url;
      a.download = `专利交底书-v${task.version}.docx`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) {
      setError((error as Error).message);
    }
  };
  const suggestion = task?.state.suggestions.find(
    (item) => item.section === selected,
  );
  return (
    <div className="flex h-dvh overflow-hidden bg-background text-foreground">
      <div className="flex min-h-0 flex-1 flex-col">
        <header className="shrink-0 flex flex-wrap items-center justify-between gap-3 border-b px-5 py-3">
          <div>
            <h1 className="text-lg font-semibold">专利交底书工作台</h1>
            <p className="text-xs text-muted-foreground">
              整理技术事实 · 补全实现细节 · 持续修订
            </p>
          </div>
          <WorkspaceNavigation />
        </header>
        <div
          className="flex shrink-0 flex-wrap gap-2 border-b bg-card px-4 py-3 lg:hidden"
          role="group"
          aria-label="切换工作区域"
        >
          {[
            ["assistant", "输入与上传"],
            ["document", "文稿"],
            ["outline", "章节与历史"],
          ].map(([value, label]) => (
            <Button
              key={value}
              size="sm"
              variant={mobileView === value ? "default" : "outline"}
              aria-pressed={mobileView === value}
              onClick={() => setMobileView(value)}
            >
              {label}
            </Button>
          ))}
        </div>
        <ResizablePanelGroup
          direction={isDesktop ? "horizontal" : "vertical"}
          className={`disclosure-panels mobile-view-${mobileView} min-h-0 flex-1`}
        >
          <ResizablePanel
            className="disclosure-outline"
            defaultSize={18}
            minSize={12}
          >
            <aside className="h-full space-y-5 overflow-y-auto bg-muted/20 p-4">
              <Button
                className="w-full"
                onClick={newTask}
                disabled={!!working || editing !== null}
              >
                新建交底书
              </Button>
              <div>
                <p className="mb-2 text-sm font-semibold">历史任务</p>
                <div className="max-h-48 space-y-1 overflow-auto">
                  {tasks.map((item) => (
                    <button
                      key={item.id}
                      disabled={!!working || editing !== null}
                      onClick={() => load(item.id)}
                      className={`block w-full truncate rounded p-2 text-left text-sm hover:bg-muted ${task?.id === item.id ? "bg-muted font-medium" : ""}`}
                    >
                      <span title={item.title}>{item.title}</span>
                      <span className="ml-2 text-xs text-muted-foreground">
                        v{item.version}
                      </span>
                    </button>
                  ))}
                  {!tasks.length && (
                    <p className="text-xs text-muted-foreground">
                      创建后自动保存，保留 30 天
                    </p>
                  )}
                </div>
              </div>
              <div>
                <p className="mb-2 text-sm font-semibold">文稿章节</p>
                {sectionKeys.map((key) => (
                  <button
                    disabled={editing !== null}
                    key={key}
                    onClick={() => {
                      setSelected(key);
                      setPreview(false);
                    }}
                    className={`flex w-full items-center justify-between gap-2 rounded px-2 py-2 text-left text-sm ${selected === key ? "bg-primary/10 text-primary" : "hover:bg-muted"}`}
                  >
                    <span>{sectionLabels[key]}</span>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {task?.state.sections[key] ? "已填写" : "未填写"}
                    </span>
                  </button>
                ))}
              </div>
              {task && (
                <div className="space-y-2 border-t pt-3 text-sm">
                  <p>已保存版本 v{task.version}</p>
                  <label className="block text-xs" htmlFor="restore-version">
                    恢复历史版本（另存为新版本）
                  </label>
                  <select
                    id="restore-version"
                    className="w-full rounded border bg-background p-2"
                    value={restoreVersion}
                    onChange={(event) =>
                      setRestoreVersion(Number(event.target.value))
                    }
                  >
                    {Array.from({ length: task.version + 1 }, (_, i) => (
                      <option value={i} key={i}>
                        版本 {i}
                        {i === task.version ? "（当前）" : ""}
                      </option>
                    ))}
                  </select>
                  <Button
                    variant="outline"
                    className="w-full"
                    disabled={
                      !!working ||
                      editing !== null ||
                      restoreVersion === task.version
                    }
                    onClick={() =>
                      perform({ action: "restore", restoreVersion })
                    }
                  >
                    恢复此版本
                  </Button>
                </div>
              )}
            </aside>
          </ResizablePanel>
          <ResizableHandle withHandle className="bg-border/80" />
          <ResizablePanel
            className="disclosure-document"
            defaultSize={54}
            minSize={32}
          >
            <main className="h-full min-w-0 space-y-4 overflow-y-auto p-5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span
                  className="rounded-full bg-muted px-3 py-1 text-sm"
                  role="status"
                >
                  {working
                    ? "正在处理，请稍候…"
                    : task
                      ? stageLabels[task.state.stage]
                      : "请先输入方案或上传材料"}
                </span>
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={
                      !!working ||
                      editing !== null ||
                      !task?.state.sources.length
                    }
                    onClick={() =>
                      perform({
                        action: "draft",
                        message:
                          "请基于现有材料生成初稿，缺失信息明确标注待补充。",
                      })
                    }
                  >
                    生成初稿
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={!!working || editing !== null || !task}
                    onClick={() => perform({ action: "check" })}
                  >
                    质量检查
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={
                      !!working ||
                      editing !== null ||
                      !task?.state.images.length
                    }
                    onClick={() => perform({ action: "check-images" })}
                  >
                    检查图文一致性
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={editing !== null}
                    onClick={() => setPreview(!preview)}
                  >
                    {preview ? "返回编辑" : "预览"}
                  </Button>
                  <Button
                    size="sm"
                    disabled={
                      !!working ||
                      editing !== null ||
                      !task?.state.sections.technicalSolution
                    }
                    onClick={exportFile}
                  >
                    导出 Word
                  </Button>
                </div>
              </div>
              {error && (
                <div
                  role="alert"
                  className="rounded border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive"
                >
                  {error}
                </div>
              )}
              {task?.status === "failed" && (
                <div className="rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
                  {task.error}
                  <Button
                    variant="outline"
                    size="sm"
                    className="ml-2"
                    disabled={!!working}
                    onClick={() => {
                      if (task.pending?.source || task.pending?.image) {
                        setError("材料处理失败，请重新上传原文件重试。");
                        return;
                      }
                      if (task.pending)
                        void perform(
                          { action: task.pending.action },
                          task.pending,
                        );
                    }}
                  >
                    重试上次操作
                  </Button>
                </div>
              )}
              {preview ? (
                <article className="space-y-6 rounded-xl border bg-card p-6">
                  {sectionKeys.map((key) => (
                    <section key={key}>
                      <h2 className="mb-2 font-semibold">
                        {sectionLabels[key]}
                      </h2>
                      <p className="whitespace-pre-wrap text-sm leading-7">
                        {task?.state.sections[key] || "待补充"}
                      </p>
                    </section>
                  ))}
                  {task?.state.images.map((image, index) => (
                    <figure key={image.id}>
                      <img
                        className="mx-auto max-h-96 max-w-full"
                        src={`/api/agent/disclosures/${task.id}/assets/${image.id}`}
                        alt={image.caption || image.name}
                      />
                      <figcaption className="mt-2 text-center text-sm">
                        图{index + 1} {image.caption || image.name}
                      </figcaption>
                    </figure>
                  ))}
                  <p className="text-xs text-muted-foreground">
                    版本 {task?.version || 0}。导出包含附图和当前待复核事项。
                  </p>
                </article>
              ) : (
                <>
                  <section className="rounded-xl border bg-card p-5">
                    <div className="mb-4 flex items-center justify-between gap-3">
                      <h2 className="font-semibold">
                        {sectionLabels[selected]}
                      </h2>
                      {task && editing === null && (
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={!!working}
                          onClick={() =>
                            setEditing(task.state.sections[selected])
                          }
                        >
                          编辑本章
                        </Button>
                      )}
                    </div>
                    {editing !== null ? (
                      <div className="space-y-3">
                        {selected === "applicationType" ? (
                          <select
                            aria-label="申请类型"
                            value={editing}
                            onChange={(event) => setEditing(event.target.value)}
                            className="rounded border p-2"
                          >
                            <option value="">待补充</option>
                            <option>发明</option>
                            <option>实用新型</option>
                          </select>
                        ) : (
                          <Textarea
                            aria-label={`编辑${sectionLabels[selected]}`}
                            value={editing}
                            onChange={(event) => setEditing(event.target.value)}
                            className="min-h-72"
                          />
                        )}
                        <p className="text-xs text-muted-foreground">
                          保存后，本章后续 AI 修改将作为建议展示。
                        </p>
                        <div className="flex gap-2">
                          <Button
                            disabled={!!working}
                            onClick={() =>
                              perform({
                                action: "edit",
                                section: selected,
                                content: editing,
                              })
                            }
                          >
                            保存章节
                          </Button>
                          <Button
                            variant="outline"
                            disabled={!!working}
                            onClick={() => setEditing(null)}
                          >
                            取消编辑
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <p className="min-h-48 whitespace-pre-wrap text-sm leading-7">
                        {task?.state.sections[selected] ||
                          "在“输入与上传”区域描述技术方案，或上传 DOCX、PDF 材料。整理材料后，点击“生成初稿”。"}
                      </p>
                    )}
                  </section>
                  {suggestion && (
                    <section className="space-y-3 rounded-xl border border-blue-300 bg-blue-50/30 p-4">
                      <h3 className="font-semibold">本章修改建议</h3>
                      <p className="text-sm">{suggestion.reason}</p>
                      <details>
                        <summary className="cursor-pointer text-sm">
                          展开建议内容，与上方原文对比
                        </summary>
                        <p className="mt-2 whitespace-pre-wrap text-sm leading-7">
                          {suggestion.content}
                        </p>
                      </details>
                      <Button
                        disabled={!!working || editing !== null}
                        size="sm"
                        onClick={() =>
                          perform({ action: "accept", section: selected })
                        }
                      >
                        采用建议
                      </Button>
                    </section>
                  )}
                  {!!task?.state.suggestions.length && (
                    <p className="text-xs text-muted-foreground">
                      待处理建议：
                      {task.state.suggestions
                        .map((p) => sectionLabels[p.section])
                        .join("、")}
                    </p>
                  )}
                  <section className="rounded-xl border p-4">
                    <h3 className="mb-2 font-semibold">关联专利检索</h3>
                    <p className="mb-3 text-xs leading-5 text-muted-foreground">
                      仅在你点击检索后查询。结果作为外部证据，不能自动写入技术方案。
                    </p>
                    <div className="flex flex-wrap gap-2">
                      <Input
                        aria-label="专利检索关键词"
                        placeholder="输入关键词，以顿号、逗号或换行分隔"
                        value={patentKeywords}
                        onChange={(event) =>
                          setPatentKeywords(event.target.value)
                        }
                        className="max-w-lg"
                      />
                      <Button
                        variant="outline"
                        disabled={
                          !!working ||
                          editing !== null ||
                          !patentKeywords.trim()
                        }
                        onClick={() =>
                          perform({
                            action: "search-patents",
                            search: {
                              keywords: patentKeywords
                                .split(/[，、,\n\r]/)
                                .map((item) => item.trim())
                                .filter(Boolean),
                              limit: 10,
                            },
                          })
                        }
                      >
                        检索相关专利
                      </Button>
                    </div>
                    {latestPatentSearch && (
                      <div className="mt-4 space-y-3">
                        <p className="text-sm">
                          本次检索：{latestPatentSearch.keywords.join("、")}；共{" "}
                          {latestPatentSearch.total} 件，显示{" "}
                          {latestPatentSearch.items.length} 件。
                        </p>
                        <div className="max-h-80 space-y-2 overflow-y-auto">
                          {latestPatentSearch.items.map((item) => (
                            <label
                              key={item.id}
                              className="block rounded border p-3 text-sm"
                            >
                              <input
                                type="checkbox"
                                className="mr-2 align-middle"
                                checked={selectedPatentIds.includes(item.id)}
                                disabled={!!working || editing !== null}
                                onChange={(event) =>
                                  setSelectedPatentIds((current) =>
                                    event.target.checked
                                      ? [
                                          ...new Set([...current, item.id]),
                                        ].slice(0, 10)
                                      : current.filter((id) => id !== item.id),
                                  )
                                }
                              />
                              <span className="font-medium">
                                {item.docNumber || item.id}{" "}
                                {item.title || "未命名专利"}
                              </span>
                              <span className="ml-2 text-xs text-muted-foreground">
                                {item.pubDate}
                              </span>
                              <p className="mt-1 line-clamp-3 text-xs leading-5 text-muted-foreground">
                                {item.abstract || "未提供摘要"}
                              </p>
                            </label>
                          ))}
                        </div>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={
                            !!working ||
                            editing !== null ||
                            !selectedPatentIds.length ||
                            !!latestPatentInsight
                          }
                          onClick={() =>
                            perform({
                              action: "analyze-patents",
                              searchId: latestPatentSearch.id,
                              patentIds: selectedPatentIds,
                            })
                          }
                        >
                          生成背景与差异建议
                        </Button>
                      </div>
                    )}
                    {latestPatentInsight && (
                      <div className="mt-4 space-y-3 rounded border border-blue-300 bg-blue-50/30 p-3 text-sm">
                        <p className="font-medium">
                          检索证据分析（需人工审阅）
                        </p>
                        <p className="whitespace-pre-wrap">
                          {latestPatentInsight.summary}
                        </p>
                        <details>
                          <summary className="cursor-pointer">
                            背景描述建议
                          </summary>
                          <p className="mt-2 whitespace-pre-wrap leading-6">
                            {latestPatentInsight.backgroundSuggestion}
                          </p>
                        </details>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={!!working || editing !== null}
                          onClick={() => {
                            setSelected("techBackground");
                            setEditing(
                              latestPatentInsight.backgroundSuggestion,
                            );
                          }}
                        >
                          载入背景编辑草稿
                        </Button>
                        <details>
                          <summary className="cursor-pointer">
                            差异说明与限制
                          </summary>
                          <p className="mt-2 whitespace-pre-wrap leading-6">
                            {latestPatentInsight.differenceSuggestion}
                          </p>
                          <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-muted-foreground">
                            {latestPatentInsight.limitations.map(
                              (item, index) => (
                                <li key={index}>{item}</li>
                              ),
                            )}
                          </ul>
                        </details>
                      </div>
                    )}
                  </section>
                  <section className="rounded-xl border p-4">
                    <h3 className="mb-3 font-semibold">质量检查与来源</h3>
                    {task?.state.issues.map((issue, index) => (
                      <button
                        key={index}
                        disabled={editing !== null}
                        className={`mb-2 block w-full rounded p-2 text-left text-sm ${issue.severity === "error" ? "bg-destructive/5 text-destructive" : "bg-muted"}`}
                        onClick={() => setSelected(issue.section)}
                      >
                        {sectionLabels[issue.section]}：{issue.message}
                      </button>
                    ))}
                    {!task?.state.issues.length && (
                      <p className="text-sm text-muted-foreground">
                        {task?.state.stage === "ready"
                          ? "本轮未发现待处理问题，仍可继续补充和修订。"
                          : "生成或修改文稿后可运行质量检查。"}
                      </p>
                    )}
                    {!!sectionImpacts.length && (
                      <details className="mt-3">
                        <summary className="cursor-pointer text-sm">
                          受影响章节（{sectionImpacts.length}）
                        </summary>
                        <div className="mt-2 space-y-2 text-sm">
                          {sectionImpacts.map((impact, index) => (
                            <button
                              key={`${impact.sourceSection}-${impact.affectedSection}-${index}`}
                              className="block w-full rounded bg-muted p-2 text-left"
                              disabled={editing !== null}
                              onClick={() =>
                                setSelected(impact.affectedSection)
                              }
                            >
                              {impact.status === "suggested"
                                ? "建议联动"
                                : "需要复核"}
                              ：{impact.reason}
                            </button>
                          ))}
                        </div>
                      </details>
                    )}
                    <details className="mt-3">
                      <summary className="cursor-pointer text-sm">
                        技术事实与材料来源（{task?.state.facts.length || 0}）
                      </summary>
                      {task?.state.facts.map((fact, index) => (
                        <div
                          key={index}
                          className="mt-3 border-l-2 pl-3 text-sm"
                        >
                          <p>
                            {fact.category}：{fact.text}
                          </p>
                          <blockquote className="mt-1 text-xs text-muted-foreground">
                            原文：{fact.quote}
                          </blockquote>
                          <p className="text-xs text-muted-foreground">
                            {
                              task.state.sources.find(
                                (source) => source.id === fact.sourceId,
                              )?.label
                            }
                          </p>
                        </div>
                      ))}
                    </details>
                  </section>
                </>
              )}
            </main>
          </ResizablePanel>
          <ResizableHandle withHandle className="bg-border/80" />
          <ResizablePanel
            className="disclosure-assistant"
            defaultSize={28}
            minSize={18}
          >
            <aside className="flex h-full min-h-0 min-w-0 flex-col gap-4 overflow-y-auto bg-muted/10 p-4">
              <div>
                <h2 className="font-semibold">输入与上传</h2>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">
                  提交技术资料，或要求修改当前章节。
                </p>
              </div>
              <div
                className="min-h-0 flex-1 space-y-3 overflow-y-auto"
                aria-live="polite"
              >
                {!task?.state.messages.length && (
                  <p className="rounded-lg bg-muted p-3 text-sm leading-6">
                    请告诉我：你要解决什么问题，准备通过什么技术手段实现？也可以直接粘贴完整方案。
                  </p>
                )}
                {task?.state.messages.map((item, index) => (
                  <div
                    key={`${item.id}-${index}`}
                    className={`rounded-lg p-3 text-sm leading-6 ${item.role === "user" ? "bg-primary/10" : "bg-muted"}`}
                  >
                    <p className="mb-1 text-xs text-muted-foreground">
                      {item.role === "user" ? "你" : "交底书助手"}
                    </p>
                    <p className="whitespace-pre-wrap">{item.text}</p>
                  </div>
                ))}
                {!!task?.state.questions.length && (
                  <div className="rounded-lg border border-primary/30 p-3">
                    <p className="mb-2 text-sm font-medium">请补充以下信息</p>
                    <ol className="list-decimal space-y-2 pl-5 text-sm">
                      {task.state.questions.map((question, index) => (
                        <li key={index}>{question}</li>
                      ))}
                    </ol>
                  </div>
                )}
              </div>
              <div className="shrink-0 space-y-2 border-t pt-3">
                <Textarea
                  aria-label="技术方案或补充信息"
                  disabled={!!working}
                  placeholder="例如：方案要解决的问题、采用的技术手段，或当前章节需要修改的内容。"
                  value={message}
                  onChange={(event) => setMessage(event.target.value)}
                  maxLength={20000}
                  className="min-h-28"
                />
                <div className="flex flex-wrap gap-2">
                  <Button
                    className="flex-1"
                    disabled={!!working || !message.trim() || editing !== null}
                    onClick={() => perform({ action: "message", message })}
                  >
                    提交技术资料
                  </Button>
                  <Button
                    variant="outline"
                    disabled={
                      !!working || !message.trim() || !task || editing !== null
                    }
                    onClick={() =>
                      perform({ action: "revise", section: selected, message })
                    }
                  >
                    修改当前章节
                  </Button>
                  <Button
                    variant="outline"
                    disabled={!!working || editing !== null}
                    onClick={() => fileInput.current?.click()}
                  >
                    上传材料或附图
                  </Button>
                  <input
                    ref={fileInput}
                    className="hidden"
                    type="file"
                    accept=".docx,.pdf,.png,.jpg,.jpeg"
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      if (file) void upload(file);
                    }}
                  />
                </div>
                <p className="text-xs leading-5 text-muted-foreground">
                  “提交技术资料”用于补充事实；“修改当前章节”将修改「
                  {sectionLabels[selected]}」。
                </p>
                <div className="border-t pt-2">
                  <p className="text-xs text-muted-foreground">
                    DOCX、PDF、PNG、JPEG，最大 10 MB。文件上传后由 AI 直接解析。
                  </p>
                  {!!task?.state.images.length && (
                    <details className="text-xs text-muted-foreground">
                      <summary className="cursor-pointer">
                        已导入 {task.state.images.length}{" "}
                        张附图，可点击上方“检查图文一致性”进行核验。
                      </summary>
                      <div className="mt-2 max-h-24 space-y-1 overflow-y-auto">
                        {task.state.images.map((image, index) => (
                          <div
                            key={image.id}
                            className="flex items-center gap-2"
                          >
                            <span className="min-w-0 flex-1 truncate">
                              图{index + 1} {image.caption || image.name}
                            </span>
                            <button
                              className="text-destructive underline"
                              disabled={!!working || editing !== null}
                              onClick={() =>
                                perform({
                                  action: "remove-image",
                                  imageId: image.id,
                                })
                              }
                            >
                              移除
                            </button>
                          </div>
                        ))}
                      </div>
                    </details>
                  )}
                </div>
                {editing !== null && (
                  <p className="text-xs text-muted-foreground">
                    请先保存或取消正在编辑的章节。
                  </p>
                )}
              </div>
            </aside>
          </ResizablePanel>
        </ResizablePanelGroup>
      </div>
    </div>
  );
}
