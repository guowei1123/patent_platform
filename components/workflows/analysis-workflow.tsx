"use client";

import { useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  FileText,
  Lightbulb,
  Search,
  Sparkles,
  Target,
  Wrench,
  Zap,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type PatentAnalysisData = {
  fileName: string;
  result: {
    inventionName: string;
    applicationType: "发明" | "实用新型" | "外观设计" | "无法判断";
    technicalField: string;
    technicalProblem: string;
    technicalSolution: string;
    technicalEffect: string;
  };
  meta: {
    inputTextLength: number;
    analyzedTextLength: number;
    truncated: boolean;
    includedSections: string[];
    figureCount?: number;
  };
};

export type PatentAnalysisSummaryData = {
  overview: string;
  commonTechnicalProblems: string[];
  commonTechnicalSolutions: string[];
  technicalEffects: string[];
  differences: string[];
  searchFocus: string[];
};

export function AnalysisWorkflow({
  analyses,
  summary,
  onBack,
}: {
  analyses: PatentAnalysisData[];
  summary?: PatentAnalysisSummaryData;
  onBack: () => void;
}) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const selected = analyses[selectedIndex];
  const previous = () =>
    setSelectedIndex((current) => Math.max(0, current - 1));
  const next = () =>
    setSelectedIndex((current) => Math.min(analyses.length - 1, current + 1));

  return (
    <main className="flex h-full min-h-0 flex-1 flex-col overflow-hidden bg-background">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b bg-card px-4 py-3 sm:px-6">
        <div className="flex min-w-0 items-center gap-3">
          <Button
            variant="ghost"
            size="icon"
            aria-label="返回专利解析输入页"
            onClick={onBack}
          >
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div className="min-w-0">
            <h1 className="text-lg font-semibold">专利解析结果</h1>
            <p className="truncate text-sm text-muted-foreground">
              已完成 {analyses.length} 份文献的结构化解析
              {analyses.length > 1 ? "与对比" : ""}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Button variant="outline" onClick={onBack}>
            解析新文件
          </Button>
        </div>
      </header>

      <div className="border-b bg-card/50 px-4 pt-3 sm:px-6">
        <div
          role="tablist"
          aria-label="已解析文件"
          className="flex gap-1 overflow-x-auto"
        >
          {analyses.map((item, index) => (
            <button
              key={item.fileName}
              role="tab"
              aria-selected={selectedIndex === index}
              onClick={() => setSelectedIndex(index)}
              className={cn(
                "max-w-56 shrink-0 truncate rounded-t-lg border-b-2 px-3 py-2 text-sm transition-colors",
                selectedIndex === index
                  ? "border-primary bg-primary/5 font-medium text-primary"
                  : "border-transparent text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
              title={item.fileName}
            >
              {item.fileName}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 sm:p-6">
        <div className="mx-auto max-w-5xl space-y-6">
          <section className="rounded-2xl border bg-card p-5 shadow-sm sm:p-6">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="min-w-0">
                <p className="text-sm text-muted-foreground">当前文件</p>
                <h2 className="mt-1 break-words text-xl font-semibold">
                  {selected.result.inventionName || selected.fileName}
                </h2>
                <p className="mt-2 text-sm text-muted-foreground">
                  {selected.result.applicationType} · 已分析约{" "}
                  {selected.meta.analyzedTextLength} 字
                  {selected.meta.truncated ? "（已按字段上限截取）" : ""}
                  {selected.meta.figureCount
                    ? ` · 已结合 ${selected.meta.figureCount} 张附图`
                    : ""}
                </p>
              </div>
              {analyses.length > 1 && (
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="icon"
                    aria-label="上一份专利"
                    onClick={previous}
                    disabled={selectedIndex === 0}
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                  <span className="text-sm tabular-nums text-muted-foreground">
                    {selectedIndex + 1} / {analyses.length}
                  </span>
                  <Button
                    variant="outline"
                    size="icon"
                    aria-label="下一份专利"
                    onClick={next}
                    disabled={selectedIndex === analyses.length - 1}
                  >
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              )}
            </div>

            <div className="mt-6 grid gap-4 md:grid-cols-2">
              <AnalysisCard
                icon={<Target className="h-5 w-5 text-violet-600" />}
                title="技术领域"
                content={selected.result.technicalField}
              />
              <AnalysisCard
                icon={<Sparkles className="h-5 w-5 text-amber-600" />}
                title="技术问题"
                content={selected.result.technicalProblem}
              />
              <AnalysisCard
                icon={<Wrench className="h-5 w-5 text-blue-600" />}
                title="技术方案"
                content={selected.result.technicalSolution}
              />
              <AnalysisCard
                icon={<Zap className="h-5 w-5 text-emerald-600" />}
                title="技术效果"
                content={selected.result.technicalEffect}
              />
            </div>
          </section>

          {analyses.length > 1 && summary && (
            <section className="rounded-2xl border bg-card p-5 shadow-sm sm:p-6">
              <div className="flex items-center gap-3">
                <span className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10">
                  <Lightbulb className="h-5 w-5 text-primary" />
                </span>
                <div>
                  <h2 className="font-semibold">专利解析总结</h2>
                  <p className="text-sm text-muted-foreground">
                    基于各份结构化解析结果生成的比较结论
                  </p>
                </div>
              </div>
              <p className="mt-5 whitespace-pre-wrap leading-7 text-muted-foreground">
                {summary.overview || "原文信息不足，暂无法形成概括性总结。"}
              </p>
              <div className="mt-6 grid gap-5 md:grid-cols-2">
                <SummaryList
                  title="共同技术问题"
                  items={summary.commonTechnicalProblems}
                />
                <SummaryList
                  title="共同技术方案"
                  items={summary.commonTechnicalSolutions}
                />
                <SummaryList
                  title="技术效果"
                  items={summary.technicalEffects}
                />
                <SummaryList title="文件间差异" items={summary.differences} />
              </div>
              <div className="mt-6 border-t pt-5">
                <div className="flex items-center gap-2 font-medium">
                  <Search className="h-4 w-4 text-primary" />
                  后续检索关注点
                </div>
                {summary.searchFocus.length ? (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {summary.searchFocus.map((item) => (
                      <span
                        key={item}
                        className="rounded-full bg-primary/10 px-3 py-1 text-sm text-primary"
                      >
                        {item}
                      </span>
                    ))}
                  </div>
                ) : (
                  <p className="mt-2 text-sm text-muted-foreground">
                    原文信息不足，暂未提取检索关注点。
                  </p>
                )}
              </div>
            </section>
          )}
        </div>
      </div>
    </main>
  );
}

function AnalysisCard({
  icon,
  title,
  content,
}: {
  icon: React.ReactNode;
  title: string;
  content: string;
}) {
  return (
    <article className="rounded-xl border bg-muted/25 p-4">
      <div className="flex items-center gap-2 font-medium">
        {icon}
        {title}
      </div>
      <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-muted-foreground">
        {content || "原文未披露"}
      </p>
    </article>
  );
}

function SummaryList({ title, items }: { title: string; items: string[] }) {
  return (
    <section>
      <h3 className="font-medium">{title}</h3>
      {items.length ? (
        <ul className="mt-2 space-y-2 text-sm leading-6 text-muted-foreground">
          {items.map((item, index) => (
            <li key={index} className="flex gap-2">
              <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-primary/70" />
              <span>{item}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-sm text-muted-foreground">原文未披露。</p>
      )}
    </section>
  );
}
