"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, FileSearch, FileText, Upload, X } from "lucide-react";
import { toast } from "sonner";
import {
  ChatSidebar,
  type SidebarConversation,
} from "@/components/chat-sidebar";
import {
  AnalysisWorkflow,
  type PatentAnalysisData,
  type PatentAnalysisSummaryData,
} from "@/components/workflows/analysis-workflow";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const MAX_FILE_SIZE = 100 * 1024 * 1024;
const MAX_DOCUMENTS = 10;
const MAX_FIGURES = 10;

type AnalysisPayload = {
  analyses: PatentAnalysisData[];
  summary?: PatentAnalysisSummaryData;
};

function isAnalysisPayload(value: unknown): value is AnalysisPayload {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return Array.isArray(record.analyses);
}

function isDocument(file: File) {
  return /\.(docx|pdf)$/i.test(file.name);
}

function isFigure(file: File) {
  return /\.(png|jpe?g)$/i.test(file.name);
}

function formatFileSize(bytes: number) {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB（${bytes.toLocaleString()} 字节）`;
}

export default function PatentParsePage() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [dragging, setDragging] = useState(false);
  const [loading, setLoading] = useState(false);
  const [history, setHistory] = useState<SidebarConversation[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [result, setResult] = useState<AnalysisPayload | null>(null);

  const loadHistory = useCallback(async () => {
    try {
      // 共用侧栏需要所有功能的历史，由 ChatSidebar 按类型分组。
      const response = await fetch("/api/agent/conversations");
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "读取失败");
      setHistory(data.items || []);
    } catch {
      toast.error("读取历史记录失败，请刷新重试");
    }
  }, []);

  useEffect(() => {
    void loadHistory();
  }, [loadHistory]);

  const addFiles = (candidates: File[]) => {
    const accepted: File[] = [];
    for (const file of candidates) {
      if (!isDocument(file) && !isFigure(file)) {
        toast.error(`${file.name} 格式不支持`, {
          description: "请上传 DOCX、PDF、PNG 或 JPEG 文件。",
        });
        continue;
      }
      if (!file.size) {
        toast.error(`${file.name} 无法读取`, {
          description:
            "浏览器未读取到文件内容（0 字节）。请先将文件完整下载或另存到本地磁盘，再重新选择。",
        });
        continue;
      }
      if (file.size > MAX_FILE_SIZE) {
        toast.error(`${file.name} 文件过大`, {
          description: `浏览器读取为 ${formatFileSize(file.size)}；单个文件不得超过 100MB。`,
        });
        continue;
      }
      accepted.push(file);
    }
    setFiles((current) => {
      const next = [...current, ...accepted];
      const documentCount = next.filter(isDocument).length;
      const figureCount = next.filter(isFigure).length;
      if (documentCount > MAX_DOCUMENTS || figureCount > MAX_FIGURES) {
        toast.error("文件数量超出上限", {
          description: `一次最多 ${MAX_DOCUMENTS} 份文献和 ${MAX_FIGURES} 张补充附图。`,
        });
        return current;
      }
      return next;
    });
  };

  const parseFiles = async () => {
    const documents = files.filter(isDocument);
    if (!documents.length) {
      toast.error("请先上传 DOCX 或 PDF 专利文献");
      return;
    }
    setLoading(true);
    try {
      const formData = new FormData();
      files.forEach((file) => formData.append("files", file));
      const response = await fetch("/api/patent/parse/files", {
        method: "POST",
        body: formData,
      });
      const data = await response.json();
      if (!response.ok || !data.success)
        throw new Error(data.error || "专利文件解析失败");
      const payload = data.data as AnalysisPayload;
      setResult(payload);
      const title =
        documents.length === 1
          ? documents[0].name.replace(/\.(docx|pdf)$/i, "")
          : `${documents[0].name.replace(/\.(docx|pdf)$/i, "")}等${documents.length}份专利`;
      const saved = await fetch("/api/agent/analysis", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, ...payload }),
      });
      const conversation = await saved.json();
      if (!saved.ok) {
        toast.error("解析完成，但历史记录保存失败", {
          description: conversation.error || "请稍后重试保存。",
        });
        return;
      }
      setActiveId(conversation.id);
      setHistory((current) => [
        conversation,
        ...current.filter((item) => item.id !== conversation.id),
      ]);
      toast.success("解析完成", {
        description: `已完成 ${documents.length} 份专利文献的解析。`,
      });
    } catch (error) {
      toast.error("解析失败", {
        description:
          error instanceof Error ? error.message : "网络或服务器错误。",
      });
    } finally {
      setLoading(false);
    }
  };

  const selectHistory = async (id: string) => {
    try {
      const response = await fetch(`/api/agent/conversations/${id}`);
      const data = await response.json();
      if (!response.ok || !isAnalysisPayload(data.searchResults))
        throw new Error(data.error || "该历史记录没有可读取的解析结果");
      setResult(data.searchResults);
      setActiveId(id);
    } catch (error) {
      toast.error("无法打开解析历史", {
        description: error instanceof Error ? error.message : "请稍后重试。",
      });
    }
  };

  const deleteHistory = async (id: string) => {
    try {
      const response = await fetch(`/api/agent/conversations/${id}`, {
        method: "DELETE",
      });
      if (!response.ok) throw new Error("删除失败");
      setHistory((current) => current.filter((item) => item.id !== id));
      if (activeId === id) {
        setActiveId(null);
        setResult(null);
      }
    } catch {
      toast.error("删除解析历史失败");
    }
  };

  const renameHistory = async (id: string, title: string) => {
    const response = await fetch(`/api/agent/conversations/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "重命名失败");
    setHistory((current) =>
      current.map((item) => (item.id === id ? { ...item, title } : item)),
    );
  };

  const reset = () => {
    setFiles([]);
    setResult(null);
    setActiveId(null);
    if (inputRef.current) inputRef.current.value = "";
  };

  return (
    <div className="flex h-screen min-h-0 bg-background">
      <ChatSidebar
        mode="analysis"
        conversations={history}
        activeConversationId={activeId}
        onNewChat={reset}
        onSelectConversation={selectHistory}
        onDeleteConversation={deleteHistory}
        onRenameConversation={renameHistory}
      />
      {result ? (
        <AnalysisWorkflow
          analyses={result.analyses}
          summary={result.summary}
          onBack={reset}
        />
      ) : (
        <main className="flex min-w-0 flex-1 overflow-y-auto">
          <div className="mx-auto flex w-full max-w-4xl flex-col px-4 py-8 sm:px-8 sm:py-12">
            <Button
              asChild
              variant="ghost"
              size="sm"
              className="mb-5 w-fit gap-2"
            >
              <Link href="/qa">
                <ArrowLeft className="h-4 w-4" />
                返回首页
              </Link>
            </Button>
            <div>
              <h1 className="mt-2 text-3xl font-semibold tracking-tight">
                专利解析
              </h1>
              <p className="mt-3 max-w-2xl leading-7 text-muted-foreground">
                上传专利 DOCX 或可复制文字的 PDF，并附上 PNG/JPEG
                专利附图。系统会结合文字与可读图像，提取技术领域、技术问题、技术方案和技术效果；多份文献会生成共性与差异总结。
              </p>
            </div>

            <section className="mt-8 rounded-2xl border bg-card p-5 shadow-sm sm:p-6">
              <input
                ref={inputRef}
                type="file"
                accept=".docx,.pdf,.png,.jpg,.jpeg"
                multiple
                className="hidden"
                onChange={(event) =>
                  addFiles(Array.from(event.target.files || []))
                }
              />
              <button
                type="button"
                onClick={() => inputRef.current?.click()}
                onDragOver={(event) => {
                  event.preventDefault();
                  setDragging(true);
                }}
                onDragLeave={() => setDragging(false)}
                onDrop={(event) => {
                  event.preventDefault();
                  setDragging(false);
                  addFiles(Array.from(event.dataTransfer.files));
                }}
                className={cn(
                  "flex min-h-48 w-full flex-col items-center justify-center rounded-xl border-2 border-dashed p-6 text-center transition-colors",
                  dragging
                    ? "border-primary bg-primary/5"
                    : "border-border bg-muted/25 hover:border-primary/50 hover:bg-primary/5",
                )}
              >
                <Upload className="mb-3 h-9 w-9 text-primary" />
                <span className="font-medium">
                  点击选择或拖拽专利文献及附图到此处
                </span>
                <span className="mt-2 text-sm text-muted-foreground">
                  支持 DOCX、PDF、PNG、JPEG；单个文件不超过 100MB
                </span>
              </button>

              {files.length > 0 && (
                <ul className="mt-4 divide-y rounded-xl border">
                  {files.map((file, index) => (
                    <li
                      key={`${file.name}-${index}`}
                      className="flex items-center gap-3 px-4 py-3"
                    >
                      <FileText className="h-5 w-5 shrink-0 text-primary" />
                      <span className="min-w-0 flex-1 truncate text-sm font-medium">
                        {file.name}
                      </span>
                      <span className="shrink-0 rounded bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                        {isDocument(file) ? "专利文献" : "补充附图"}
                      </span>
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {formatFileSize(file.size)}
                      </span>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        aria-label={`移除 ${file.name}`}
                        disabled={loading}
                        onClick={() =>
                          setFiles((current) =>
                            current.filter(
                              (_, currentIndex) => currentIndex !== index,
                            ),
                          )
                        }
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </li>
                  ))}
                </ul>
              )}

              <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
                <p className="text-sm text-muted-foreground">
                  DOCX 内嵌附图会自动提取；PDF 附图请以 PNG/JPEG
                  单独补充。扫描版 PDF 请先完成
                  OCR，图片与正文无法相互印证时不会作为技术特征依据。
                </p>
                <Button
                  type="button"
                  onClick={parseFiles}
                  disabled={!files.some(isDocument) || loading}
                  className="gap-2"
                >
                  <FileSearch
                    className={cn("h-4 w-4", loading && "animate-pulse")}
                  />
                  {loading ? "正在解析…" : "开始解析"}
                </Button>
              </div>
            </section>
          </div>
        </main>
      )}
    </div>
  );
}
