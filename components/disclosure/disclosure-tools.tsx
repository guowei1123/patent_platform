"use client";

import * as React from "react";
import { WorkspaceNavigation } from "@/components/workspace-navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  sectionLabels,
  type DisclosureCommand,
  type DisclosureTask,
  type SectionKey,
} from "@/src/mastra/disclosure/contracts";
import { FilePlus2, History, ImageIcon, Search } from "lucide-react";

export type DisclosureTool =
  | "history"
  | "versions"
  | "images"
  | "patents"
  | "sources"
  | "navigation";
export type DisclosureAction = Partial<DisclosureCommand> & {
  action: DisclosureCommand["action"];
};
type Props = {
  panel: DisclosureTool | null;
  onClose: () => void;
  task: DisclosureTask | null;
  tasks: { id: string; title: string; version: number }[];
  working: boolean;
  editing: boolean;
  error: string;
  load: (id: string) => Promise<void>;
  newTask: () => Promise<void>;
  perform: (input: DisclosureAction) => Promise<void>;
  openSection: (section: SectionKey, content?: string) => void;
};
const titles: Record<DisclosureTool, string> = {
  history: "我的交底书",
  versions: "版本记录",
  images: "附图与检查",
  patents: "相关专利检索",
  sources: "材料与对话",
  navigation: "功能导航",
};

export function DisclosureTools({
  panel,
  onClose,
  task,
  tasks,
  working,
  editing,
  error,
  load,
  newTask,
  perform,
  openSection,
}: Props) {
  const [restoreVersion, setRestoreVersion] = React.useState(0);
  const [keywords, setKeywords] = React.useState("");
  const [patentIds, setPatentIds] = React.useState<string[]>([]);
  const search = task?.state.patentSearches?.[0];
  const insight = task?.state.patentInsights?.find(
    (item) => item.searchId === search?.id,
  );
  const disabled = working || editing;
  React.useEffect(() => {
    setRestoreVersion(Math.max(0, (task?.version || 0) - 1));
  }, [task?.id, task?.version]);
  React.useEffect(() => {
    setPatentIds(search?.items.slice(0, 5).map((item) => item.id) || []);
  }, [search?.id]);
  return (
    <Sheet
      open={panel !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <SheetContent className="w-full text-foreground sm:max-w-xl">
        <SheetHeader className="shrink-0 pe-12">
          <SheetTitle>{panel ? titles[panel] : "交底书工具"}</SheetTitle>
          <SheetDescription>
            当前交底书的辅助工具，操作后自动保存。
          </SheetDescription>
        </SheetHeader>
        <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-4 pb-8">
          {error && (
            <p
              role="alert"
              className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive"
            >
              {error}
            </p>
          )}
          {panel === "navigation" && <WorkspaceNavigation vertical />}
          {panel === "history" && (
            <>
              <Button
                className="w-full"
                disabled={disabled}
                onClick={async () => {
                  await newTask();
                }}
              >
                <FilePlus2 aria-hidden="true" />
                新建交底书
              </Button>
              <div className="space-y-2">
                {tasks.map((item) => (
                  <Button
                    key={item.id}
                    variant={task?.id === item.id ? "secondary" : "outline"}
                    className="h-auto w-full justify-start gap-3 whitespace-normal py-3 text-start text-foreground"
                    disabled={disabled}
                    onClick={async () => {
                      await load(item.id);
                    }}
                  >
                    <History className="shrink-0" aria-hidden="true" />
                    <span className="min-w-0 flex-1 break-words">
                      {item.title}
                    </span>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      v{item.version}
                    </span>
                  </Button>
                ))}
                {!tasks.length && (
                  <p className="text-sm text-muted-foreground">
                    还没有交底书，提交材料后会自动保存。
                  </p>
                )}
              </div>
            </>
          )}
          {panel === "versions" &&
            (task ? (
              <div className="space-y-4">
                <p className="text-sm">当前已保存版本 v{task.version}</p>
                <label
                  htmlFor="disclosure-restore-version"
                  className="block text-sm font-medium"
                >
                  选择历史版本
                </label>
                <select
                  id="disclosure-restore-version"
                  className="min-h-10 w-full rounded-md border bg-background px-3 text-foreground"
                  value={restoreVersion}
                  disabled={disabled}
                  onChange={(event) =>
                    setRestoreVersion(Number(event.target.value))
                  }
                >
                  {Array.from({ length: task.version + 1 }, (_, version) => (
                    <option key={version} value={version}>
                      版本 {version}
                      {version === task.version ? "（当前）" : ""}
                    </option>
                  ))}
                </select>
                <p className="text-xs text-muted-foreground">
                  恢复内容会另存为新版本。
                </p>
                <Button
                  disabled={disabled || restoreVersion === task.version}
                  onClick={() => perform({ action: "restore", restoreVersion })}
                >
                  恢复此版本
                </Button>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                提交材料后可查看版本记录。
              </p>
            ))}
          {panel === "images" && (
            <>
              <p className="text-sm text-muted-foreground">
                在底部输入框上传附图后，可在这里查看检测结果。
              </p>
              <Button
                variant="outline"
                className="text-foreground"
                disabled={disabled || !task?.state.images.length}
                onClick={() => perform({ action: "check-images" })}
              >
                <ImageIcon aria-hidden="true" />
                检查图文一致性
              </Button>
              {task?.state.images.map((image, index) => (
                <figure
                  key={image.id}
                  className="space-y-3 rounded-xl border bg-card p-4"
                >
                  <img
                    src={`/api/agent/disclosures/${task.id}/assets/${image.id}`}
                    alt={image.caption || image.name}
                    className="mx-auto max-h-64 max-w-full"
                  />
                  <figcaption className="break-words text-sm font-medium">
                    图{index + 1} {image.caption || image.name}
                  </figcaption>
                  <p
                    className={`text-xs ${["warning", "failed"].includes(image.detection) ? "font-medium text-destructive dark:text-destructive-foreground" : "text-muted-foreground"}`}
                  >
                    格式检查：
                    {image.detection === "passed"
                      ? "通过"
                      : image.detection === "pending"
                        ? "待检查"
                        : "需要复核"}
                    。{image.reason}
                  </p>
                  {image.review && (
                    <div
                      className={`space-y-2 text-sm ${["warning", "failed"].includes(image.review.status) ? "text-destructive dark:text-destructive-foreground" : "text-muted-foreground"}`}
                    >
                      <p>{image.review.summary}</p>
                      {image.review.issues.map((issue, i) => (
                        <p
                          key={i}
                          className="text-destructive dark:text-destructive-foreground"
                        >
                          {issue}
                        </p>
                      ))}
                    </div>
                  )}
                  <Button
                    variant="ghost"
                    className="text-muted-foreground"
                    size="sm"
                    disabled={disabled}
                    onClick={() =>
                      perform({ action: "remove-image", imageId: image.id })
                    }
                  >
                    移除此图
                  </Button>
                </figure>
              ))}
              {!task?.state.images.length && (
                <p className="text-sm text-muted-foreground">尚未上传附图。</p>
              )}
            </>
          )}
          {panel === "patents" && (
            <>
              <p className="text-sm text-muted-foreground">
                检索结果作为外部证据，审阅后可载入背景编辑草稿。
              </p>
              <div className="space-y-3">
                <label
                  htmlFor="disclosure-keywords"
                  className="text-sm font-medium"
                >
                  检索关键词
                </label>
                <Input
                  id="disclosure-keywords"
                  placeholder="用顿号或逗号分隔，最多 8 个关键词"
                  value={keywords}
                  onChange={(event) => setKeywords(event.target.value)}
                />
                <Button
                  variant="outline"
                  className="text-foreground"
                  disabled={disabled || !keywords.trim()}
                  onClick={() =>
                    perform({
                      action: "search-patents",
                      search: {
                        keywords: keywords
                          .split(/[，、,\n\r]/)
                          .map((item) => item.trim())
                          .filter(Boolean)
                          .slice(0, 8),
                        limit: 10,
                      },
                    })
                  }
                >
                  <Search aria-hidden="true" />
                  检索相关专利
                </Button>
              </div>
              {search && (
                <div className="space-y-3">
                  <p className="text-sm">
                    检索词：{search.keywords.join("、")}；共 {search.total}{" "}
                    件，显示 {search.items.length} 件。
                  </p>
                  {search.items.map((item) => (
                    <label
                      key={item.id}
                      className="flex items-start gap-3 rounded-lg border p-3 text-sm"
                    >
                      <input
                        type="checkbox"
                        className="mt-1 shrink-0"
                        disabled={disabled}
                        checked={patentIds.includes(item.id)}
                        onChange={(event) =>
                          setPatentIds((current) =>
                            event.target.checked
                              ? [...new Set([...current, item.id])].slice(0, 10)
                              : current.filter((id) => id !== item.id),
                          )
                        }
                      />
                      <span className="min-w-0 space-y-1 break-words">
                        <span className="block font-medium">
                          {item.docNumber || item.id}{" "}
                          {item.title || "未命名专利"}
                        </span>
                        <span className="block text-xs text-muted-foreground">
                          {item.pubDate}
                        </span>
                        <span className="block text-xs leading-5 text-muted-foreground">
                          {item.abstract || "未提供摘要"}
                        </span>
                      </span>
                    </label>
                  ))}
                  <Button
                    variant="outline"
                    className="text-foreground"
                    disabled={disabled || !patentIds.length || !!insight}
                    onClick={() =>
                      perform({
                        action: "analyze-patents",
                        searchId: search.id,
                        patentIds,
                      })
                    }
                  >
                    生成背景与差异建议
                  </Button>
                </div>
              )}
              {insight && (
                <div className="space-y-4 rounded-xl border bg-card p-4 text-sm">
                  <h3 className="font-medium">检索证据分析（需人工审阅）</h3>
                  <p className="whitespace-pre-wrap">{insight.summary}</p>
                  <details>
                    <summary className="cursor-pointer">背景描述建议</summary>
                    <p className="mt-3 whitespace-pre-wrap leading-6">
                      {insight.backgroundSuggestion}
                    </p>
                  </details>
                  <Button
                    size="sm"
                    variant="outline"
                    className="text-foreground"
                    disabled={disabled}
                    onClick={() =>
                      openSection(
                        "techBackground",
                        insight.backgroundSuggestion,
                      )
                    }
                  >
                    载入背景编辑草稿
                  </Button>
                  <details>
                    <summary className="cursor-pointer">差异说明与限制</summary>
                    <p className="mt-3 whitespace-pre-wrap leading-6">
                      {insight.differenceSuggestion}
                    </p>
                    <ul className="mt-3 list-disc space-y-1 ps-5 text-xs text-muted-foreground">
                      {insight.limitations.map((item, index) => (
                        <li key={index}>{item}</li>
                      ))}
                    </ul>
                  </details>
                </div>
              )}
            </>
          )}
          {panel === "sources" && (
            <>
              <section className="space-y-3">
                <h3 className="font-medium">
                  材料来源（{task?.state.sources.length || 0}）
                </h3>
                {task?.state.sources.map((source, index) => (
                  <details
                    key={`${source.id}-${index}`}
                    className="rounded-lg border bg-card p-3"
                  >
                    <summary className="cursor-pointer break-words text-sm">
                      {source.label}
                    </summary>
                    <p className="mt-3 whitespace-pre-wrap break-words text-sm leading-6">
                      {source.text}
                    </p>
                  </details>
                ))}
              </section>
              <section className="space-y-3">
                <h3 className="font-medium">
                  技术事实（{task?.state.facts.length || 0}）
                </h3>
                {task?.state.facts.map((fact, index) => (
                  <div
                    key={index}
                    className="space-y-2 border-s-2 ps-3 text-sm"
                  >
                    <p>
                      {fact.category}：{fact.text}
                    </p>
                    <blockquote className="text-xs text-muted-foreground">
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
              </section>
              {!!task?.state.sectionImpacts?.length && (
                <section className="space-y-3">
                  <h3 className="font-medium">受影响章节</h3>
                  {task.state.sectionImpacts.map((impact, index) => (
                    <Button
                      key={index}
                      variant="secondary"
                      className="h-auto w-full justify-start whitespace-normal py-3 text-start"
                      disabled={disabled}
                      onClick={() => openSection(impact.affectedSection)}
                    >
                      {sectionLabels[impact.affectedSection]}：{impact.reason}
                    </Button>
                  ))}
                </section>
              )}
              <section className="space-y-3">
                <h3 className="font-medium">对话记录</h3>
                {task?.state.messages.map((item, index) => (
                  <div
                    key={`${item.id}-${index}`}
                    className="space-y-1 rounded-lg bg-muted p-3 text-sm"
                  >
                    <p className="text-xs text-muted-foreground">
                      {item.role === "user" ? "你" : "交底书助手"}
                    </p>
                    <p className="whitespace-pre-wrap break-words leading-6">
                      {item.text}
                    </p>
                  </div>
                ))}
              </section>
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
