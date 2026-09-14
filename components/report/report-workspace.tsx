"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  CircleAlert,
  Download,
  FileText,
  Loader2,
  RotateCcw,
  Upload,
} from "lucide-react";
import {
  ChatSidebar,
  type SidebarConversation,
} from "@/components/chat-sidebar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

type Patent = {
  id: string;
  docNumber: string;
  title: string;
  abstract: string;
  pubDate: string;
  applicant: string;
  ipcCodes: string[];
  retrievalRouteIds?: string[];
};

type Classification = {
  patent: Patent;
  classification: {
    category: "X" | "Y" | "A" | "EXCLUDE" | "REVIEW_REQUIRED";
    subtype?: string;
    requiresHumanReview?: boolean;
    riskFlags?: string[];
    confidence: "高" | "中" | "低";
    conclusion: string;
    metrics?: {
      coverageRate: number;
      weightedCoverageRate: number;
      innovationOverlap: boolean;
      combinationRequired: boolean;
      combinedCoverageRate: number;
      motivationScore: "High" | "Low";
      combinationDocumentIds: string[];
      motivationReason: string;
      closestDocumentId?: string;
      featureGapIds: string[];
    };
    evidenceChain?: {
      abstractScreening: "进入深度比对" | "摘要不相关" | "摘要不足";
      abstractReason: string;
      claimComparison: "已完成" | "缺少权利要求" | "未进入";
      fullTextVerification: "已完成" | "材料不足" | "未进入";
      availableSections: Array<"claims" | "description" | "drawings">;
    };
    featureMappings: Array<{
      targetFeature: string;
      referenceDisclosure: string;
      assessment: "已披露" | "未披露" | "部分披露";
    }>;
    reviewNote: string;
  };
};

type ReportTask = {
  id: string;
  conversationId: string;
  status: string;
  currentStage: string;
  state: any;
  errorMessage: string | null;
  pendingApproval: {
    reportId: string;
    kind:
      | "strategy"
      | "document-selection"
      | "classification-review"
      | "evaluation-input"
      | "final-report";
    title: string;
    data: any;
  } | null;
};

const initialEvaluation = {
  isUsedOnProduct: false,
  isUsedOnMarketProduct: false,
  enforceability: "低" as "高" | "低" | "无",
  isStandardEssentialPatent: false,
  pointName: "核心发明点",
  yCombinationObvious: false,
  isCommonKnowledgeOrObvious: false,
};

export function ReportWorkspace() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [conversations, setConversations] = useState<SidebarConversation[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<
    string | null
  >(null);
  const [report, setReport] = useState<ReportTask | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [strategy, setStrategy] = useState<any>(null);
  const [targetClaimsText, setTargetClaimsText] = useState("");
  const [selectedPatentIds, setSelectedPatentIds] = useState<string[]>([]);
  const [classifications, setClassifications] = useState<Classification[]>([]);
  const [evaluation, setEvaluation] = useState(initialEvaluation);
  const [conclusion, setConclusion] = useState("");

  const loadConversations = async () => {
    const response = await fetch("/api/agent/conversations");
    if (!response.ok) return;
    const payload = (await response.json()) as { items: SidebarConversation[] };
    setConversations(payload.items);
  };

  useEffect(() => {
    void loadConversations();
  }, []);

  useEffect(() => {
    const pending = report?.pendingApproval;
    if (!pending) return;
    if (pending.kind === "strategy")
      setStrategy(pending.data?.strategy || null);
    if (pending.kind === "strategy")
      setTargetClaimsText(pending.data?.targetClaimsText || "");
    if (pending.kind === "document-selection")
      setSelectedPatentIds(pending.data?.selectedPatentIds || []);
    if (pending.kind === "classification-review")
      setClassifications(pending.data || []);
    if (pending.kind === "evaluation-input") setEvaluation(initialEvaluation);
    if (pending.kind === "final-report")
      setConclusion(pending.data?.conclusion || "");
  }, [report?.id, report?.currentStage]);

  const selectConversation = async (conversationId: string) => {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(
        `/api/agent/reports?conversationId=${encodeURIComponent(conversationId)}`,
      );
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "读取报告任务失败");
      setActiveConversationId(conversationId);
      setReport(payload.report);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "读取报告任务失败");
    } finally {
      setBusy(false);
    }
  };

  const createReport = async () => {
    if (!file) return;
    setBusy(true);
    setError("");
    try {
      const formData = new FormData();
      formData.append("file", file);
      const response = await fetch("/api/agent/reports", {
        method: "POST",
        body: formData,
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "创建报告任务失败");
      setReport(payload.report);
      setActiveConversationId(payload.conversation.id);
      await loadConversations();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "创建报告任务失败");
    } finally {
      setBusy(false);
    }
  };

  const resume = async (
    kind: NonNullable<ReportTask["pendingApproval"]>["kind"],
    decision: "approve" | "cancel",
    data?: unknown,
  ) => {
    if (!report) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/agent/reports/${report.id}/resume`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind, decision, data }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "报告流程执行失败");
      setReport(payload.report);
      await loadConversations();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "报告流程执行失败");
    } finally {
      setBusy(false);
    }
  };

  const returnToPreviousStep = async (
    kind: Exclude<
      NonNullable<ReportTask["pendingApproval"]>["kind"],
      "strategy"
    >,
  ) => {
    if (!report) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/agent/reports/${report.id}/back`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "返回上一步失败");
      setReport(payload.report);
      await loadConversations();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "返回上一步失败");
    } finally {
      setBusy(false);
    }
  };

  const deleteHistoryConversation = async (conversationId: string) => {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(
        `/api/agent/conversations/${conversationId}`,
        { method: "DELETE" },
      );
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "删除对话失败");
      if (conversationId === activeConversationId) {
        setReport(null);
        setActiveConversationId(null);
      }
      await loadConversations();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "删除对话失败");
    } finally {
      setBusy(false);
    }
  };

  const exportReport = async () => {
    if (!report) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/agent/reports/${report.id}/export`, {
        method: "POST",
      });
      if (!response.ok) {
        const payload = await response.json();
        throw new Error(payload.error || "报告导出失败");
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `${report.state?.disclosure?.inventionName || "专利检索报告"}.docx`;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "报告导出失败");
    } finally {
      setBusy(false);
    }
  };

  const pending = report?.pendingApproval;
  const statusLabel =
    {
      active: "执行中",
      awaiting_approval: "等待人工确认",
      completed: "已完成",
      failed: "执行失败",
      cancelled: "已取消",
    }[report?.status || ""] || report?.status;
  const resetToUpload = () => {
    setReport(null);
    setActiveConversationId(null);
    setFile(null);
    setError("");
  };
  const isLegacyIncompleteTask =
    report?.status === "active" &&
    report.currentStage === "initializing" &&
    !report.state &&
    !pending;
  const patents = (
    pending?.kind === "document-selection" ? pending.data?.items : []
  ) as Patent[];
  const screeningById = new Map<
    string,
    { id: string; reason: string; matchedFeatureIds?: string[] }
  >(
    (
      pending?.kind === "document-selection" ? pending.data?.screening : []
    ).map((item: { id: string; reason: string; matchedFeatureIds?: string[] }) => [
      item.id,
      item,
    ]),
  );
  const categoryCounts = useMemo(() => {
    const counts = { X: 0, Y: 0, A: 0 };
    for (const item of classifications) {
      if (item.classification.category in counts)
        counts[item.classification.category as "X" | "Y" | "A"]++;
    }
    return counts;
  }, [classifications]);

  return (
    <main className="flex h-screen min-h-0 bg-background">
      <ChatSidebar
        conversations={conversations}
        activeConversationId={activeConversationId}
        onNewChat={() => {
          setReport(null);
          setActiveConversationId(null);
          setFile(null);
          setError("");
        }}
        onSelectConversation={selectConversation}
        onDeleteConversation={deleteHistoryConversation}
        mode="report"
      />
      <section className="min-w-0 flex-1 overflow-y-auto">
        <header className="sticky top-0 z-10 flex h-14 items-center border-b bg-card px-6">
          <FileText className="mr-2 h-5 w-5" />
          <span className="font-semibold">专利检索报告智能体</span>
          <span className="ml-3 text-sm text-muted-foreground">
            人工确认 · 可恢复工作流
          </span>
        </header>
        <div className="mx-auto max-w-5xl space-y-5 p-6">
          {error && (
            <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
              {error}
            </div>
          )}
          {busy && (
            <div className="flex items-center gap-2 rounded-lg border bg-card p-3 text-sm">
              <Loader2 className="h-4 w-4 animate-spin" />
              智能体正在执行当前步骤，请稍候……
            </div>
          )}

          {!report && (
            <Card>
              <CardHeader>
                <CardTitle>上传专利交底书</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".docx"
                  className="hidden"
                  onChange={(event) => setFile(event.target.files?.[0] || null)}
                />
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="flex min-h-48 w-full flex-col items-center justify-center rounded-xl border-2 border-dashed p-8 hover:border-primary"
                >
                  <Upload className="mb-3 h-9 w-9 text-muted-foreground" />
                  <span className="font-medium">
                    {file?.name || "选择 DOCX 交底书"}
                  </span>
                  <span className="mt-1 text-sm text-muted-foreground">
                    最大 10MB
                  </span>
                </button>
                <Button onClick={createReport} disabled={!file || busy}>
                  开始生成检索报告
                </Button>
              </CardContent>
            </Card>
          )}

          {report && (
            <Card>
              <CardHeader>
                <CardTitle>
                  {report.state?.disclosure?.inventionName || "专利检索报告"}
                </CardTitle>
              </CardHeader>
              <CardContent className="flex flex-wrap gap-3 text-sm">
                <span>状态：{statusLabel}</span>
                <span>当前阶段：{report.currentStage}</span>
                <span>报告编号：{report.id}</span>
                {report.status === "failed" && (
                  <div className="basis-full rounded-md border border-destructive/30 bg-destructive/5 p-3 text-destructive">
                    失败原因：{report.errorMessage || "报告工作流执行失败"}
                  </div>
                )}
                {report.status === "failed" && (
                  <Button variant="outline" onClick={resetToUpload}>
                    重新上传交底书
                  </Button>
                )}
              </CardContent>
            </Card>
          )}

          {report?.state?.disclosure && !isLegacyIncompleteTask && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">任务概览</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <div className="grid gap-3 md:grid-cols-3">
                  <div>
                    <p className="text-muted-foreground">技术领域</p>
                    <p>{report.state.disclosure.technicalField || "未提取"}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">关键技术特征</p>
                    <p>
                      {report.state.disclosure.keyTechnicalFeatures.length} 项
                    </p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">检索关键词</p>
                    <p>{report.state.disclosure.searchKeywords.length} 个</p>
                  </div>
                </div>
                <div>
                  <p className="mb-1 text-muted-foreground">技术方案摘要</p>
                  <p className="line-clamp-3 leading-6">
                    {report.state.disclosure.technicalSolution || "未提取"}
                  </p>
                </div>
              </CardContent>
            </Card>
          )}

          {isLegacyIncompleteTask && (
            <Card className="border-amber-300 bg-amber-50/40">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <CircleAlert className="h-5 w-5 text-amber-600" />
                  该历史任务无法继续
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4 text-sm text-muted-foreground">
                <p>
                  此任务创建时未完整保存工作流上下文，因此没有可恢复的检索策略或待确认内容。
                </p>
                <Button onClick={resetToUpload}>
                  <RotateCcw className="mr-2 h-4 w-4" />
                  重新上传交底书
                </Button>
              </CardContent>
            </Card>
          )}

          {report?.status === "active" &&
            !isLegacyIncompleteTask &&
            !pending && (
              <Card>
                <CardContent className="flex items-center gap-3 p-5 text-sm text-muted-foreground">
                  <Loader2 className="h-5 w-5 animate-spin" />
                  正在执行“{report.currentStage}
                  ”步骤。完成后将自动进入下一项人工确认。
                </CardContent>
              </Card>
            )}

          {report?.status === "awaiting_approval" && !pending && (
            <Card className="border-destructive/40 bg-destructive/5">
              <CardContent className="space-y-3 p-5 text-sm">
                <p>该报告缺少待确认数据，暂时无法恢复。</p>
                <Button variant="outline" onClick={resetToUpload}>
                  重新上传交底书
                </Button>
              </CardContent>
            </Card>
          )}

          {pending?.kind === "strategy" && strategy && (
            <Card>
              <CardHeader>
                <CardTitle>{pending.title}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <Label>检索主题</Label>
                  <Input
                    value={strategy.topic || ""}
                    onChange={(e) =>
                      setStrategy({ ...strategy, topic: e.target.value })
                    }
                  />
                </div>
                <div>
                  <Label>关键词（每行一个）</Label>
                  <Textarea
                    value={(strategy.keywords || []).join("\n")}
                    onChange={(e) =>
                      setStrategy({
                        ...strategy,
                        keywords: e.target.value
                          .split(/\r?\n/)
                          .map((v) => v.trim())
                          .filter(Boolean),
                      })
                    }
                  />
                </div>
                <div>
                  <Label>IPC（每行一个，可清空）</Label>
                  <Textarea
                    value={(strategy.ipcCodes || []).join("\n")}
                    onChange={(e) =>
                      setStrategy({
                        ...strategy,
                        ipcCodes: e.target.value
                          .split(/\r?\n/)
                          .map((v) => v.trim())
                          .filter(Boolean),
                      })
                    }
                  />
                </div>
                {pending.data?.retrievalPlan?.routes?.length ? (
                  <div className="rounded-md bg-muted p-3 text-sm text-muted-foreground">
                    <p className="font-medium text-foreground">计划检索路径</p>
                    <ul className="mt-1 list-disc space-y-1 pl-5">
                      {pending.data.retrievalPlan.routes.map(
                        (route: { id: string; label: string }) => (
                          <li key={route.id}>{route.label}</li>
                        ),
                      )}
                    </ul>
                  </div>
                ) : null}
                <div>
                  <Label>权利要求草案（可选，一次一项）</Label>
                  <Textarea
                    value={targetClaimsText}
                    onChange={(e) => setTargetClaimsText(e.target.value)}
                    placeholder="可粘贴待申请方案的一项权利要求草案；不填写时，系统将按交底书技术方案和关键特征进行辅助比对。"
                    className="min-h-36"
                  />
                </div>
                <div className="flex gap-2">
                  <Button
                    disabled={busy || !strategy.keywords?.length}
                    onClick={() =>
                      resume("strategy", "approve", {
                        strategy,
                        targetClaimsText,
                      })
                    }
                  >
                    确认并检索
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => resume("strategy", "cancel")}
                  >
                    取消任务
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}

          {pending?.kind === "document-selection" && (
            <Card>
              <CardHeader>
                <CardTitle>{pending.title}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-sm text-muted-foreground">
                  以下文件已通过标题、摘要初筛，将进入权利要求和全文证据比对。
                  {pending.data?.retrievalRounds?.some(
                    (round: { status: string }) =>
                      round.status === "pending_vector_index",
                  )
                    ? " 语义检索通道已保留，待向量库接入后自动参与召回。"
                    : ""}
                </p>
                {patents.map((patent) => (
                  <label
                    key={patent.id}
                    className="flex gap-3 rounded-lg border p-3"
                  >
                    <Checkbox
                      checked={selectedPatentIds.includes(patent.id)}
                      onCheckedChange={(checked) =>
                        setSelectedPatentIds((ids) =>
                          checked
                            ? [...ids, patent.id].slice(0, 20)
                            : ids.filter((id) => id !== patent.id),
                        )
                      }
                    />
                    <span className="min-w-0">
                      <span className="block font-medium">{patent.title}</span>
                      <span className="text-sm text-muted-foreground">
                        {patent.docNumber} · {patent.applicant} ·{" "}
                        {patent.pubDate}
                      </span>
                      <span className="mt-1 line-clamp-2 block text-sm">
                        {patent.abstract}
                      </span>
                      <span className="mt-1 block text-xs text-muted-foreground">
                        初筛依据：{screeningById.get(patent.id)?.reason || "已进入深度比对"}
                        {patent.retrievalRouteIds?.length
                          ? ` · 命中 ${patent.retrievalRouteIds.length} 条检索路径`
                          : ""}
                      </span>
                    </span>
                  </label>
                ))}
                {patents.length === 0 && (
                  <p className="text-muted-foreground">
                    当前策略未检索到候选文献，请取消后重新创建任务并调整策略。
                  </p>
                )}
                <div className="flex gap-2">
                  <Button
                    disabled={busy || selectedPatentIds.length === 0}
                    onClick={() =>
                      resume("document-selection", "approve", {
                        selectedPatentIds,
                      })
                    }
                  >
                    分析所选 {selectedPatentIds.length} 件文献
                  </Button>
                  <Button
                    variant="outline"
                    disabled={busy}
                    onClick={() => returnToPreviousStep("document-selection")}
                  >
                    返回检索策略
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => resume("document-selection", "cancel")}
                  >
                    取消任务
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}

          {pending?.kind === "classification-review" && (
            <Card>
              <CardHeader>
                <CardTitle>{pending.title}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {classifications.map((item, index) => (
                  <div key={item.patent.id} className="rounded-lg border p-4">
                    <div className="mb-2 flex items-center justify-between gap-3">
                      <div>
                        <p className="font-medium">{item.patent.title}</p>
                        <p className="text-sm text-muted-foreground">
                          {item.patent.docNumber} · 置信度{" "}
                          {item.classification.confidence}
                        </p>
                      </div>
                      <Select
                        value={item.classification.category}
                        onValueChange={(
                          category: Classification["classification"]["category"],
                        ) =>
                          setClassifications((items) =>
                            items.map((value, i) =>
                              i === index
                                ? {
                                    ...value,
                                    classification: {
                                      ...value.classification,
                                      category,
                                    },
                                  }
                                : value,
                            ),
                          )
                        }
                      >
                        <SelectTrigger className="w-24">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="X">X</SelectItem>
                          <SelectItem value="Y">Y</SelectItem>
                          <SelectItem value="A">A</SelectItem>
                          <SelectItem value="EXCLUDE">不纳入报告</SelectItem>
                          <SelectItem value="REVIEW_REQUIRED">
                            待人工复核
                          </SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <p className="text-sm">{item.classification.conclusion}</p>
                    {item.classification.riskFlags?.length ? (
                      <p className="mt-2 text-xs text-amber-700">
                        风险项：{item.classification.riskFlags.join("、")}
                      </p>
                    ) : null}
                    <details className="mt-2 text-sm">
                      <summary className="cursor-pointer">
                        查看特征覆盖依据（仅完整披露计入覆盖率）
                      </summary>
                      <ul className="mt-2 space-y-2">
                        {item.classification.featureMappings.map(
                          (mapping, featureIndex) => (
                            <li key={featureIndex}>
                              <p>
                                {featureIndex + 1}. {mapping.targetFeature}：
                                {mapping.assessment}
                              </p>
                              <p className="text-muted-foreground">
                                {mapping.referenceDisclosure}
                              </p>
                            </li>
                          ),
                        )}
                      </ul>
                    </details>
                    {item.classification.metrics && (
                      <div className="mt-2 text-sm text-muted-foreground">
                        <p>
                          组合文献：
                          {item.classification.metrics.combinationDocumentIds
                            .map(
                              (id) =>
                                classifications.find(
                                  (entry) => entry.patent.id === id,
                                )?.patent.docNumber || id,
                            )
                            .join("、") || "无"}
                        </p>
                        <p>
                          最接近文件：
                          {item.classification.metrics.closestDocumentId
                            ? classifications.find(
                                (entry) =>
                                  entry.patent.id ===
                                  item.classification.metrics?.closestDocumentId,
                              )?.patent.docNumber ||
                              item.classification.metrics.closestDocumentId
                            : "无"}
                        </p>
                        <p>
                          关键缺口：
                          {item.classification.metrics.featureGapIds.length
                            ? item.classification.metrics.featureGapIds.join("、")
                            : "无"}
                        </p>
                        <p>
                          结合启示依据：
                          {item.classification.metrics.motivationReason}
                        </p>
                      </div>
                    )}
                    {item.classification.evidenceChain && (
                      <div className="mt-2 rounded-md bg-muted p-2 text-xs text-muted-foreground">
                        <p>
                          摘要初筛：
                          {item.classification.evidenceChain.abstractScreening}
                          （{item.classification.evidenceChain.abstractReason}）
                        </p>
                        <p>
                          权利要求拆解：
                          {item.classification.evidenceChain.claimComparison}
                          ；说明书/附图核验：
                          {
                            item.classification.evidenceChain
                              .fullTextVerification
                          }
                        </p>
                      </div>
                    )}
                    <p className="mt-2 text-xs text-muted-foreground">
                      {item.classification.reviewNote}
                    </p>
                  </div>
                ))}
                <div className="flex gap-2">
                  <Button
                    disabled={busy}
                    onClick={() =>
                      resume("classification-review", "approve", {
                        classifications,
                      })
                    }
                  >
                    确认分类结果
                  </Button>
                  <Button
                    variant="outline"
                    disabled={busy}
                    onClick={() =>
                      returnToPreviousStep("classification-review")
                    }
                  >
                    返回文献选择
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => resume("classification-review", "cancel")}
                  >
                    取消任务
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}

          {pending?.kind === "evaluation-input" && (
            <Card>
              <CardHeader>
                <CardTitle>{pending.title}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-4 md:grid-cols-2">
                  <label className="flex items-center gap-2">
                    <Checkbox
                      checked={evaluation.isUsedOnProduct}
                      onCheckedChange={(value) =>
                        setEvaluation({
                          ...evaluation,
                          isUsedOnProduct: Boolean(value),
                        })
                      }
                    />
                    已用于或计划用于产品
                  </label>
                  <label className="flex items-center gap-2">
                    <Checkbox
                      checked={evaluation.isUsedOnMarketProduct}
                      onCheckedChange={(value) =>
                        setEvaluation({
                          ...evaluation,
                          isUsedOnMarketProduct: Boolean(value),
                        })
                      }
                    />
                    已用于上市产品
                  </label>
                  <label className="flex items-center gap-2">
                    <Checkbox
                      checked={evaluation.isStandardEssentialPatent}
                      onCheckedChange={(value) =>
                        setEvaluation({
                          ...evaluation,
                          isStandardEssentialPatent: Boolean(value),
                        })
                      }
                    />
                    标准必要专利
                  </label>
                  <div>
                    <Label>可维权性</Label>
                    <Select
                      value={evaluation.enforceability}
                      onValueChange={(value: "高" | "低" | "无") =>
                        setEvaluation({ ...evaluation, enforceability: value })
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="高">高</SelectItem>
                        <SelectItem value="低">低</SelectItem>
                        <SelectItem value="无">无</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div>
                  <Label>发明点名称</Label>
                  <Input
                    value={evaluation.pointName}
                    onChange={(e) =>
                      setEvaluation({
                        ...evaluation,
                        pointName: e.target.value,
                      })
                    }
                  />
                </div>
                <label className="flex items-center gap-2">
                  <Checkbox
                    checked={evaluation.yCombinationObvious}
                    onCheckedChange={(value) =>
                      setEvaluation({
                        ...evaluation,
                        yCombinationObvious: Boolean(value),
                      })
                    }
                  />
                  Y 类文献组合属于容易想到
                </label>
                <label className="flex items-center gap-2">
                  <Checkbox
                    checked={evaluation.isCommonKnowledgeOrObvious}
                    onCheckedChange={(value) =>
                      setEvaluation({
                        ...evaluation,
                        isCommonKnowledgeOrObvious: Boolean(value),
                      })
                    }
                  />
                  属于公知常识或明显惯用手段
                </label>
                <div className="flex gap-2">
                  <Button
                    disabled={busy || !evaluation.pointName.trim()}
                    onClick={() =>
                      resume("evaluation-input", "approve", {
                        evaluationInput: {
                          isUsedOnProduct: evaluation.isUsedOnProduct,
                          isUsedOnMarketProduct:
                            evaluation.isUsedOnMarketProduct,
                          enforceability: evaluation.enforceability,
                          isStandardEssentialPatent:
                            evaluation.isStandardEssentialPatent,
                          relatedADocumentCount: categoryCounts.A,
                          inventionPoints: [
                            {
                              name: evaluation.pointName,
                              hasXDocument: categoryCounts.X > 0,
                              yDocumentCount: categoryCounts.Y,
                              yCombinationObvious:
                                evaluation.yCombinationObvious,
                              isCommonKnowledgeOrObvious:
                                evaluation.isCommonKnowledgeOrObvious,
                            },
                          ],
                        },
                      })
                    }
                  >
                    确认并执行规则评级
                  </Button>
                  <Button
                    variant="outline"
                    disabled={busy}
                    onClick={() => returnToPreviousStep("evaluation-input")}
                  >
                    返回分类复核
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => resume("evaluation-input", "cancel")}
                  >
                    取消任务
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}

          {pending?.kind === "final-report" && (
            <Card>
              <CardHeader>
                <CardTitle>{pending.title}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="rounded-lg border bg-muted/30 p-4 text-sm">
                  <p>用途前景：{pending.data?.evaluation?.usageProspect}</p>
                  <p>
                    授权前景：{pending.data?.evaluation?.authorizationProspect}
                  </p>
                  <p>提案等级：{pending.data?.evaluation?.proposalGrade}</p>
                  <p>
                    建议申请类型：{pending.data?.evaluation?.applicationType}
                  </p>
                </div>
                <div>
                  <Label>结论与建议</Label>
                  <Textarea
                    className="min-h-72"
                    value={conclusion}
                    onChange={(e) => setConclusion(e.target.value)}
                  />
                </div>
                <div className="flex gap-2">
                  <Button
                    disabled={busy || !conclusion.trim()}
                    onClick={() =>
                      resume("final-report", "approve", { conclusion })
                    }
                  >
                    确认最终报告
                  </Button>
                  <Button
                    variant="outline"
                    disabled={busy}
                    onClick={() => returnToPreviousStep("final-report")}
                  >
                    返回提案评级
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => resume("final-report", "cancel")}
                  >
                    取消任务
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}

          {report?.status === "completed" && (
            <Card>
              <CardHeader>
                <CardTitle>报告已完成</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <p className="whitespace-pre-wrap text-sm">
                  {report.state?.conclusion}
                </p>
                <Button onClick={exportReport} disabled={busy}>
                  <Download className="mr-2 h-4 w-4" />
                  导出 DOCX
                </Button>
              </CardContent>
            </Card>
          )}
        </div>
      </section>
    </main>
  );
}
