"use client";

import {
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type Ref,
} from "react";
import { useSearchParams } from "next/navigation";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Download,
  FilePenLine,
  ImagePlus,
  Loader2,
  Plus,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ChatInput } from "@/components/chat-input";
import {
  initialState,
  sectionKeys,
  sectionLabels,
  type DisclosureTask,
  type DisclosureState,
  type SectionKey,
} from "@/src/mastra/disclosure/contracts";
import {
  inspectTechnicalSolution,
  getUserTechnicalSolution,
} from "@/src/mastra/disclosure/technical-solution-policy";
import {
  writingSteps,
  writingDraftKey,
  missingWritingFields,
} from "@/src/mastra/disclosure/writing-flow";
import {
  DisclosureTools,
  type DisclosureAction,
  type DisclosureTool,
} from "./disclosure-tools";

type Sections = DisclosureState["sections"];
type Blocks = NonNullable<DisclosureState["solutionBlocks"]>;
type Keywords = NonNullable<DisclosureState["keywords"]>;
type TaskSummary = {
  id: string;
  title: string;
  version: number;
  updatedAt: string;
};
export type DisclosureWorkspaceHandle = {
  flushDraft: () => Promise<boolean>;
};
const limits: Record<SectionKey, number> = {
  inventionName: 300,
  contactPerson: 300,
  applicationType: 100,
  technicalField: 2000,
  techBackground: 20000,
  technicalSolution: 40000,
  beneficialEffects: 15000,
  protectionPoints: 15000,
};
const sectionStep = (section: SectionKey) =>
  section === "techBackground"
    ? 1
    : section === "technicalSolution"
      ? 2
      : ["beneficialEffects", "protectionPoints"].includes(section)
        ? 3
        : 0;
const inferredStep = (task: DisclosureTask) =>
  task.state.writingStep ??
  (task.state.sections.beneficialEffects && task.state.sections.protectionPoints
    ? 3
    : task.state.sections.technicalSolution
      ? 2
      : task.state.sections.techBackground
        ? 1
        : 0);
const blocksFor = (state: DisclosureState): Blocks =>
  state.solutionBlocks?.length &&
  state.solutionBlocks.map((block) => block.content).join("\n") ===
    state.sections.technicalSolution
    ? state.solutionBlocks
    : [{ id: "solution", content: state.sections.technicalSolution }];
async function requestJson(url: string, init?: RequestInit) {
  const response = await fetch(url, init);
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || "操作失败，请重试");
  return body;
}

export function DisclosureGuidedWorkspace({
  embedded = false,
  active = true,
  initialConversationId,
  requestKey,
  onExit,
  onTaskChange,
  onBusyChange,
  ref,
}: {
  embedded?: boolean;
  active?: boolean;
  initialConversationId?: string | null;
  requestKey?: number;
  onExit?: () => void;
  onTaskChange?: (task: DisclosureTask) => void;
  onBusyChange?: (busy: boolean) => void;
  ref?: Ref<DisclosureWorkspaceHandle>;
}) {
  const searchParams = useSearchParams();
  const conversationId = embedded
    ? initialConversationId
    : searchParams.get("conversationId");
  const [task, setTask] = useState<DisclosureTask | null>(null);
  const [tasks, setTasks] = useState<TaskSummary[]>([]);
  const [step, setStep] = useState(0);
  const [sections, setSections] = useState<Sections>(initialState().sections);
  const [blocks, setBlocks] = useState<Blocks>([
    { id: "solution", content: "" },
  ]);
  const [keywords, setKeywords] = useState<Keywords>([]);
  const [captions, setCaptions] = useState<Record<string, string>>({});
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [error, setError] = useState("");
  const [panel, setPanel] = useState<DisclosureTool | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const content = useRef<HTMLElement>(null);
  const solutionImageInput = useRef<HTMLInputElement>(null);
  const inFlight = useRef(false);
  const activeId = useRef<string | null>(null);
  const savePromise = useRef<Promise<boolean> | null>(null);
  const failedDraft = useRef<string | null>(null);
  const working = busy || task?.status === "running";
  const draft = {
    sections: {
      ...sections,
      technicalSolution: blocks.map((block) => block.content).join("\n"),
    },
    solutionBlocks: blocks,
    keywords: keywords.filter((item) => item.term.trim()),
    captions: (task?.state.images || []).map((image) => ({
      id: image.id,
      caption: captions[image.id] ?? image.caption,
    })),
    writingStep: step,
  };
  const draftKey = writingDraftKey(draft);
  const savedKey = (current: DisclosureTask | null) => {
    const state = current?.state || initialState();
    return writingDraftKey({
      sections: state.sections,
      solutionBlocks: blocksFor(state),
      keywords: state.keywords || [],
      captions: state.images.map((image) => ({
        id: image.id,
        caption: image.caption,
      })),
      writingStep: current ? inferredStep(current) : 0,
    });
  };
  const dirty = draftKey !== savedKey(task);
  // 自动保存只更新服务端基线，不能用返回的旧快照覆盖保存期间继续输入的内容。
  const latest = useRef({ task, draft, draftKey, working });
  latest.current = { task, draft, draftKey, working };
  const autosaveRef = useRef<() => Promise<boolean>>(async () => true);
  const refreshList = async () => {
    const data = await requestJson("/api/agent/disclosures");
    setTasks(data.items);
  };
  const applyTask = (next: DisclosureTask) => {
    latest.current.task = next;
    failedDraft.current = null;
    setSaveError("");
    activeId.current = next.id;
    setTask(next);
    setStep(inferredStep(next));
    setSections(next.state.sections);
    setBlocks(blocksFor(next.state));
    setKeywords(next.state.keywords || []);
    setCaptions(
      Object.fromEntries(
        next.state.images.map((image) => [image.id, image.caption]),
      ),
    );
    setConfirmed(false);
    if (!embedded)
      window.history.replaceState(null, "", `/disclosure?id=${next.id}`);
  };
  const load = async (id: string) => {
    if (!(await flushDraft())) return;
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError("");
    try {
      const data = await requestJson(`/api/agent/disclosures/${id}`);
      applyTask(data.task);
      setMessage("");
      setPanel(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };
  useEffect(() => {
    let disposed = false;
    refreshList().catch((err) => {
      if (!disposed) setError(err.message);
    });
    const id = embedded
      ? null
      : new URLSearchParams(window.location.search).get("id");
    if (id) void load(id);
    else if (conversationId) void loadConversation(conversationId);
    return () => {
      disposed = true;
    };
  }, [conversationId, embedded, requestKey]);
  useEffect(() => {
    if (task) onTaskChange?.(task);
  }, [task?.id, task?.version, task?.status, onTaskChange]);
  useEffect(() => {
    onBusyChange?.(!!working || saving || !!message.trim());
  }, [working, saving, message, onBusyChange]);
  useEffect(() => {
    if (task?.status !== "running") return;
    const id = task.id;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const data = await requestJson(`/api/agent/disclosures/${id}`, {
          signal: controller.signal,
        });
        if (!controller.signal.aborted && activeId.current === id) {
          if (latest.current.draftKey !== savedKey(latest.current.task)) {
            latest.current.task = data.task;
            setTask(data.task);
          } else applyTask(data.task);
        }
      } catch {
        /* 短暂断网后继续轮询。 */
      } finally {
        if (!controller.signal.aborted) timer = setTimeout(poll, 3000);
      }
    };
    timer = setTimeout(poll, 3000);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [task?.id, task?.status]);
  useEffect(() => {
    content.current?.scrollTo({ top: 0 });
  }, [step, task?.id]);
  const create = async () => {
    const data = await requestJson("/api/agent/disclosures", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: (
          latest.current.draft.sections.inventionName.trim() || "新交底书"
        ).slice(0, 80),
      }),
    });
    return data.task as DisclosureTask;
  };
  const post = async (current: DisclosureTask, input: DisclosureAction) => {
    const command = {
      ...input,
      operationId: crypto.randomUUID(),
      baseVersion: current.version,
    };
    const data = await requestJson(`/api/agent/disclosures/${current.id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(command),
    });
    applyTask(data.task);
    return data.task as DisclosureTask;
  };
  const save = async (current: DisclosureTask, nextStep?: number) => {
    const next = await post(current, {
      action: "save-step",
      ...latest.current.draft,
      writingStep: nextStep ?? latest.current.draft.writingStep,
    });
    return next;
  };
  const autosave = (): Promise<boolean> => {
    if (savePromise.current) return savePromise.current;
    const snapshot = latest.current;
    if (snapshot.draftKey === savedKey(snapshot.task)) {
      failedDraft.current = null;
      setSaveError("");
      return Promise.resolve(true);
    }
    if (inFlight.current || snapshot.working) return Promise.resolve(false);
    inFlight.current = true;
    setSaving(true);
    setSaveError("");
    const pending = (async () => {
      try {
        let current = snapshot.task;
        if (!current) {
          current = await create();
          latest.current.task = current;
          activeId.current = current.id;
          setTask(current);
          if (!embedded)
            window.history.replaceState(
              null,
              "",
              `/disclosure?id=${current.id}`,
            );
        }
        const data = await requestJson(`/api/agent/disclosures/${current.id}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "save-step",
            ...snapshot.draft,
            operationId: crypto.randomUUID(),
            baseVersion: current.version,
          }),
        });
        latest.current.task = data.task;
        activeId.current = data.task.id;
        setTask(data.task);
        failedDraft.current = null;
        void refreshList().catch(() => {});
        return true;
      } catch (err) {
        failedDraft.current = snapshot.draftKey;
        setSaveError((err as Error).message || "自动保存失败");
        // 响应丢失时服务端可能已经提交，刷新版本基线后再重试，保留本地输入。
        const current = latest.current.task;
        if (current)
          await requestJson(`/api/agent/disclosures/${current.id}`)
            .then((data) => {
              latest.current.task = data.task;
              setTask(data.task);
            })
            .catch(() => {});
        if (latest.current.draftKey === savedKey(latest.current.task)) {
          failedDraft.current = null;
          setSaveError("");
          return true;
        }
        return false;
      } finally {
        inFlight.current = false;
        savePromise.current = null;
        setSaving(false);
      }
    })();
    savePromise.current = pending;
    return pending;
  };
  autosaveRef.current = autosave;
  const flushDraft = async () => {
    if (savePromise.current && !(await savePromise.current)) return false;
    while (latest.current.draftKey !== savedKey(latest.current.task)) {
      if (!(await autosaveRef.current())) return false;
    }
    return true;
  };
  useImperativeHandle(ref, () => ({ flushDraft }));
  const exit = async () => {
    if (await flushDraft()) onExit?.();
  };
  useEffect(() => {
    if (!dirty || working || saving || failedDraft.current === draftKey) return;
    const timer = setTimeout(
      () => void autosaveRef.current(),
      active ? 800 : 0,
    );
    return () => clearTimeout(timer);
  }, [draftKey, dirty, working, saving, active]);
  useEffect(() => {
    setConfirmed(false);
  }, [draftKey]);
  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (latest.current.draftKey === savedKey(latest.current.task)) return;
      // 保存尚未完成时避免刷新直接丢弃草稿；通常自动保存后不会出现提示。
      void autosaveRef.current();
      event.preventDefault();
      event.returnValue = "";
    };
    const visibilityChange = () => {
      if (document.visibilityState === "hidden") void autosaveRef.current();
    };
    window.addEventListener("beforeunload", beforeUnload);
    document.addEventListener("visibilitychange", visibilityChange);
    return () => {
      window.removeEventListener("beforeunload", beforeUnload);
      document.removeEventListener("visibilitychange", visibilityChange);
    };
  }, []);
  const run = async (
    operation: (current: DisclosureTask) => Promise<DisclosureTask>,
  ) => {
    if (savePromise.current && !(await savePromise.current)) return;
    if (inFlight.current || working) return;
    inFlight.current = true;
    setBusy(true);
    setError("");
    let current = latest.current.task;
    try {
      current = current || (await create());
      const next = await operation(current);
      applyTask(next);
      await refreshList().catch(() => {});
      return next;
    } catch (err) {
      setError((err as Error).message);
      // 保存后的工具失败也保留已提交内容；输入未保存时不覆盖本地草稿。
      if (current)
        await requestJson(`/api/agent/disclosures/${current.id}`)
          .then((data) => {
            setTask(data.task);
          })
          .catch(() => {});
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };
  const loadConversation = async (id: string) => {
    if (!(await flushDraft())) return;
    if (id === task?.conversationId || inFlight.current || working) return;
    inFlight.current = true;
    setBusy(true);
    setError("");
    try {
      const data = await requestJson(
        `/api/agent/disclosures?conversationId=${encodeURIComponent(id)}`,
      );
      applyTask(data.task);
      setMessage("");
      setPanel(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };
  const newTask = async () => {
    if (!(await flushDraft())) return;
    if (inFlight.current || working) return;
    inFlight.current = true;
    setBusy(true);
    setError("");
    try {
      applyTask(await create());
      setMessage("");
      setPanel(null);
      await refreshList();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };
  const perform = async (input: DisclosureAction) => {
    await run(async (current) => {
      if (dirty) current = await save(current);
      return post(current, input);
    });
  };
  const nextStep = async () => {
    const draft = {
      ...(task?.state || initialState()),
      sections: {
        ...sections,
        technicalSolution: blocks.map((block) => block.content).join("\n"),
      },
    };
    const missing = missingWritingFields(draft, step + 1);
    if (missing.length) {
      setError(
        `请填写${missing.map((field) => sectionLabels[field]).join("、")}`,
      );
      return;
    }
    await run(async (current) => {
      current = await save(current, step + 1);
      if (step === 3) {
        current = await post(current, { action: "check" });
      }
      return current;
    });
  };
  const goTo = async (index: number) => {
    await run((current) => save(current, index));
  };
  const optimize = async (blockId?: string) => {
    await run(async (current) => {
      current = await save(current);
      return post(current, { action: "optimize-solution", blockId });
    });
  };
  const optimizeChapter = async (
    section: "techBackground" | "beneficialEffects" | "protectionPoints",
  ) => {
    if (!sections[section].trim()) return;
    const assessment = inspectTechnicalSolution(
      blocks.map((block) => block.content).join("\n"),
    );
    if (!assessment.ready) {
      setError("请先完善核心技术方案，再优化本章节。");
      return;
    }
    const next = await run(async (current) => {
      current = await save(current);
      return post(current, {
        action: "revise",
        section,
        message:
          "优化用户原稿的语言和结构，补充与核心技术方案直接相关的遗漏，不增加实现特征或无依据数据。",
      });
    });
    if (
      next &&
      !next.state.suggestions.some((item) => item.section === section)
    )
      setError(
        next.state.issues.findLast((item) => item.section === section)
          ?.message || "章节优化未完成，原稿已保留。",
      );
  };
  const send = async () => {
    if (!message.trim()) return;
    const next = await run(async (current) => {
      current = await save(current);
      return post(current, { action: "message", message });
    });
    if (next) setMessage("");
  };
  const upload = async (file: File) => {
    const next = await run(async (current) => {
      current = await save(current);
      const form = new FormData();
      form.set("file", file);
      form.set("baseVersion", String(current.version));
      form.set("operationId", crypto.randomUUID());
      const data = await requestJson(
        `/api/agent/disclosures/${current.id}/upload`,
        { method: "POST", body: form },
      );
      return data.task;
    });
    if (next) toast.success("材料已保存");
  };
  const exportFile = async () => {
    if (!task || working || !confirmed) return;
    await run(async (current) => {
      if (dirty) throw new Error("请先保存修改并重新核查");
      const response = await fetch(
        `/api/agent/disclosures/${current.id}/export?version=${current.version}`,
      );
      if (!response.ok) throw new Error((await response.json()).error);
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = url;
      link.download = `专利交底书-${current.state.sections.inventionName || current.version}.docx`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      return current;
    });
  };
  const openSection = (section: SectionKey, value?: string) => {
    setPanel(null);
    setStep(sectionStep(section));
    if (value !== undefined) {
      setSections((prev) => ({ ...prev, [section]: value }));
      if (section === "technicalSolution")
        setBlocks([{ id: "solution", content: value }]);
    }
  };
  const updateSection = (section: SectionKey, value: string) => {
    setSections((prev) => ({ ...prev, [section]: value }));
    setConfirmed(false);
    setError("");
  };
  const suggestion = task?.state.suggestions.find(
    (patch) => patch.section === "technicalSolution",
  );
  const assessment = inspectTechnicalSolution(
    task ? getUserTechnicalSolution(task.state) : "",
  );
  const hasSubmittedSolution =
    !!task?.state.sources.some(
      (source) =>
        (source.label === "用户编辑：technicalSolution" ||
          !source.label.startsWith("用户编辑：")) &&
        source.text.trim(),
    ) ||
    !!task?.state.technicalSolutionQuotes?.length ||
    !!task?.state.images.length;
  const solutionIssues =
    (hasSubmittedSolution ? task?.state.issues || [] : [])
      .filter((issue) => issue.section === "technicalSolution")
      .map((issue) => issue.message) || [];
  const maxStep = task
    ? Math.max(
        inferredStep(task),
        ...[1, 2, 3, 4].filter(
          (index) => !missingWritingFields(task.state, index).length,
        ),
      )
    : 0;
  const shownCoreReminder =
    step === 2 &&
    hasSubmittedSolution &&
    !working &&
    !assessment.ready &&
    task?.status === "idle";
  const editor = (section: SectionKey, minHeight = "min-h-72") => (
    <Textarea
      id={`section-${section}`}
      aria-label={sectionLabels[section]}
      value={sections[section]}
      disabled={!!working}
      maxLength={limits[section]}
      onChange={(event) => updateSection(section, event.target.value)}
      className={`${minHeight} resize-y bg-background text-sm leading-7`}
    />
  );
  const chapterSuggestion = (section: SectionKey) => {
    const patch = task?.state.suggestions.find(
      (item) => item.section === section,
    );
    return patch ? (
      <section
        className="space-y-3 rounded-lg bg-muted/40 p-4"
        aria-label={`${sectionLabels[section]}优化建议`}
      >
        <p className="text-sm font-medium">优化建议</p>
        <p className="whitespace-pre-wrap text-sm leading-7">{patch.content}</p>
        <Button
          size="sm"
          disabled={!!working || dirty}
          onClick={() => void perform({ action: "accept", section })}
        >
          采用建议
        </Button>
      </section>
    ) : null;
  };

  return (
    <div
      className={`flex ${embedded ? "h-full" : "h-dvh"} min-h-0 min-w-0 flex-col overflow-hidden bg-background text-foreground`}
      data-disclosure-guided
      aria-busy={!!working}
    >
      {(!embedded || (step === 4 && onExit)) && (
        <header
          className={`flex shrink-0 flex-wrap items-center gap-3 px-4 py-3 sm:px-6 ${embedded ? "justify-end" : "justify-between border-b bg-card"}`}
        >
          {!embedded && (
            <div className="flex items-center gap-3">
              <span className="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <FilePenLine className="size-5" aria-hidden="true" />
              </span>
              <h1 className="text-base font-semibold">专利交底书</h1>
            </div>
          )}
          <div className="flex items-center gap-2">
            {embedded && step === 4 && onExit && (
              <Button
                variant="ghost"
                size="icon"
                className="text-foreground"
                aria-label="退出专利交底书模式"
                title="返回对话"
                onClick={() => void exit()}
              >
                <X aria-hidden="true" />
              </Button>
            )}
          </div>
        </header>
      )}
      <nav
        className="shrink-0 overflow-x-auto px-3 py-3 sm:px-6 sm:py-4"
        aria-label="交底书撰写步骤"
      >
        <ol className="mx-auto flex w-fit items-center gap-2 sm:gap-4">
          {writingSteps.map((label, index) => (
            <li key={label} className="flex items-center gap-2 sm:gap-4">
              {index > 0 && (
                <span
                  className="hidden h-px w-5 bg-border sm:block"
                  aria-hidden="true"
                />
              )}
              <button
                disabled={!!working || index > maxStep}
                onClick={() => void goTo(index)}
                aria-current={step === index ? "step" : undefined}
                aria-label={label}
                className={`flex min-h-10 items-center gap-1.5 rounded-md px-1 text-xs sm:px-2 sm:text-sm ${step === index ? "font-medium text-primary" : "text-muted-foreground"}`}
              >
                <span
                  className={`flex size-6 shrink-0 items-center justify-center rounded-full text-xs ${step === index ? "bg-primary text-primary-foreground" : "border bg-card"}`}
                >
                  {step > index ? (
                    <Check className="size-3.5" aria-hidden="true" />
                  ) : (
                    index + 1
                  )}
                </span>
                <span className="hidden min-[600px]:inline">{label}</span>
                <span className="hidden min-[360px]:inline min-[600px]:hidden">
                  {["信息", "背景", "方案", "效果", "文档"][index]}
                </span>
              </button>
            </li>
          ))}
        </ol>
      </nav>
      <main
        ref={content}
        className="custom-scrollbar min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-6 sm:px-6"
        data-disclosure-content
      >
        <div className="mx-auto max-w-4xl space-y-5 py-3 sm:py-5">
          {error && (
            <p
              role="alert"
              className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive"
            >
              {error}
            </p>
          )}
          {task?.status === "failed" && (
            <div role="alert" className="rounded-lg border bg-card p-4 text-sm">
              <p>{task.error || "处理未完成，已保留当前内容。"}</p>
              <Button
                variant="outline"
                size="sm"
                className="mt-3 text-foreground"
                disabled={!!working}
                onClick={() => void load(task.id)}
              >
                重新加载
              </Button>
            </div>
          )}
          <h2 className="text-xl font-semibold">{writingSteps[step]}</h2>
          {step === 0 && (
            <section
              className="grid gap-5 rounded-xl border bg-card p-4 sm:grid-cols-2 sm:p-6"
              aria-label="基本信息表单"
            >
              {(
                ["inventionName", "contactPerson", "technicalField"] as const
              ).map((field) => (
                <div
                  key={field}
                  className={field === "technicalField" ? "sm:col-span-2" : ""}
                >
                  <label
                    htmlFor={`basic-${field}`}
                    className="mb-2 block text-sm font-medium"
                  >
                    {sectionLabels[field]}
                  </label>
                  <Input
                    id={`basic-${field}`}
                    disabled={!!working}
                    maxLength={limits[field]}
                    value={sections[field]}
                    onChange={(event) =>
                      updateSection(field, event.target.value)
                    }
                  />
                </div>
              ))}
              <fieldset className="sm:col-span-2" disabled={!!working}>
                <legend className="mb-3 text-sm font-medium">申请类型</legend>
                <div className="flex flex-wrap gap-6">
                  {(["发明", "实用新型"] as const).map((type) => (
                    <label
                      key={type}
                      className="flex cursor-pointer items-center gap-2 text-sm"
                    >
                      <input
                        type="radio"
                        name="applicationType"
                        value={type}
                        checked={sections.applicationType === type}
                        onChange={() => updateSection("applicationType", type)}
                        className="size-4 accent-primary"
                      />
                      {type}
                    </label>
                  ))}
                </div>
              </fieldset>
            </section>
          )}
          {step === 1 && (
            <section className="space-y-4 rounded-xl border bg-card p-4 sm:p-6">
              {editor("techBackground")}
              <Button
                variant="outline"
                className="text-foreground"
                disabled={!!working || !sections.techBackground.trim()}
                onClick={() => void optimizeChapter("techBackground")}
              >
                <Sparkles aria-hidden="true" />
                AI 优化
              </Button>
              {chapterSuggestion("techBackground")}
            </section>
          )}
          {step === 2 && (
            <>
              {shownCoreReminder && (
                <p
                  role="status"
                  className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive dark:text-destructive-foreground"
                >
                  {assessment.message}
                </p>
              )}
              <div className="space-y-4" aria-label="技术方案分栏">
                {blocks.map((block, index) => (
                  <section
                    key={block.id}
                    className="space-y-3 rounded-xl border bg-card p-4 sm:p-5"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <label
                        htmlFor={`solution-${block.id}`}
                        className="text-sm font-medium"
                      >
                        方案描述 {index + 1}
                      </label>
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-primary"
                          disabled={!!working || !block.content.trim()}
                          onClick={() => void optimize(block.id)}
                        >
                          <Sparkles aria-hidden="true" />
                          AI 优化
                        </Button>
                        {blocks.length > 1 && (
                          <Button
                            size="icon-sm"
                            variant="ghost"
                            aria-label={`删除描述 ${index + 1}`}
                            disabled={!!working}
                            onClick={() =>
                              setBlocks((prev) =>
                                prev.filter((item) => item.id !== block.id),
                              )
                            }
                          >
                            <Trash2 />
                          </Button>
                        )}
                      </div>
                    </div>
                    <Textarea
                      id={`solution-${block.id}`}
                      disabled={!!working}
                      value={block.content}
                      maxLength={40000}
                      onChange={(event) =>
                        setBlocks((prev) =>
                          prev.map((item) =>
                            item.id === block.id
                              ? { ...item, content: event.target.value }
                              : item,
                          ),
                        )
                      }
                      className="min-h-40 resize-y bg-background text-sm leading-7"
                    />
                  </section>
                ))}
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="text-foreground"
                  disabled={!!working || blocks.length >= 40}
                  onClick={() =>
                    setBlocks((prev) => [
                      ...prev,
                      { id: crypto.randomUUID(), content: "" },
                    ])
                  }
                >
                  <Plus aria-hidden="true" />
                  添加描述
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="text-foreground"
                  disabled={!!working || (task?.state.images.length ?? 0) >= 10}
                  onClick={() => solutionImageInput.current?.click()}
                >
                  <ImagePlus aria-hidden="true" />
                  添加图片
                </Button>
                <input
                  ref={solutionImageInput}
                  type="file"
                  accept=".png,.jpg,.jpeg,image/png,image/jpeg"
                  aria-label="上传方案图片"
                  className="hidden"
                  disabled={!!working || (task?.state.images.length ?? 0) >= 10}
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    event.target.value = "";
                    if (file) void upload(file);
                  }}
                />
              </div>
              {!!task?.state.images.length && (
                <section
                  className="space-y-4 rounded-xl border bg-card p-4 sm:p-5"
                  aria-label="方案附图"
                >
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <h3 className="text-sm font-medium">附图</h3>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-primary"
                      disabled={!!working}
                      onClick={() => void perform({ action: "check-images" })}
                    >
                      检测图片
                    </Button>
                  </div>
                  <div className="grid gap-4 sm:grid-cols-2">
                    {task.state.images.map((image, index) => (
                      <figure
                        key={image.id}
                        className="min-w-0 space-y-3 rounded-lg border bg-background p-3"
                      >
                        <img
                          src={`/api/agent/disclosures/${task.id}/assets/${image.id}`}
                          alt={captions[image.id] || `图${index + 1}`}
                          className="h-44 w-full rounded object-contain"
                        />
                        <div className="flex items-center justify-between">
                          <span className="text-xs text-muted-foreground">
                            图{index + 1}
                          </span>
                          <Button
                            size="icon-sm"
                            variant="ghost"
                            aria-label={`删除图${index + 1}`}
                            disabled={!!working}
                            onClick={() =>
                              void perform({
                                action: "remove-image",
                                imageId: image.id,
                              })
                            }
                          >
                            <Trash2 />
                          </Button>
                        </div>
                        <Input
                          aria-label={`图${index + 1}说明`}
                          value={captions[image.id] ?? image.caption}
                          maxLength={1000}
                          disabled={!!working}
                          placeholder="附图说明"
                          onChange={(event) =>
                            setCaptions((prev) => ({
                              ...prev,
                              [image.id]: event.target.value,
                            }))
                          }
                        />
                        <p className="text-xs leading-5 text-muted-foreground">
                          <span
                            className={
                              ["warning", "failed"].includes(image.detection)
                                ? "font-medium text-destructive dark:text-destructive-foreground"
                                : undefined
                            }
                          >
                            {image.detection === "passed"
                              ? "格式检测通过"
                              : image.reason || "图片尚未检测"}
                          </span>
                          {image.review && (
                            <span
                              className={
                                ["warning", "failed"].includes(
                                  image.review.status,
                                )
                                  ? "font-medium text-destructive dark:text-destructive-foreground"
                                  : undefined
                              }
                            >
                              ；{image.review.summary}
                            </span>
                          )}
                        </p>
                      </figure>
                    ))}
                  </div>
                </section>
              )}
              {suggestion && (
                <section
                  className="space-y-3 rounded-xl border bg-card p-4"
                  aria-label="语言优化建议"
                >
                  <h3 className="text-sm font-medium">语言优化建议</h3>
                  <p className="whitespace-pre-wrap break-words text-sm leading-7">
                    {suggestion.content}
                  </p>
                  <Button
                    size="sm"
                    disabled={!!working || dirty}
                    onClick={() =>
                      void perform({
                        action: "accept",
                        section: "technicalSolution",
                      })
                    }
                  >
                    采用建议
                  </Button>
                </section>
              )}
              {!!solutionIssues.length && (
                <details className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-destructive dark:text-destructive-foreground">
                  <summary className="cursor-pointer text-sm font-medium">
                    检查提醒（{solutionIssues.length}）
                  </summary>
                  <ul className="mt-3 list-disc space-y-2 ps-5 text-sm">
                    {[...new Set(solutionIssues)]
                      .filter(
                        (text) =>
                          !shownCoreReminder || text !== assessment.message,
                      )
                      .map((text) => (
                        <li key={text}>{text}</li>
                      ))}
                  </ul>
                </details>
              )}
              <section
                className="space-y-4 rounded-xl border bg-card p-4 sm:p-5"
                aria-label="关键术语释义"
              >
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <h3 className="text-sm font-medium">关键术语释义</h3>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-primary"
                      disabled={
                        !!working ||
                        !blocks.some((block) => block.content.trim())
                      }
                      onClick={() => void perform({ action: "explain-terms" })}
                    >
                      提取术语
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-foreground"
                      disabled={!!working || keywords.length >= 30}
                      onClick={() =>
                        setKeywords((prev) => [
                          ...prev,
                          { term: "", definition: "" },
                        ])
                      }
                    >
                      <Plus aria-hidden="true" />
                      添加
                    </Button>
                  </div>
                </div>
                {keywords.map((item, index) => (
                  <div key={index} className="flex min-w-0 items-start gap-2">
                    <div className="grid min-w-0 flex-1 gap-2 sm:grid-cols-[1fr_3fr]">
                      <Input
                        aria-label={`术语 ${index + 1}`}
                        value={item.term}
                        maxLength={300}
                        disabled={!!working}
                        placeholder="术语"
                        onChange={(event) =>
                          setKeywords((prev) =>
                            prev.map((entry, i) =>
                              i === index
                                ? { ...entry, term: event.target.value }
                                : entry,
                            ),
                          )
                        }
                      />
                      <Textarea
                        aria-label={`释义 ${index + 1}`}
                        value={item.definition}
                        maxLength={3000}
                        disabled={!!working}
                        placeholder="释义"
                        className="min-h-9 resize-y text-sm"
                        onChange={(event) =>
                          setKeywords((prev) =>
                            prev.map((entry, i) =>
                              i === index
                                ? { ...entry, definition: event.target.value }
                                : entry,
                            ),
                          )
                        }
                      />
                    </div>
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      aria-label={`删除术语 ${index + 1}`}
                      disabled={!!working}
                      onClick={() =>
                        setKeywords((prev) =>
                          prev.filter((_, i) => i !== index),
                        )
                      }
                    >
                      <Trash2 />
                    </Button>
                  </div>
                ))}
              </section>
            </>
          )}
          {step === 3 && (
            <>
              {(["beneficialEffects", "protectionPoints"] as const).map(
                (field) => (
                  <section
                    key={field}
                    className="space-y-3 rounded-xl border bg-card p-4 sm:p-6"
                  >
                    <label
                      htmlFor={`section-${field}`}
                      className="block text-sm font-medium"
                    >
                      {sectionLabels[field]}
                    </label>
                    {editor(field, "min-h-48")}
                    <Button
                      variant="outline"
                      className="text-foreground"
                      disabled={!!working || !sections[field].trim()}
                      onClick={() => void optimizeChapter(field)}
                    >
                      <Sparkles aria-hidden="true" />
                      AI 优化
                    </Button>
                    {chapterSuggestion(field)}
                  </section>
                ),
              )}
            </>
          )}
          {step === 4 && (
            <>
              <DocumentPreview task={task} />
              {!!task?.state.issues.length && (
                <details className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-destructive dark:text-destructive-foreground">
                  <summary className="cursor-pointer text-sm font-medium">
                    待复核事项（{task.state.issues.length}）
                  </summary>
                  <ul className="mt-3 list-disc space-y-2 ps-5 text-sm">
                    {task.state.issues.map((issue, index) => (
                      <li key={index}>{issue.message}</li>
                    ))}
                  </ul>
                </details>
              )}
              <label className="flex cursor-pointer items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className="size-4 accent-primary"
                  checked={confirmed}
                  disabled={!!working}
                  onChange={(event) => setConfirmed(event.target.checked)}
                />
                我已核查文档内容
              </label>
            </>
          )}
        </div>
      </main>
      <div
        className="shrink-0 border-t bg-background px-4 py-3 sm:px-6"
        data-disclosure-stage-action
      >
        <div className="mx-auto flex max-w-4xl flex-wrap items-center justify-between gap-3">
          <div className="flex gap-2">
            {step > 0 && (
              <Button
                variant="outline"
                size="sm"
                className="text-foreground"
                disabled={!!working}
                onClick={() => void goTo(step - 1)}
              >
                <ArrowLeft aria-hidden="true" />
                上一步
              </Button>
            )}
            <span
              role="status"
              className="self-center text-xs text-muted-foreground"
            >
              {saving
                ? "保存中…"
                : saveError
                  ? "自动保存失败，内容仍在本页"
                  : dirty
                    ? "待保存"
                    : task
                      ? "已自动保存"
                      : ""}
            </span>
            {saveError && (
              <Button
                size="sm"
                variant="ghost"
                disabled={!!working || saving}
                onClick={() => void autosaveRef.current()}
                title={saveError}
              >
                重试保存
              </Button>
            )}
          </div>
          <Button
            disabled={
              !!working ||
              !!message.trim() ||
              (step === 4 &&
                (!confirmed ||
                  dirty ||
                  !!(task && missingWritingFields(task.state, 4).length)))
            }
            onClick={() => void (step === 4 ? exportFile() : nextStep())}
          >
            {working ? (
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            ) : step === 4 ? (
              <Download aria-hidden="true" />
            ) : null}
            {step === 4 ? "下载 Word" : step === 3 ? "生成文档" : "下一步"}
            {step < 4 && <ArrowRight aria-hidden="true" />}
          </Button>
        </div>
      </div>
      {step < 4 && (
        <footer
          className="shrink-0 bg-background pt-2"
          data-disclosure-composer
        >
          <ChatInput
            mode="disclosure"
            value={message}
            onValueChange={setMessage}
            onSend={() => void send()}
            disabled={!!working}
            onUpload={(file) => void upload(file)}
            onExitDisclosure={onExit ? () => void exit() : undefined}
            onOptimize={step === 2 ? () => void optimize() : undefined}
            optimizeDisabled={!blocks.some((block) => block.content.trim())}
          />
        </footer>
      )}
      <DisclosureTools
        panel={panel}
        onClose={() => setPanel(null)}
        task={task}
        tasks={tasks}
        working={!!working}
        editing={dirty}
        error={error}
        load={load}
        newTask={newTask}
        perform={perform}
        openSection={openSection}
      />
    </div>
  );
}

function DocumentPreview({ task }: { task: DisclosureTask | null }) {
  if (!task) return null;
  return (
    <article
      className="space-y-6 rounded-xl border bg-card p-4 sm:p-6"
      aria-label="交底书文档预览"
    >
      {sectionKeys.map((field) => (
        <section key={field}>
          <h3 className="mb-2 text-sm font-semibold">{sectionLabels[field]}</h3>
          <p className="whitespace-pre-wrap break-words text-sm leading-7">
            {task.state.sections[field]}
          </p>
        </section>
      ))}
      {!!task.state.keywords?.length && (
        <section>
          <h3 className="mb-2 text-sm font-semibold">关键术语释义</h3>
          <dl className="space-y-2 text-sm leading-6">
            {task.state.keywords.map((item, index) => (
              <div key={index}>
                <dt className="font-medium">{item.term}</dt>
                <dd>{item.definition}</dd>
              </div>
            ))}
          </dl>
        </section>
      )}
      {task.state.images.map((image, index) => (
        <figure key={image.id}>
          <img
            src={`/api/agent/disclosures/${task.id}/assets/${image.id}`}
            alt={image.caption || image.name}
            className="mx-auto max-h-80 max-w-full object-contain"
          />
          <figcaption className="mt-2 text-center text-xs text-muted-foreground">
            图{index + 1} {image.caption || image.name}
          </figcaption>
        </figure>
      ))}
    </article>
  );
}
