"use client";

import { ChangeEvent, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Copy,
  FileText,
  Lightbulb,
  Loader2,
  Plus,
  Search,
  Tags,
  Upload,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { PatentSearchResults } from "@/components/patent-search-results";
import type { PatentItem } from "@/lib/types";
import type { ParsedDisclosure } from "@/app/api/report/disclosure-parse/service";

type Step = 1 | 2 | 3;
type IpcItem = { code: string; name: string };
type KeywordRelationGroup = { keywords: string[]; operator: "AND" | "OR" };
type RelatedGroups = Record<
  "上位概念" | "下位概念" | "同类词" | "英文同类词" | "英文简写",
  string[]
>;
const SEARCH_PAGE_SIZE = 20;
const emptyGroups: RelatedGroups = {
  上位概念: [],
  下位概念: [],
  同类词: [],
  英文同类词: [],
  英文简写: [],
};
const templates = [
  {
    id: "ipc-keywords",
    name: "IPC/CPC + Keywords",
    description: "按分类号和关键词组合缩小检索范围",
  },
  {
    id: "keywords-only",
    name: "Keywords",
    description: "仅按标题和摘要中的关键词检索",
  },
] as const;
type FormulaHistorySnapshot = {
  fileName: string;
  ipcList: IpcItem[];
  keywords: string[];
  keywordGroups?: KeywordRelationGroup[];
  selectedTemplate: (typeof templates)[number]["id"];
  formula: string;
  total: number;
  offset?: number;
  results: PatentItem[];
  confirmed: boolean;
};

function quoteTerm(term: string) {
  const clean = term.trim().replace(/["()]/g, "");
  return /\s/.test(clean) ? `"${clean}"` : clean;
}
function buildFormula(
  template: (typeof templates)[number]["id"],
  keywords: string[],
  ipcList: IpcItem[],
  keywordGroups: KeywordRelationGroup[] = [],
) {
  const covered = new Set(
    keywordGroups.flatMap((group) =>
      group.keywords.map((word) => word.toLocaleLowerCase()),
    ),
  );
  const groups = [
    ...keywordGroups.filter((group) => group.keywords.length),
    ...keywords
      .filter((word) => !covered.has(word.toLocaleLowerCase()))
      .map((word) => ({ keywords: [word], operator: "AND" as const })),
  ];
  const keywordPart = groups
    .map(
      (group) =>
        `(${group.keywords.map((word) => `TIAB=${quoteTerm(word)}`).join(` ${group.operator} `)})`,
    )
    .join(" AND ");
  if (template === "keywords-only" || ipcList.length === 0)
    return `(${keywordPart})`;
  const ipcPart = ipcList
    .map((ipc) => `IPC=${quoteTerm(ipc.code.replace(/\s/g, ""))}`)
    .join(" OR ");
  return `(${ipcPart}) AND (${keywordPart})`;
}
function isFormulaHistorySnapshot(
  value: unknown,
): value is FormulaHistorySnapshot {
  if (!value || typeof value !== "object") return false;
  const snapshot = value as Record<string, unknown>;
  return (
    typeof snapshot.fileName === "string" &&
    Array.isArray(snapshot.ipcList) &&
    Array.isArray(snapshot.keywords) &&
    (snapshot.keywordGroups === undefined ||
      Array.isArray(snapshot.keywordGroups)) &&
    typeof snapshot.formula === "string" &&
    typeof snapshot.total === "number" &&
    (snapshot.offset === undefined ||
      (typeof snapshot.offset === "number" && snapshot.offset >= 0)) &&
    Array.isArray(snapshot.results) &&
    (snapshot.selectedTemplate === "ipc-keywords" ||
      snapshot.selectedTemplate === "keywords-only") &&
    typeof snapshot.confirmed === "boolean"
  );
}
export function SearchFormulaWorkflow({
  fileName: initialFileName,
  onBack,
}: {
  fileName?: string;
  onBack?: () => void;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const requestedConversationId = searchParams.get("conversationId");
  const [step, setStep] = useState<Step>(1);
  const [fileName, setFileName] = useState(initialFileName || "尚未上传交底书");
  const [isDisclosureParsed, setIsDisclosureParsed] = useState(false);
  const [isParsing, setIsParsing] = useState(false);
  const [strategyRationale, setStrategyRationale] = useState("");
  const [ipcList, setIpcList] = useState<IpcItem[]>([]);
  const [keywords, setKeywords] = useState<string[]>([]);
  const [keywordGroups, setKeywordGroups] = useState<KeywordRelationGroup[]>(
    [],
  );
  const [groups, setGroups] = useState<RelatedGroups>(emptyGroups);
  const [activeKeyword, setActiveKeyword] = useState<string | null>(null);
  const [isRecommending, setIsRecommending] = useState(false);
  const [newIpc, setNewIpc] = useState("");
  const [newKeyword, setNewKeyword] = useState("");
  const [selectedTemplate, setSelectedTemplate] =
    useState<(typeof templates)[number]["id"]>("ipc-keywords");
  const [formula, setFormula] = useState("");
  const [searchResults, setSearchResults] = useState<PatentItem[]>([]);
  const [total, setTotal] = useState(0);
  const [searchOffset, setSearchOffset] = useState(0);
  const [isSearching, setIsSearching] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState("");
  const relatedEntries = useMemo(
    () => Object.entries(groups) as [keyof RelatedGroups, string[]][],
    [groups],
  );
  const readyForFormula = keywords.length > 0;

  const showError = (message: string) => {
    setError(message);
    window.setTimeout(() => setError(""), 5000);
  };
  useEffect(() => {
    if (!requestedConversationId) return;
    let active = true;
    const restoreFromSidebar = async () => {
      try {
        const response = await fetch(
          `/api/agent/conversations/${encodeURIComponent(requestedConversationId)}`,
        );
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "读取历史记录失败");
        if (
          data.conversation?.type !== "search_formula" ||
          !isFormulaHistorySnapshot(data.searchResults)
        )
          throw new Error("该检索式历史记录内容不可用");
        if (!active) return;
        const snapshot = data.searchResults;
        setFileName(snapshot.fileName);
        setIpcList(snapshot.ipcList);
        setKeywords(snapshot.keywords);
        setKeywordGroups(snapshot.keywordGroups || []);
        setSelectedTemplate(snapshot.selectedTemplate);
        setFormula(snapshot.formula);
        setTotal(snapshot.total);
        setSearchOffset(snapshot.offset || 0);
        setSearchResults(snapshot.results);
        setConfirmed(snapshot.confirmed);
        setIsDisclosureParsed(true);
        setStep(3);
      } catch (cause) {
        if (active)
          showError(
            cause instanceof Error ? cause.message : "读取历史记录失败",
          );
      }
    };
    void restoreFromSidebar();
    return () => {
      active = false;
    };
  }, [requestedConversationId]);
  const addKeyword = (word: string) => {
    const normalized = word.trim();
    if (
      !normalized ||
      keywords.some(
        (item) => item.toLocaleLowerCase() === normalized.toLocaleLowerCase(),
      )
    )
      return;
    setKeywords((current) => [...current, normalized]);
    setNewKeyword("");
    setFormula("");
  };
  const addIpc = () => {
    const code = newIpc.trim().toUpperCase().replace(/\s/g, "");
    if (!code || ipcList.some((item) => item.code === code)) return;
    setIpcList((current) => [...current, { code, name: "手动添加" }]);
    setNewIpc("");
    setFormula("");
  };
  const uploadDisclosure = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    setIsDisclosureParsed(false);
    setIsParsing(true);
    setError("");
    const form = new FormData();
    form.append("file", file);
    try {
      const response = await fetch("/api/report/disclosure-parse", {
        method: "POST",
        body: form,
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "交底书解析失败");
      const parsedDisclosure = data as ParsedDisclosure;
      const strategyResponse = await fetch(
        "/api/agent/search-formula/strategy",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            disclosure: parsedDisclosure,
            template: selectedTemplate,
          }),
        },
      );
      const strategy = await strategyResponse.json();
      if (!strategyResponse.ok)
        throw new Error(strategy.error || "智能体生成检索策略失败");
      setIpcList(
        strategy.strategy.ipcCodes.map((code: string) => ({
          code,
          name: "智能体推荐",
        })),
      );
      setKeywords(strategy.strategy.keywords);
      setKeywordGroups(strategy.strategy.keywordGroups);
      setStrategyRationale(strategy.strategy.rationale || "");
      setGroups(emptyGroups);
      setActiveKeyword(null);
      setFormula(strategy.generatedFormula || "");
      setIsDisclosureParsed(true);
    } catch (caught) {
      showError(caught instanceof Error ? caught.message : "交底书解析失败");
    } finally {
      setIsParsing(false);
      event.target.value = "";
    }
  };
  const recommendRelatedWords = async (keyword: string) => {
    setActiveKeyword(keyword);
    setIsRecommending(true);
    setError("");
    try {
      const response = await fetch("/api/report/keyword-recommendation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ coreKeyword: keyword, desiredCount: 10 }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "关联词推荐失败");
      const source = data.data?.groups || {};
      setGroups({
        上位概念: source.upperConcepts || [],
        下位概念: source.lowerConcepts || [],
        同类词: source.similarTerms || [],
        英文同类词: source.englishTerms || [],
        英文简写: source.abbreviations || [],
      });
    } catch (caught) {
      showError(caught instanceof Error ? caught.message : "关联词推荐失败");
    } finally {
      setIsRecommending(false);
    }
  };
  const generateFormula = (template = selectedTemplate) => {
    if (!readyForFormula) return showError("请至少保留一个关键词");
    setSelectedTemplate(template);
    setConfirmed(false);
    setFormula(buildFormula(template, keywords, ipcList, keywordGroups));
  };
  const runSearch = async (offset = 0) => {
    if (!formula.trim()) return showError("请先生成或填写检索式");
    setStep(3);
    setIsSearching(true);
    if (offset === 0) setConfirmed(false);
    setError("");
    try {
      const response = await fetch("/api/report/patent-search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          formula,
          limit: SEARCH_PAGE_SIZE,
          offset,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "检索失败");
      const items = Array.isArray(data.items) ? data.items : [];
      const mappedResults = items.map(
        (item: {
          id: string;
          title: string;
          applicant: string;
          docNumber: string;
          appDate: string;
          pubDate: string;
          abstract: string;
        }) => ({
          id: item.id,
          title: item.title,
          applicant: item.applicant,
          publicationNumber: item.docNumber,
          publicationDate: item.appDate,
          abstract: item.abstract,
        }),
      );
      const resultTotal = Number(data.total) || 0;
      const resultOffset =
        Number.isInteger(data.offset) && data.offset >= 0
          ? data.offset
          : offset;
      setSearchResults(mappedResults);
      setTotal(resultTotal);
      setSearchOffset(resultOffset);
    } catch (caught) {
      if (offset === 0) {
        setSearchResults([]);
        setTotal(0);
        setSearchOffset(0);
      }
      showError(caught instanceof Error ? caught.message : "检索失败");
    } finally {
      setIsSearching(false);
    }
  };

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="flex flex-wrap items-center justify-between gap-4 border-b bg-card px-6 py-4">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => (onBack ? onBack() : router.push("/qa"))}
            aria-label="返回"
          >
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div>
            <h1 className="text-lg font-semibold">检索式生成</h1>
            <p className="text-xs text-muted-foreground">{fileName}</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          {(["提取关键信息", "生成检索式", "检索相关文件"] as const).map(
            (label, index) => {
              const number = (index + 1) as Step;
              return (
                <div key={label} className="flex items-center gap-2">
                  <span
                    className={cn(
                      "flex h-7 w-7 items-center justify-center rounded-full",
                      step >= number
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted text-muted-foreground",
                    )}
                  >
                    {step > number ? <Check className="h-4 w-4" /> : number}
                  </span>
                  <span
                    className={cn(
                      "inline",
                      step >= number
                        ? "text-foreground"
                        : "text-muted-foreground",
                    )}
                  >
                    {label}
                  </span>
                  {index < 2 && <span className="mx-1 h-px w-5 bg-border" />}
                </div>
              );
            },
          )}
        </div>
      </header>
      <main className="mx-auto w-full min-w-0 max-w-5xl flex-1 p-4 sm:p-6">
        {error && (
          <div
            role="alert"
            className="mb-5 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive"
          >
            {error}
          </div>
        )}
        {step === 1 && (
          <div className="space-y-6">
            <section className="rounded-xl border bg-card p-6">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="font-semibold">上传专利交底书</h2>
                  <p className="mt-1 text-sm text-muted-foreground">
                    请先上传 DOCX 或 TXT
                    交底书，提取后可编辑关键词和分类号，再生成检索式。
                  </p>
                </div>
                <Button asChild disabled={isParsing}>
                  <label className="cursor-pointer gap-2">
                    <Upload className="h-4 w-4" />
                    {isParsing ? "正在提取…" : "上传交底书"}
                    <input
                      className="sr-only"
                      type="file"
                      accept=".docx,.txt"
                      onChange={uploadDisclosure}
                    />
                  </label>
                </Button>
              </div>
              {isParsing && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  正在提取关键词和分类号，请稍候…
                </div>
              )}
              {strategyRationale && (
                <div className="mt-4 rounded-lg bg-primary/5 p-3 text-sm text-muted-foreground">
                  <span className="font-medium text-foreground">
                    选择依据：
                  </span>
                  {strategyRationale}
                </div>
              )}
            </section>
            <section className="rounded-xl border bg-card p-6">
              <div className="mb-4 flex items-center gap-2">
                <FileText className="h-5 w-5 text-primary" />
                <h2 className="font-semibold">
                  IPC/CPC{" "}
                  <span className="ml-1 text-sm font-normal text-muted-foreground">
                    选填
                  </span>
                </h2>
              </div>
              <div className="flex flex-wrap gap-2">
                {ipcList.map((item) => (
                  <span
                    key={item.code}
                    title={item.name}
                    className="inline-flex items-center gap-2 rounded-md border border-primary/30 bg-primary/10 px-3 py-1.5 font-mono text-sm text-primary"
                  >
                    {item.code}
                    <button
                      onClick={() => {
                        setIpcList((current) =>
                          current.filter((entry) => entry.code !== item.code),
                        );
                        setFormula("");
                      }}
                      aria-label={`删除 ${item.code}`}
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </span>
                ))}
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                <input
                  aria-label="添加专利分类号"
                  value={newIpc}
                  onChange={(event) => setNewIpc(event.target.value)}
                  onKeyDown={(event) => event.key === "Enter" && addIpc()}
                  placeholder="添加 IPC/CPC，例如 G06F16/00"
                  className="h-10 min-w-0 flex-1 rounded-md border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-primary"
                />
                <Button
                  type="button"
                  variant="outline"
                  onClick={addIpc}
                  disabled={!newIpc.trim()}
                >
                  <Plus className="mr-1 h-4 w-4" />
                  添加
                </Button>
              </div>
            </section>
            <section className="rounded-xl border bg-card p-6">
              <div className="mb-4 flex items-center gap-2">
                <Tags className="h-5 w-5 text-primary" />
                <h2 className="font-semibold">
                  关键词{" "}
                  <span className="ml-1 text-sm font-normal text-muted-foreground">
                    必填
                  </span>
                </h2>
              </div>
              <p className="mb-3 text-sm text-muted-foreground">
                点击关键词获取 AI 关联词推荐；选择推荐词后将加入检索关键词。
              </p>
              <div className="flex flex-wrap gap-2">
                {keywords.map((word) => (
                  <span
                    key={word}
                    className={cn(
                      "inline-flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm",
                      activeKeyword === word
                        ? "border-primary bg-primary/15 text-primary"
                        : "border-primary/30 bg-primary/5",
                    )}
                  >
                    <button onClick={() => recommendRelatedWords(word)}>
                      {word}
                    </button>
                    <button
                      onClick={() => {
                        setKeywords((current) =>
                          current.filter((item) => item !== word),
                        );
                        setFormula("");
                        if (activeKeyword === word) {
                          setActiveKeyword(null);
                          setGroups(emptyGroups);
                        }
                      }}
                      aria-label={`删除 ${word}`}
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </span>
                ))}
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                <input
                  aria-label="添加检索关键词"
                  value={newKeyword}
                  onChange={(event) => setNewKeyword(event.target.value)}
                  onKeyDown={(event) =>
                    event.key === "Enter" && addKeyword(newKeyword)
                  }
                  placeholder="手动添加关键词"
                  className="h-10 min-w-0 flex-1 rounded-md border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-primary"
                />
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => addKeyword(newKeyword)}
                  disabled={!newKeyword.trim()}
                >
                  <Plus className="mr-1 h-4 w-4" />
                  添加
                </Button>
              </div>
              {(activeKeyword || isRecommending) && (
                <div className="mt-5 rounded-lg bg-muted/60 p-4">
                  <div className="mb-3 flex items-center gap-2 text-sm font-medium">
                    <Lightbulb className="h-4 w-4 text-primary" />
                    {isRecommending
                      ? "AI 正在推荐关联词…"
                      : `“${activeKeyword}”的 AI 关联词`}
                    {isRecommending && (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    )}
                  </div>
                  <div className="space-y-3">
                    {relatedEntries.map(([title, words]) => (
                      <div key={title}>
                        <p className="mb-1.5 text-xs text-muted-foreground">
                          {title}
                        </p>
                        <div className="flex flex-wrap gap-2">
                          {words.length ? (
                            words.map((word) => (
                              <button
                                key={word}
                                onClick={() => addKeyword(word)}
                                className="rounded-md border bg-background px-2.5 py-1 text-sm hover:border-primary hover:text-primary"
                              >
                                <Plus className="mr-1 inline h-3 w-3" />
                                {word}
                              </button>
                            ))
                          ) : (
                            <span className="text-xs text-muted-foreground">
                              暂无推荐
                            </span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </section>
          </div>
        )}
        {step === 2 && (
          <div className="space-y-6">
            <section>
              <h2 className="mb-4 font-semibold">选择检索式模板</h2>
              <div className="grid gap-4 sm:grid-cols-2">
                {templates.map((template) => (
                  <button
                    key={template.id}
                    onClick={() => generateFormula(template.id)}
                    className={cn(
                      "rounded-xl border p-5 text-left",
                      selectedTemplate === template.id
                        ? "border-primary bg-primary/5 ring-1 ring-primary"
                        : "bg-card hover:bg-muted/50",
                    )}
                  >
                    <h3 className="font-medium">{template.name}</h3>
                    <p className="mt-2 text-sm text-muted-foreground">
                      {template.description}
                    </p>
                    {template.id === "ipc-keywords" && ipcList.length === 0 && (
                      <p className="mt-2 text-xs text-amber-600">
                        未填写分类号时，将自动只使用关键词。
                      </p>
                    )}
                  </button>
                ))}
              </div>
            </section>

            <section className="rounded-xl border bg-card p-6">
              <div className="mb-4 flex items-center justify-between">
                <h2 className="font-semibold">生成的检索式</h2>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => navigator.clipboard.writeText(formula)}
                  disabled={!formula}
                >
                  <Copy className="mr-1 h-4 w-4" />
                  复制
                </Button>
              </div>
              <Textarea
                value={formula}
                onChange={(event) => {
                  setFormula(event.target.value);
                }}
                placeholder="选择模板后自动生成，也可直接编辑"
                className="min-h-36 font-mono text-sm"
              />
              <p className="mt-3 text-sm text-muted-foreground">
                检索式可编辑；运行时会按标题、摘要及 IPC/CPC 字段查询专利库。
              </p>
            </section>
          </div>
        )}
        {step === 3 && (
          <div className="space-y-5">
            <div className="rounded-xl border bg-card p-5">
              <p className="text-sm text-muted-foreground">当前检索式</p>
              <p className="mt-2 break-all font-mono text-sm">{formula}</p>
            </div>
            {isSearching ? (
              <div className="flex min-h-64 items-center justify-center gap-2 text-muted-foreground">
                <Loader2 className="h-5 w-5 animate-spin" />
                正在检索相关专利文件…
              </div>
            ) : (
              <>
                <div className="flex items-center justify-between">
                  <h2 className="font-semibold">检索结果（{total}）</h2>
                  {confirmed && (
                    <span className="flex items-center gap-1 text-sm text-primary">
                      <Check className="h-4 w-4" />
                      已确认
                    </span>
                  )}
                </div>
                {searchResults.length ? (
                  <>
                    <PatentSearchResults results={searchResults} />
                    {total > SEARCH_PAGE_SIZE && (
                      <nav
                        aria-label="检索结果分页"
                        className="flex flex-wrap items-center justify-center gap-3 pt-2"
                      >
                        <Button
                          variant="outline"
                          disabled={isSearching || searchOffset === 0}
                          onClick={() =>
                            void runSearch(
                              Math.max(0, searchOffset - SEARCH_PAGE_SIZE),
                            )
                          }
                        >
                          <ArrowLeft className="mr-1 h-4 w-4" />
                          上一页
                        </Button>
                        <span
                          aria-live="polite"
                          className="text-sm text-muted-foreground"
                        >
                          第 {Math.floor(searchOffset / SEARCH_PAGE_SIZE) + 1} /
                          {Math.ceil(total / SEARCH_PAGE_SIZE)} 页 · 每页
                          {SEARCH_PAGE_SIZE} 条
                        </span>
                        <Button
                          variant="outline"
                          disabled={
                            isSearching ||
                            searchOffset + SEARCH_PAGE_SIZE >= total
                          }
                          onClick={() =>
                            void runSearch(searchOffset + SEARCH_PAGE_SIZE)
                          }
                        >
                          下一页
                          <ArrowRight className="ml-1 h-4 w-4" />
                        </Button>
                      </nav>
                    )}
                  </>
                ) : (
                  <div className="rounded-xl border border-dashed p-10 text-center text-sm text-muted-foreground">
                    未找到匹配专利，可返回上一步调整关键词后重新检索。
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </main>
      <footer className="flex flex-wrap items-center justify-between gap-3 border-t bg-card px-4 py-4 sm:px-6">
        {step === 1 && (
          <p role="status" className="basis-full text-sm text-muted-foreground">
            {isParsing
              ? "正在提取材料，完成后可继续。"
              : !isDisclosureParsed
                ? "请先上传交底书，提取完成后才能进入下一步。"
                : !readyForFormula
                  ? "请至少保留一个关键词后继续。"
                  : "检查关键词和分类号后，点击下一步。"}
          </p>
        )}
        <div>
          {step > 1 && (
            <Button
              variant="outline"
              onClick={() => setStep((step - 1) as Step)}
            >
              <ArrowLeft className="mr-1 h-4 w-4" />
              返回上一步
            </Button>
          )}
        </div>
        {step === 1 ? (
          <Button
            disabled={isParsing || !isDisclosureParsed || !readyForFormula}
            onClick={() => {
              setStep(2);
              if (!formula) generateFormula();
            }}
          >
            下一步：生成检索式
            <ArrowRight className="ml-1 h-4 w-4" />
          </Button>
        ) : step === 2 ? (
          <Button disabled={!formula.trim()} onClick={() => void runSearch()}>
            运行检索
            <Search className="ml-1 h-4 w-4" />
          </Button>
        ) : (
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => setStep(1)}>
              调整关键词重新检索
            </Button>
            <Button
              disabled={isSearching || !searchResults.length}
              onClick={() => setConfirmed(true)}
            >
              {confirmed ? "结果已确认" : "确认结果"}
            </Button>
          </div>
        )}
      </footer>
    </div>
  );
}
