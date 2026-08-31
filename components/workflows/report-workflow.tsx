"use client";

import React, { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Copy,
  FileText,
  Tags,
  BookOpen,
  Plus,
  X,
  Search,
  Lightbulb,
  FileSearch,
  CheckCircle,
  Download,
  Pencil,
  Save,
  Trash2,
  Sparkles,
} from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

interface ReportWorkflowProps {
  fileName: string;
  file?: File | null;
  onBack: () => void;
}

interface ParsedDisclosure {
  inventionName: string;
  technicalField: string;
  backgroundTechnology: string;
  technicalProblem: string;
  technicalSolution: string;
  beneficialEffects: string;
  keyTechnicalFeatures: string[];
  searchKeywords: string[];
  ipcSuggestions: IPCItem[];
  sourceTextLength: number;
}

interface IPCItem {
  code: string;
  name: string;
}

interface KeywordItem {
  word: string;
}

interface TemplateOption {
  id: string;
  name: string;
  description: string;
  example: string;
}

interface PatentItem {
  id: string;
  title: string;
  applicant: string;
  publicationNumber: string;
  publicationDate: string;
  abstract: string;
  ipcCodes: string[];
  relevance: number;
  similarities: string;
  differences: string;
  category: "X" | "Y" | "A";
  classificationConclusion?: string;
  isClassifying?: boolean;
}

// IPC建议库
const ipcSuggestions: IPCItem[] = [
  { code: "G06F", name: "电数字数据处理" },
  { code: "G06N", name: "基于特定计算模型的计算机系统" },
  {
    code: "G06Q",
    name: "专门适用于行政、商业、金融、管理、监督或预测目的的数据处理系统或方法",
  },
  { code: "H04L", name: "数字信息的传输" },
  { code: "G06K", name: "数据识别；数据表示；记录载体" },
  { code: "G06T", name: "一般的图像数据处理或产生" },
  { code: "H04N", name: "图像通信" },
  { code: "G06V", name: "图像或视频识别或理解" },
  { code: "H04W", name: "无线通信网络" },
  { code: "G06F16", name: "信息检索；数据库结构" },
];

const templates: TemplateOption[] = [
  {
    id: "ipc-keywords",
    name: "IncoPat | IPC/CPC + Keywords",
    description: "使用 IPC/CPC 分类号与关键词组合进行检索",
    example:
      "(IPC=G06F OR IPC=G06N) AND (TI=人工智能 OR AB=人工智能 OR TI=机器学习 OR AB=机器学习)",
  },
  {
    id: "keywords-only",
    name: "IncoPat | Keywords",
    description: "仅使用关键词进行检索",
    example: "(TI=人工智能 OR AB=人工智能 OR TI=机器学习 OR AB=机器学习)",
  },
];

export function ReportWorkflow({
  fileName,
  file,
  onBack,
}: ReportWorkflowProps) {
  const [step, setStep] = useState<1 | 2 | 3 | 4 | 5>(1);

  // 提案名称（自动生成，可修改）- 移到步骤4
  const [proposalName, setProposalName] = useState(() => {
    const date = new Date();
    const dateStr = date
      .toLocaleDateString("zh-CN", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      })
      .replace(/\//g, "-");
    return `专利检索报告-${fileName.replace(/\.[^/.]+$/, "")}-${dateStr}`;
  });

  // Step 1: 生成检索关键词
  const [ipcList, setIPCList] = useState<IPCItem[]>([
    { code: "G06F", name: "电数字数据处理" },
    { code: "G06N", name: "基于特定计算模型的计算机系统" },
  ]);
  const [keywords, setKeywords] = useState<KeywordItem[]>([
    { word: "人工智能" },
    { word: "机器学习" },
    { word: "深度学习" },
  ]);
  const [newIPCCode, setNewIPCCode] = useState("");
  const [filteredIPCSuggestions, setFilteredIPCSuggestions] = useState<
    IPCItem[]
  >([]);
  const [newKeyword, setNewKeyword] = useState("");
  const [suggestedWords, setSuggestedWords] = useState<string[]>([]);
  const [activeKeyword, setActiveKeyword] = useState<string | null>(null);
  const [isFetchingSuggestions, setIsFetchingSuggestions] = useState(false);
  const [parsedDisclosure, setParsedDisclosure] =
    useState<ParsedDisclosure | null>(null);
  const [isParsingDisclosure, setIsParsingDisclosure] = useState(Boolean(file));
  const [disclosureParseError, setDisclosureParseError] = useState("");

  // Step 2: 生成检索式（默认选择第一个模板）
  const [selectedTemplate, setSelectedTemplate] = useState<string | null>(
    "ipc-keywords",
  );
  const [generatedFormula, setGeneratedFormula] = useState<string>("");
  const [isGeneratingFormula, setIsGeneratingFormula] = useState(false);

  // Step 3: 检索相关文件
  const [selectedPatents, setSelectedPatents] = useState<string[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [searchResults, setSearchResults] = useState<PatentItem[]>([]);
  const [originalSearchResults, setOriginalSearchResults] = useState<
    PatentItem[]
  >([]);
  const [editingPatentId, setEditingPatentId] = useState<string | null>(null);
  const [editingData, setEditingData] = useState<Partial<PatentItem>>({});

  // Step 4: 完善报告信息
  const [standardAdaptation, setStandardAdaptation] = useState(false);
  const [vehicleApplication, setVehicleApplication] = useState(false);
  const [usageProspect, setUsageProspect] = useState<"高" | "低" | "无" | "">(
    "",
  );
  const [authorizationProspect, setAuthorizationProspect] = useState<
    "高" | "中" | "低" | "无" | ""
  >("");
  const [proposalGrade, setProposalGrade] = useState<
    "A" | "B" | "C" | "不通过" | "不适用" | "需人工确认" | ""
  >("");
  const [conclusion, setConclusion] = useState("");
  const [enforcementability, setEnforcementability] = useState<
    "高" | "低" | "无" | ""
  >("");
  const [isUsedOnProduct, setIsUsedOnProduct] = useState(false);
  const [isUsedOnMarketProduct, setIsUsedOnMarketProduct] = useState(false);
  const [isStandardEssentialPatent, setIsStandardEssentialPatent] =
    useState(false);
  const [isGeneratingConclusion, setIsGeneratingConclusion] = useState(false);
  const [isEvaluatingProposal, setIsEvaluatingProposal] = useState(false);
  const [evaluationTrace, setEvaluationTrace] = useState<string[]>([]);

  // Step 5: 预览与导出
  const [reportGenerated, setReportGenerated] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [exportError, setExportError] = useState("");

  // Auto-generate formula when entering step 2
  useEffect(() => {
    if (step === 2 && selectedTemplate && !generatedFormula) {
      generateFormula(selectedTemplate);
    }
  }, [step, selectedTemplate]);

  // Auto-search when entering step 3
  useEffect(() => {
    if (step === 3 && searchResults.length === 0 && !isSearching) {
      handleSearch();
    }
  }, [step]);

  useEffect(() => {
    if (!file) return;

    let cancelled = false;
    const parseDisclosure = async () => {
      setIsParsingDisclosure(true);
      setDisclosureParseError("");
      try {
        const formData = new FormData();
        formData.append("file", file);
        const response = await fetch("/api/report/disclosure-parse", {
          method: "POST",
          body: formData,
        });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || "交底书解析失败");
        if (cancelled) return;

        const parsed = payload as ParsedDisclosure;
        setParsedDisclosure(parsed);
        if (parsed.inventionName.trim()) {
          setProposalName((current) => current || parsed.inventionName);
        }
        if (parsed.searchKeywords.length > 0) {
          setKeywords(parsed.searchKeywords.map((word) => ({ word })));
        }
        if (parsed.ipcSuggestions.length > 0) {
          setIPCList(parsed.ipcSuggestions);
        }
        setGeneratedFormula("");
      } catch (error) {
        if (!cancelled) {
          setDisclosureParseError(
            error instanceof Error ? error.message : "交底书解析失败",
          );
        }
      } finally {
        if (!cancelled) setIsParsingDisclosure(false);
      }
    };
    void parseDisclosure();
    return () => {
      cancelled = true;
    };
  }, [file]);

  // IPC handlers
  const handleIPCInputChange = (value: string) => {
    setNewIPCCode(value);
    if (value.trim()) {
      const filtered = ipcSuggestions.filter(
        (ipc) =>
          !ipcList.find((existing) => existing.code === ipc.code) &&
          (ipc.code.toLowerCase().includes(value.toLowerCase()) ||
            ipc.name.toLowerCase().includes(value.toLowerCase())),
      );
      setFilteredIPCSuggestions(filtered.slice(0, 6));
    } else {
      setFilteredIPCSuggestions([]);
    }
  };

  const addIPC = (ipc: IPCItem) => {
    setIPCList([...ipcList, ipc]);
    setNewIPCCode("");
    setFilteredIPCSuggestions([]);
  };

  const deleteIPC = (index: number) => {
    setIPCList(ipcList.filter((_, i) => i !== index));
  };

  // Keyword handlers
  const addKeyword = (word: string) => {
    if (word.trim() && !keywords.find((kw) => kw.word === word.trim())) {
      setKeywords([...keywords, { word: word.trim() }]);
      setNewKeyword("");
      setGeneratedFormula("");
    }
  };

  const deleteKeyword = (index: number) => {
    setKeywords(keywords.filter((_, i) => i !== index));
    setGeneratedFormula("");
  };

  const handleKeywordClick = async (keyword: string) => {
    if (activeKeyword === keyword) {
      setActiveKeyword(null);
      setSuggestedWords([]);
      return;
    }
    setActiveKeyword(keyword);
    setSuggestedWords([]);
    setIsFetchingSuggestions(true);
    try {
      const response = await fetch("/api/report/keyword-recommendation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ coreKeyword: keyword, desiredCount: 5 }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "扩展词生成失败");
      const recommendations: string[] = Array.isArray(payload?.data?.recommendations)
        ? payload.data.recommendations
        : [];
      const filtered = recommendations
        .map((w) => w.trim())
        .filter(Boolean)
        .filter((w) => !keywords.find((kw) => kw.word === w))
        .slice(0, 5);
      // 仅在用户仍选中该关键词时回填结果
      setActiveKeyword((current) =>
        current === keyword ? keyword : current,
      );
      setSuggestedWords(filtered);
    } catch (error) {
      console.error("扩展词生成失败:", error);
      setSuggestedWords([]);
    } finally {
      setIsFetchingSuggestions(false);
    }
  };

  const addSuggestedWord = (word: string) => {
    if (!keywords.find((kw) => kw.word === word)) {
      setKeywords([...keywords, { word }]);
      setGeneratedFormula("");
      const updatedSuggestions = suggestedWords.filter((w) => w !== word);
      setSuggestedWords(updatedSuggestions);
      if (updatedSuggestions.length === 0) {
        setActiveKeyword(null);
      }
    }
  };

  // Formula generation - 调用 /api/report/search-formula-generation
  const generateFormula = async (templateId: string) => {
    const ipcCodes = ipcList.map((ipc) => ipc.code);
    const keywordsList = keywords.map((kw) => kw.word);
    if (!keywordsList.length || !ipcCodes.length) return;

    setIsGeneratingFormula(true);
    try {
      const response = await fetch("/api/report/search-formula-generation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          keywords: keywordsList,
          ipcCodes,
          outputFormat: templateId === "keywords-only" ? "format2" : "format1",
          stream: false,
        }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.error || "检索式生成失败");
      const formula = payload?.formula || "";
      setGeneratedFormula(formula);
    } catch (error) {
      console.error("检索式生成失败:", error);
      setGeneratedFormula("");
    } finally {
      setIsGeneratingFormula(false);
    }
  };

  // Patent search - 调用 /api/report/patent-search 从 PostgreSQL 检索
  const handleSearch = async () => {
    const ipcCodes = ipcList.map((ipc) => ipc.code);
    const keywordsList = keywords.map((kw) => kw.word);
    if (!keywordsList.length && !ipcCodes.length) return;

    setIsSearching(true);
    setSearchError("");
    try {
      const response = await fetch("/api/report/patent-search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          keywords: keywordsList,
          ipcCodes,
          limit: 20,
        }),
      });
      const payload = await response.json();
      if (!response.ok)
        throw new Error(payload?.error || "专利检索失败");
      const results: PatentItem[] = (payload?.items || payload?.data || []).map((p: any) => ({
        id: String(p.id),
        title: p.title || "",
        applicant: p.applicant || "",
        publicationNumber: p.docNumber || "",
        publicationDate: p.pubDate || "",
        abstract: p.abstract || "",
        ipcCodes: Array.isArray(p.ipcCodes) ? p.ipcCodes : [],
        relevance: 0,
        similarities: "",
        differences: "",
        category: "A" as const,
      }));
      setSearchResults(results);
      setOriginalSearchResults(results);
      // 异步对每条专利做对比文献分类
      void classifyAllPatents(results);
    } catch (error) {
      const message = error instanceof Error ? error.message : "专利检索失败";
      setSearchError(message);
      setSearchResults([]);
      setOriginalSearchResults([]);
    } finally {
      setIsSearching(false);
    }
  };

  // 对比文献分类 - 调用 /api/report/document-relevance-classification
  const classifyPatent = async (patent: PatentItem): Promise<Partial<PatentItem>> => {
    const targetText = parsedDisclosure?.technicalSolution || parsedDisclosure?.technicalField || "";
    const referenceText = [patent.title, patent.abstract].filter(Boolean).join("\n");
    if (!targetText || !referenceText) return {};
    try {
      const response = await fetch("/api/report/document-relevance-classification", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetText, referenceText }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.error || "对比文献分类失败");
      const category = (["X", "Y", "A"].includes(payload?.category) ? payload.category : "A") as
        | "X"
        | "Y"
        | "A";
      const similarities = Array.isArray(payload?.featureMappings)
        ? payload.featureMappings
            .filter((m: any) => m.assessment !== "未披露")
            .map((m: any) => m.targetFeature)
            .filter(Boolean)
            .join("；")
        : "";
      const differences = Array.isArray(payload?.featureMappings)
        ? payload.featureMappings
            .filter((m: any) => m.assessment === "未披露")
            .map((m: any) => m.targetFeature)
            .filter(Boolean)
            .join("；")
        : "";
      return {
        category,
        similarities: similarities || patent.similarities,
        differences: differences || patent.differences,
        classificationConclusion: payload?.conclusion || "",
      };
    } catch (error) {
      console.error("对比文献分类失败:", error);
      return {};
    }
  };

  // 批量分类所有检索结果(限制并发为3)
  const classifyAllPatents = async (patents: PatentItem[]) => {
    const queue = [...patents];
    const concurrency = 3;
    const worker = async () => {
      while (queue.length > 0) {
        const patent = queue.shift();
        if (!patent) break;
        setSearchResults((prev) =>
          prev.map((p) =>
            p.id === patent.id ? { ...p, isClassifying: true } : p,
          ),
        );
        const patch = await classifyPatent(patent);
        setSearchResults((prev) =>
          prev.map((p) =>
            p.id === patent.id
              ? { ...p, ...patch, isClassifying: false }
              : p,
          ),
        );
      }
    };
    await Promise.all(Array.from({ length: concurrency }, worker));
  };

  // Reset search results
  const handleResetResults = () => {
    setSearchResults([...originalSearchResults]);
  };

  const togglePatentSelection = (id: string) => {
    if (selectedPatents.includes(id)) {
      setSelectedPatents(selectedPatents.filter((pid) => pid !== id));
    } else {
      setSelectedPatents([...selectedPatents, id]);
    }
  };

  // 进入 Step4 时,基于检索结果自动评估提案等级
  const handleAutoEvaluateProposal = async () => {
    if (isEvaluatingProposal) return;
    setIsEvaluatingProposal(true);
    setEvaluationTrace([]);
    try {
      const relatedADocumentCount = searchResults.filter((p) => p.category === "A").length;
      const inventionPointNames =
        parsedDisclosure?.keyTechnicalFeatures && parsedDisclosure.keyTechnicalFeatures.length > 0
          ? parsedDisclosure.keyTechnicalFeatures
          : keywords.map((k) => k.word);
      const hasAnyX = searchResults.some((p) => p.category === "X");
      const yDocumentCount = searchResults.filter((p) => p.category === "Y").length;

      const inventionPoints = inventionPointNames.map((name) => ({
        name,
        hasXDocument: hasAnyX,
        yDocumentCount,
        yCombinationObvious: false,
        isCommonKnowledgeOrObvious: false,
      }));

      const response = await fetch("/api/report/proposal-grade-evaluation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          isUsedOnProduct,
          isUsedOnMarketProduct,
          enforceability: enforcementability || "无",
          isStandardEssentialPatent,
          relatedADocumentCount,
          inventionPoints,
        }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.error || "提案等级评估失败");
      if (typeof payload?.usageProspect === "string")
        setUsageProspect(payload.usageProspect as "高" | "低" | "无");
      if (typeof payload?.authorizationProspect === "string")
        setAuthorizationProspect(payload.authorizationProspect as "高" | "中" | "低" | "无");
      if (typeof payload?.proposalGrade === "string")
        setProposalGrade(payload.proposalGrade as "A" | "B" | "C" | "不通过" | "不适用" | "需人工确认");
      if (Array.isArray(payload?.ruleTrace)) setEvaluationTrace(payload.ruleTrace);
    } catch (error) {
      console.error("提案等级评估失败:", error);
    } finally {
      setIsEvaluatingProposal(false);
    }
  };

  // 进入 Step4 时自动触发一次评估
  useEffect(() => {
    if (step === 4 && searchResults.length > 0 && !proposalGrade) {
      void handleAutoEvaluateProposal();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  // 结论生成 - 调用 /api/report/conclusion-generation (流式输出)
  const handleAutoGenerateConclusion = async () => {
    setIsGeneratingConclusion(true);
    setConclusion("");
    try {
      const searchResultsSummary =
        `共找到 ${searchResults.length} 件相关专利，` +
        `其中 X 类 ${searchResults.filter((p) => p.category === "X").length} 件、` +
        `Y 类 ${searchResults.filter((p) => p.category === "Y").length} 件、` +
        `A 类 ${searchResults.filter((p) => p.category === "A").length} 件。`;
      const keyPatentAnalysis = searchResults
        .slice(0, 5)
        .map(
          (p) =>
            `${p.publicationNumber}(${p.category}类): ${p.title}；相同点: ${p.similarities || "未标注"}；不同点: ${p.differences || "未标注"}`,
        )
        .join("\n");

      const response = await fetch("/api/report/conclusion-generation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          searchTopic: proposalName || parsedDisclosure?.inventionName || "",
          searchResults: searchResultsSummary,
          keyPatentAnalysis,
          patentMap: ipcList.map((i) => i.code).join(", ") || "暂无专利地图数据",
          innovationAssessment:
            `用途前景=${usageProspect || "未评估"};授权前景=${authorizationProspect || "未评估"};提案等级=${proposalGrade || "未评级"}`,
        }),
      });
      if (!response.ok || !response.body) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload?.error || "结论生成失败");
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let acc = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        acc += decoder.decode(value, { stream: true });
        setConclusion(acc);
      }
    } catch (error) {
      console.error("结论生成失败:", error);
    } finally {
      setIsGeneratingConclusion(false);
    }
  };

  // Generate report
  const handleGenerateReport = () => {
    setReportGenerated(true);
  };

  // 导出报告 docx - 调用 /api/report/template-export
  const handleDownloadReport = async () => {
    setIsExporting(true);
    setExportError("");
    try {
      const response = await fetch("/api/report/template-export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          proposalName,
          ipcList: ipcList.map((i) => ({ code: i.code, name: i.name })),
          generatedFormula,
          searchResults: searchResults.map((p) => ({
            publicationNumber: p.publicationNumber,
            title: p.title,
            applicant: p.applicant,
            publicationDate: p.publicationDate,
            similarities: p.similarities,
            differences: p.differences,
            category: p.category,
          })),
          standardAdaptation,
          vehicleApplication,
          usageProspect,
          authorizationProspect,
          proposalGrade,
          conclusion,
        }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload?.error || "报告导出失败");
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${proposalName || "专利检索报告"}.docx`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      setReportGenerated(true);
    } catch (error) {
      const message = error instanceof Error ? error.message : "报告导出失败";
      setExportError(message);
    } finally {
      setIsExporting(false);
    }
  };

  const copyFormula = () => {
    navigator.clipboard.writeText(generatedFormula);
  };

  return (
    <div className="flex h-screen flex-col">
      {/* Header */}
      <header className="flex items-center justify-between border-b border-border bg-card px-6 py-4">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="icon"
            onClick={onBack}
            className="bg-transparent"
          >
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div>
            <h1 className="text-lg font-semibold text-foreground">
              专利检索报告
            </h1>
            <p className="text-sm text-muted-foreground">文件：{fileName}</p>
          </div>
        </div>
      </header>

      {/* Progress Steps */}
      <div className="border-b border-border bg-card px-6 py-4">
        <div className="flex items-center justify-between">
          {[
            { num: 1, label: "生成检索关键词" },
            { num: 2, label: "生成检索式" },
            { num: 3, label: "检索相关文件" },
            { num: 4, label: "完善报告信息" },
            { num: 5, label: "生成检索报告" },
          ].map((s, index) => (
            <React.Fragment key={s.num}>
              <div className="flex flex-col items-center">
                <div
                  className={cn(
                    "flex h-10 w-10 items-center justify-center rounded-full border-2 font-semibold transition-all",
                    step === s.num
                      ? "border-primary bg-primary text-primary-foreground"
                      : step > s.num
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-border bg-background text-muted-foreground",
                  )}
                >
                  {step > s.num ? <CheckCircle className="h-5 w-5" /> : s.num}
                </div>
                <span
                  className={cn(
                    "mt-2 text-sm font-medium",
                    step >= s.num ? "text-foreground" : "text-muted-foreground",
                  )}
                >
                  {s.label}
                </span>
              </div>
              {index < 4 && (
                <div
                  className={cn(
                    "mx-4 h-0.5 w-16 transition-all",
                    step > s.num ? "bg-primary" : "bg-border",
                  )}
                />
              )}
            </React.Fragment>
          ))}
        </div>
      </div>

      {/* Content Area */}
      <main className="flex-1 overflow-y-auto p-6">
        <div className="mx-auto max-w-4xl space-y-6">
          {/* Step 1: 生成检索关键词 (复用检索式逻辑) */}
          {step === 1 && (
            <div className="space-y-6">
              {(isParsingDisclosure ||
                disclosureParseError ||
                parsedDisclosure) && (
                <div className="rounded-lg border border-primary/30 bg-primary/5 p-6">
                  <div className="mb-3 flex items-center gap-2">
                    <FileSearch className="h-5 w-5 text-primary" />
                    <h3 className="text-lg font-semibold text-foreground">
                      交底书解析与评估依据
                    </h3>
                  </div>
                  {isParsingDisclosure && (
                    <p className="text-sm text-muted-foreground">
                      正在提取技术要素并生成检索基础…
                    </p>
                  )}
                  {disclosureParseError && (
                    <p className="text-sm text-destructive">
                      {disclosureParseError}
                    </p>
                  )}
                  {parsedDisclosure && (
                    <div className="space-y-4 text-sm">
                      <div className="grid gap-3 sm:grid-cols-2">
                        <p>
                          <span className="font-medium">发明名称：</span>
                          {parsedDisclosure.inventionName || "未识别"}
                        </p>
                        <p>
                          <span className="font-medium">技术领域：</span>
                          {parsedDisclosure.technicalField || "未识别"}
                        </p>
                      </div>
                      <div>
                        <p className="font-medium">可比对的关键技术特征</p>
                        <ul className="mt-1 list-disc space-y-1 pl-5 text-muted-foreground">
                          {parsedDisclosure.keyTechnicalFeatures.map(
                            (item, index) => (
                              <li key={index}>{item}</li>
                            ),
                          )}
                        </ul>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        已自动填充下方 IPC/CPC
                        与关键词；请校正后再生成检索式。新颖性和创造性判断将在检索并比对对比文献后进行。解析文本约{" "}
                        {parsedDisclosure.sourceTextLength} 字。
                      </p>
                    </div>
                  )}
                </div>
              )}
              {/* IPC/CPC */}
              <div className="rounded-lg border border-border bg-card p-6">
                <div className="mb-4 flex items-center gap-2">
                  <BookOpen className="h-5 w-5 text-primary" />
                  <h3 className="text-lg font-semibold text-foreground">
                    IPC/CPC
                  </h3>
                </div>
                <div className="space-y-3">
                  <div className="flex flex-wrap gap-2">
                    {ipcList.map((ipc, index) => (
                      <div
                        key={index}
                        title={ipc.name}
                        className="group relative flex items-center rounded-lg border border-primary bg-primary/10 pr-8 pl-4 py-2 font-mono text-sm font-medium text-primary transition-all"
                      >
                        {ipc.code}
                        <button
                          onClick={() => deleteIPC(index)}
                          className="absolute -top-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-destructive text-white opacity-0 transition-opacity group-hover:opacity-100 hover:bg-destructive/90"
                        >
                          <X className="h-3 w-3" />
                        </button>
                        <span className="pointer-events-none absolute bottom-full left-1/2 mb-2 -translate-x-1/2 whitespace-nowrap rounded-lg bg-foreground px-3 py-1.5 text-xs text-background opacity-0 transition-opacity group-hover:opacity-100 z-10">
                          {ipc.name}
                        </span>
                      </div>
                    ))}
                  </div>

                  <div className="space-y-2">
                    <div className="flex items-center gap-2 rounded-lg border border-dashed border-border bg-accent/30 p-3">
                      <Search className="h-4 w-4 text-muted-foreground" />
                      <input
                        type="text"
                        value={newIPCCode}
                        onChange={(e) => handleIPCInputChange(e.target.value)}
                        placeholder="搜索 IPC/CPC 分类号"
                        className="flex-1 bg-transparent px-2 py-1 text-sm font-mono outline-none placeholder:text-muted-foreground"
                      />
                    </div>

                    {filteredIPCSuggestions.length > 0 && (
                      <div className="rounded-lg bg-accent/30 p-3">
                        <p className="mb-2 text-xs font-medium text-muted-foreground">
                          选择分类
                        </p>
                        <div className="flex flex-wrap gap-2">
                          {filteredIPCSuggestions.map((ipc, index) => (
                            <button
                              key={index}
                              onClick={() => addIPC(ipc)}
                              className={cn(
                                "group relative flex items-center rounded-lg border border-border bg-background px-4 py-2 font-mono text-sm font-medium text-foreground transition-all hover:border-primary hover:bg-primary/10 hover:text-primary",
                              )}
                              title={ipc.name}
                            >
                              {ipc.code}
                              <span className="pointer-events-none absolute bottom-full left-1/2 mb-2 -translate-x-1/2 whitespace-nowrap rounded-lg bg-foreground px-3 py-1.5 text-xs text-background opacity-0 transition-opacity group-hover:opacity-100 z-10">
                                {ipc.name}
                              </span>
                            </button>
                          ))}
                        </div>
                      </div>
                    )}

                    {newIPCCode.trim() &&
                      filteredIPCSuggestions.length === 0 && (
                        <div className="rounded-lg bg-accent/30 p-3 text-center">
                          <p className="text-sm text-muted-foreground">
                            未找到匹配的分类号
                          </p>
                        </div>
                      )}
                  </div>
                </div>
              </div>

              {/* Keywords */}
              <div className="rounded-lg border border-border bg-card p-6">
                <div className="mb-4 flex items-center gap-2">
                  <Tags className="h-5 w-5 text-primary" />
                  <h3 className="text-lg font-semibold text-foreground">
                    关键词
                  </h3>
                </div>
                <div className="space-y-3">
                  <div className="flex flex-wrap gap-2">
                    {keywords.map((keyword, index) => (
                      <div
                        key={index}
                        onClick={() => handleKeywordClick(keyword.word)}
                        className={cn(
                          "group relative flex items-center rounded-lg border pr-8 pl-4 py-2 text-sm font-medium transition-all cursor-pointer",
                          activeKeyword === keyword.word
                            ? "border-primary bg-primary/20 text-primary ring-2 ring-primary"
                            : "border-primary bg-primary/10 text-primary hover:bg-primary/15",
                        )}
                      >
                        {keyword.word}
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            deleteKeyword(index);
                            if (activeKeyword === keyword.word) {
                              setActiveKeyword(null);
                              setSuggestedWords([]);
                            }
                          }}
                          className="absolute -top-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-destructive text-white opacity-0 transition-opacity group-hover:opacity-100 hover:bg-destructive/90"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </div>
                    ))}
                  </div>

                  <div className="space-y-2">
                    <div className="flex items-center gap-2 rounded-lg border border-dashed border-border bg-accent/30 p-3">
                      <Plus className="h-4 w-4 text-muted-foreground" />
                      <input
                        type="text"
                        value={newKeyword}
                        onChange={(e) => setNewKeyword(e.target.value)}
                        onKeyDown={(e) =>
                          e.key === "Enter" && addKeyword(newKeyword)
                        }
                        placeholder="输入关键词"
                        className="flex-1 bg-transparent px-2 py-1 text-sm outline-none placeholder:text-muted-foreground"
                      />
                      <Button
                        onClick={() => addKeyword(newKeyword)}
                        disabled={!newKeyword.trim()}
                        size="sm"
                        className="h-8"
                      >
                        添加
                      </Button>
                    </div>

                    {suggestedWords.length > 0 && (
                      <div className="rounded-lg bg-accent/30 p-3">
                        <div className="mb-2 flex items-center gap-2">
                          <Lightbulb className="h-4 w-4 text-primary" />
                          <p className="text-xs font-medium text-muted-foreground">
                            {activeKeyword
                              ? `"${activeKeyword}" 的扩展词（同类词）`
                              : "推荐的扩展词（同类词）"}
                          </p>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {suggestedWords.map((word, index) => (
                            <button
                              key={index}
                              onClick={() => addSuggestedWord(word)}
                              className="flex items-center gap-1.5 rounded-lg border border-border bg-background px-3 py-1.5 text-sm font-medium text-foreground transition-colors hover:border-primary hover:bg-primary/10 hover:text-primary"
                            >
                              <Plus className="h-3 w-3" />
                              {word}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}

                    {isFetchingSuggestions && (
                      <div className="rounded-lg bg-accent/30 p-3 text-center">
                        <p className="text-xs text-muted-foreground">
                          正在调用大模型生成扩展词…
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Step 2: 生成检索式 */}
          {step === 2 && (
            <div className="space-y-6">
              <div className="rounded-lg border border-border bg-card p-6">
                <h2 className="mb-4 text-xl font-semibold text-foreground">
                  选择检索式模版
                </h2>
                <div className="space-y-3">
                  {templates.map((template) => (
                    <button
                      key={template.id}
                      onClick={() => {
                        setSelectedTemplate(template.id);
                        generateFormula(template.id);
                      }}
                      className={cn(
                        "w-full rounded-lg border p-4 text-left transition-all",
                        selectedTemplate === template.id
                          ? "border-primary bg-primary/5 ring-2 ring-primary"
                          : "border-border bg-background hover:border-primary hover:bg-accent",
                      )}
                    >
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <h3 className="font-semibold text-foreground">
                            {template.name}
                          </h3>
                          <p className="mt-1 text-sm text-muted-foreground">
                            {template.description}
                          </p>
                          <p className="mt-2 rounded bg-accent/50 px-3 py-2 font-mono text-xs text-foreground">
                            {template.example}
                          </p>
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              {isGeneratingFormula && (
                <div className="rounded-lg border border-primary bg-primary/5 p-6">
                  <div className="flex items-center gap-3">
                    <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent"></div>
                    <p className="text-sm text-muted-foreground">
                      大模型正在按 IncoPat 标准生成检索式…
                    </p>
                  </div>
                </div>
              )}

              {!isGeneratingFormula && generatedFormula && (
                <div className="rounded-lg border border-primary bg-primary/5 p-6">
                  <div className="mb-3 flex items-center justify-between">
                    <h3 className="font-semibold text-foreground">
                      生成的检索式
                    </h3>
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() =>
                          selectedTemplate && generateFormula(selectedTemplate)
                        }
                        className="gap-2 bg-transparent"
                      >
                        <Sparkles className="h-4 w-4" />
                        重新生成
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={copyFormula}
                        className="gap-2 bg-transparent"
                      >
                        <FileText className="h-4 w-4" />
                        复制
                      </Button>
                    </div>
                  </div>
                  <Textarea
                    value={generatedFormula}
                    onChange={(e) => setGeneratedFormula(e.target.value)}
                    className="min-h-[100px] resize-y font-mono text-sm bg-background border-border"
                    placeholder="生成的检索式将显示在这里，支持手动编辑"
                  />
                </div>
              )}
            </div>
          )}

          {/* Step 3: 检索相关文件 */}
          {step === 3 && (
            <div className="space-y-6">
              <div className="rounded-lg border border-border bg-card p-6">
                <div className="mb-4 flex items-center justify-between">
                  <h2 className="text-xl font-semibold text-foreground">
                    检索专利文献
                  </h2>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => void handleSearch()}
                      disabled={isSearching}
                      className="gap-2 bg-transparent"
                    >
                      <Search className="h-4 w-4" />
                      重新检索
                    </Button>
                    {originalSearchResults.length > 0 && (
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button
                            variant="outline"
                            size="sm"
                            className="gap-2 bg-transparent"
                          >
                            <ArrowLeft className="h-4 w-4" />
                            重置
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>确认重置</AlertDialogTitle>
                            <AlertDialogDescription>
                              该操作将抹去列表中的所有修改
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>取消</AlertDialogCancel>
                            <AlertDialogAction onClick={handleResetResults}>
                              确认
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    )}
                  </div>
                </div>

                {isSearching && (
                  <div className="flex flex-col items-center justify-center py-12">
                    <div className="mb-4 h-12 w-12 animate-spin rounded-full border-4 border-primary border-t-transparent"></div>
                    <p className="text-muted-foreground">正在从 PostgreSQL 数据库检索专利文献...</p>
                  </div>
                )}

                {!isSearching && searchError && (
                  <div className="rounded-lg border border-destructive bg-destructive/5 p-4">
                    <p className="text-sm text-destructive">{searchError}</p>
                  </div>
                )}

                {!isSearching && !searchError && searchResults.length === 0 && (
                  <div className="rounded-lg bg-accent/30 p-6 text-center">
                    <p className="text-sm text-muted-foreground">
                      暂无检索结果，请确认关键词/IPC 分类后重新检索
                    </p>
                  </div>
                )}

                {searchResults.length > 0 && (
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <p className="text-sm text-muted-foreground">
                        共找到 {searchResults.length} 条相关专利
                      </p>
                      <p className="text-xs text-muted-foreground">
                        X:{searchResults.filter((p) => p.category === "X").length}{" "}
                        Y:{searchResults.filter((p) => p.category === "Y").length}{" "}
                        A:{searchResults.filter((p) => p.category === "A").length}
                      </p>
                    </div>
                    <div className="overflow-hidden rounded-lg border border-border">
                      <table className="w-full">
                        <thead className="bg-accent/50">
                          <tr>
                            <th className="border-b border-border px-4 py-3 text-left text-sm font-semibold text-foreground">
                              专利信息
                            </th>
                            <th className="border-b border-border px-4 py-3 text-left text-sm font-semibold text-foreground">
                              相同点
                            </th>
                            <th className="border-b border-border px-4 py-3 text-left text-sm font-semibold text-foreground">
                              不同点
                            </th>
                            <th className="border-b border-border px-4 py-3 text-center text-sm font-semibold text-foreground">
                              判定
                            </th>
                            <th className="border-b border-border px-4 py-3 text-center text-sm font-semibold text-foreground">
                              操作
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {searchResults.map((patent) => (
                            <tr
                              key={patent.id}
                              className="border-b border-border hover:bg-accent/30 transition-colors"
                            >
                              <td className="px-4 py-4">
                                <div className="space-y-1">
                                  <div className="font-mono text-sm font-medium text-primary">
                                    {patent.publicationNumber}
                                    {patent.publicationDate && (
                                      <span className="ml-2 text-xs text-muted-foreground">
                                        {patent.publicationDate}
                                      </span>
                                    )}
                                  </div>
                                  <div className="text-sm font-medium text-foreground">
                                    {patent.title}
                                  </div>
                                  {patent.applicant && (
                                    <div className="text-xs text-muted-foreground">
                                      申请人：{patent.applicant}
                                    </div>
                                  )}
                                  {patent.ipcCodes.length > 0 && (
                                    <div className="text-xs text-muted-foreground">
                                      IPC：{patent.ipcCodes.join(", ")}
                                    </div>
                                  )}
                                  {patent.abstract && (
                                    <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                                      {patent.abstract}
                                    </p>
                                  )}
                                  {patent.isClassifying && (
                                    <p className="mt-1 text-xs text-primary">
                                      正在调用对比文献分类模型…
                                    </p>
                                  )}
                                  {!patent.isClassifying &&
                                    patent.classificationConclusion && (
                                      <p className="mt-1 text-xs text-muted-foreground">
                                        分类结论：{patent.classificationConclusion}
                                      </p>
                                    )}
                                </div>
                              </td>
                              <td className="px-4 py-4 text-sm text-foreground max-w-xs">
                                {editingPatentId === patent.id ? (
                                  <Textarea
                                    value={editingData.similarities || ""}
                                    onChange={(e) =>
                                      setEditingData({
                                        ...editingData,
                                        similarities: e.target.value,
                                      })
                                    }
                                    className="min-h-[80px]"
                                  />
                                ) : (
                                  patent.similarities || "—"
                                )}
                              </td>
                              <td className="px-4 py-4 text-sm text-foreground max-w-xs">
                                {editingPatentId === patent.id ? (
                                  <Textarea
                                    value={editingData.differences || ""}
                                    onChange={(e) =>
                                      setEditingData({
                                        ...editingData,
                                        differences: e.target.value,
                                      })
                                    }
                                    className="min-h-[80px]"
                                  />
                                ) : (
                                  patent.differences || "—"
                                )}
                              </td>
                              <td className="px-4 py-4 text-center">
                                {editingPatentId === patent.id ? (
                                  <Select
                                    value={editingData.category || ""}
                                    onValueChange={(value) =>
                                      setEditingData({
                                        ...editingData,
                                        category: value as "X" | "Y" | "A",
                                      })
                                    }
                                  >
                                    <SelectTrigger className="w-[80px]">
                                      <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                      <SelectItem value="X">X</SelectItem>
                                      <SelectItem value="Y">Y</SelectItem>
                                      <SelectItem value="A">A</SelectItem>
                                    </SelectContent>
                                  </Select>
                                ) : (
                                  <span
                                    className={cn(
                                      "inline-flex items-center justify-center rounded-lg px-3 py-1 text-sm font-bold",
                                      patent.category === "X" &&
                                        "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
                                      patent.category === "Y" &&
                                        "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
                                      patent.category === "A" &&
                                        "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
                                    )}
                                  >
                                    {patent.category}
                                  </span>
                                )}
                              </td>
                              <td className="px-4 py-4">
                                <div className="flex items-center justify-center gap-1">
                                  <TooltipProvider>
                                    {editingPatentId === patent.id ? (
                                      <Tooltip>
                                        <TooltipTrigger asChild>
                                          <Button
                                            variant="ghost"
                                            size="icon"
                                            onClick={() => {
                                              setSearchResults(
                                                searchResults.map((p) =>
                                                  p.id === patent.id
                                                    ? { ...p, ...editingData }
                                                    : p,
                                                ),
                                              );
                                              setEditingPatentId(null);
                                              setEditingData({});
                                            }}
                                            className="h-8 w-8 text-primary hover:text-primary/90"
                                          >
                                            <Save className="h-4 w-4" />
                                          </Button>
                                        </TooltipTrigger>
                                        <TooltipContent>
                                          保存修改
                                        </TooltipContent>
                                      </Tooltip>
                                    ) : (
                                      <Tooltip>
                                        <TooltipTrigger asChild>
                                          <Button
                                            variant="ghost"
                                            size="icon"
                                            onClick={() => {
                                              setEditingPatentId(patent.id);
                                              setEditingData(patent);
                                            }}
                                            className="h-8 w-8 text-muted-foreground hover:text-primary"
                                          >
                                            <Pencil className="h-4 w-4" />
                                          </Button>
                                        </TooltipTrigger>
                                        <TooltipContent>
                                          编辑信息
                                        </TooltipContent>
                                      </Tooltip>
                                    )}

                                    <Tooltip>
                                      <TooltipTrigger asChild>
                                        <Button
                                          variant="ghost"
                                          size="icon"
                                          disabled={patent.isClassifying}
                                          onClick={async () => {
                                            setSearchResults((prev) =>
                                              prev.map((p) =>
                                                p.id === patent.id
                                                  ? { ...p, isClassifying: true }
                                                  : p,
                                              ),
                                            );
                                            const patch = await classifyPatent(patent);
                                            setSearchResults((prev) =>
                                              prev.map((p) =>
                                                p.id === patent.id
                                                  ? { ...p, ...patch, isClassifying: false }
                                                  : p,
                                              ),
                                            );
                                          }}
                                          className="h-8 w-8 text-muted-foreground hover:text-primary"
                                        >
                                          <FileSearch className="h-4 w-4" />
                                        </Button>
                                      </TooltipTrigger>
                                      <TooltipContent>对比文献分类</TooltipContent>
                                    </Tooltip>

                                    <Tooltip>
                                      <TooltipTrigger asChild>
                                        <Button
                                          variant="ghost"
                                          size="icon"
                                          onClick={() => {
                                            setSearchResults(
                                              searchResults.filter(
                                                (p) => p.id !== patent.id,
                                              ),
                                            );
                                          }}
                                          className="h-8 w-8 text-muted-foreground hover:text-destructive"
                                        >
                                          <Trash2 className="h-4 w-4" />
                                        </Button>
                                      </TooltipTrigger>
                                      <TooltipContent>删除条目</TooltipContent>
                                    </Tooltip>
                                  </TooltipProvider>
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Step 4: 完善报告信息 */}
          {step === 4 && (
            <div className="space-y-6">
              <div className="rounded-lg border border-border bg-card p-6">
                <h2 className="mb-4 text-xl font-semibold text-foreground">
                  完善报告信息
                </h2>
                <p className="mb-6 text-muted-foreground">
                  请填写以下信息以完成检索报告：
                </p>

                <div className="space-y-6">
                  {/* 提案名称 */}
                  <div>
                    <label className="mb-2 block text-sm font-medium text-foreground">
                      提案名称
                    </label>
                    <input
                      type="text"
                      value={proposalName}
                      onChange={(e) => setProposalName(e.target.value)}
                      placeholder="提案名称（可修改）"
                      className="w-full rounded-lg border border-border bg-background px-4 py-2 text-foreground outline-none transition-colors focus:border-primary"
                    />
                  </div>

                  {/* 评估依据 */}
                  <div className="rounded-lg border border-border bg-accent/20 p-4">
                    <div className="mb-3 flex items-center justify-between">
                      <h3 className="text-sm font-semibold text-foreground">
                        规则评估依据
                      </h3>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => void handleAutoEvaluateProposal()}
                        disabled={isEvaluatingProposal || searchResults.length === 0}
                        className="gap-2 bg-transparent"
                      >
                        {isEvaluatingProposal ? (
                          <>
                            <div className="h-3 w-3 animate-spin rounded-full border border-primary border-t-transparent"></div>
                            评估中
                          </>
                        ) : (
                          <>
                            <Sparkles className="h-4 w-4" />
                            重新评估
                          </>
                        )}
                      </Button>
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={isUsedOnProduct}
                          onChange={(e) => setIsUsedOnProduct(e.target.checked)}
                          className="h-4 w-4 rounded border-border text-primary focus:ring-2 focus:ring-primary"
                        />
                        <span className="text-sm text-foreground">已用于产品/计划用于具体车型</span>
                      </label>
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={isUsedOnMarketProduct}
                          onChange={(e) => setIsUsedOnMarketProduct(e.target.checked)}
                          className="h-4 w-4 rounded border-border text-primary focus:ring-2 focus:ring-primary"
                        />
                        <span className="text-sm text-foreground">已用于上市车型</span>
                      </label>
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={isStandardEssentialPatent}
                          onChange={(e) => setIsStandardEssentialPatent(e.target.checked)}
                          className="h-4 w-4 rounded border-border text-primary focus:ring-2 focus:ring-primary"
                        />
                        <span className="text-sm text-foreground">标准必要专利 (SEP)</span>
                      </label>
                      <div>
                        <label className="mb-1 block text-xs font-medium text-muted-foreground">
                          维权性
                        </label>
                        <div className="flex gap-2">
                          {["高", "低", "无"].map((option) => (
                            <button
                              key={option}
                              onClick={() => setEnforcementability(option as any)}
                              className={cn(
                                "flex-1 rounded-md border px-2 py-1 text-xs font-medium transition-all",
                                enforcementability === option
                                  ? "border-primary bg-primary/10 text-primary"
                                  : "border-border bg-background text-foreground hover:bg-accent",
                              )}
                            >
                              {option}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>
                    {evaluationTrace.length > 0 && (
                      <div className="mt-3 rounded-md bg-background p-3 text-xs text-muted-foreground">
                        <p className="mb-1 font-medium text-foreground">规则轨迹</p>
                        <ul className="space-y-1 list-disc pl-4">
                          {evaluationTrace.map((item, idx) => (
                            <li key={idx}>{item}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>

                  {/* 标准适配 和 车型应用 */}
                  <div className="flex gap-6">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={standardAdaptation}
                        onChange={(e) =>
                          setStandardAdaptation(e.target.checked)
                        }
                        className="h-5 w-5 rounded border-border text-primary focus:ring-2 focus:ring-primary"
                      />
                      <span className="text-sm font-medium text-foreground">
                        标准适配
                      </span>
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={vehicleApplication}
                        onChange={(e) =>
                          setVehicleApplication(e.target.checked)
                        }
                        className="h-5 w-5 rounded border-border text-primary focus:ring-2 focus:ring-primary"
                      />
                      <span className="text-sm font-medium text-foreground">
                        车型应用
                      </span>
                    </label>
                  </div>

                  {/* 用途前景 */}
                  <div>
                    <label className="mb-2 block text-sm font-medium text-foreground">
                      用途前景
                    </label>
                    <div className="flex gap-3">
                      {["高", "低", "无"].map((option) => (
                        <button
                          key={option}
                          onClick={() => setUsageProspect(option as any)}
                          className={cn(
                            "flex-1 rounded-lg border px-4 py-2 text-sm font-medium transition-all",
                            usageProspect === option
                              ? "border-primary bg-primary/10 text-primary"
                              : "border-border bg-background text-foreground hover:bg-accent",
                          )}
                        >
                          {option}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* 授权前景 */}
                  <div>
                    <label className="mb-2 block text-sm font-medium text-foreground">
                      授权前景
                    </label>
                    <div className="flex gap-3">
                      {["高", "中", "低", "无"].map((option) => (
                        <button
                          key={option}
                          onClick={() =>
                            setAuthorizationProspect(option as any)
                          }
                          className={cn(
                            "flex-1 rounded-lg border px-4 py-2 text-sm font-medium transition-all",
                            authorizationProspect === option
                              ? "border-primary bg-primary/10 text-primary"
                              : "border-border bg-background text-foreground hover:bg-accent",
                          )}
                        >
                          {option}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* 提案等级 */}
                  <div>
                    <label className="mb-2 block text-sm font-medium text-foreground">
                      提案等级
                    </label>
                    <div className="flex flex-wrap gap-3">
                      {["A", "B", "C", "不通过", "不适用", "需人工确认"].map((option) => (
                        <button
                          key={option}
                          onClick={() => setProposalGrade(option as any)}
                          className={cn(
                            "flex-1 rounded-lg border px-4 py-2 text-sm font-medium transition-all",
                            proposalGrade === option
                              ? "border-primary bg-primary/10 text-primary"
                              : "border-border bg-background text-foreground hover:bg-accent",
                          )}
                        >
                          {option}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* 结论 */}
                  <div>
                    <div className="mb-2 flex items-center justify-between">
                      <label className="text-sm font-medium text-foreground">
                        结论
                      </label>
                      <div className="flex items-center gap-2">
                        {isGeneratingConclusion && (
                          <span className="text-xs text-muted-foreground">
                            大模型流式生成中…
                          </span>
                        )}
                        {conclusion.trim() && !isGeneratingConclusion ? (
                          <AlertDialog>
                            <AlertDialogTrigger asChild>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-8 gap-2 text-primary hover:text-primary/90"
                            >
                              <Sparkles className="h-4 w-4" />
                              生成结论
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>确认生成</AlertDialogTitle>
                              <AlertDialogDescription>
                                该操作将覆盖结论框中的所有内容，是否继续？
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>取消</AlertDialogCancel>
                              <AlertDialogAction
                                onClick={handleAutoGenerateConclusion}
                              >
                                确认
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                        ) : (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={handleAutoGenerateConclusion}
                            disabled={isGeneratingConclusion}
                            className="h-8 gap-2 text-primary hover:text-primary/90"
                          >
                            {isGeneratingConclusion ? (
                              <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent"></div>
                            ) : (
                              <Sparkles className="h-4 w-4" />
                            )}
                            生成结论
                          </Button>
                        )}
                      </div>
                    </div>
                    <textarea
                      value={conclusion}
                      onChange={(e) => setConclusion(e.target.value)}
                      placeholder="结论将根据上述信息通过大模型自动生成，您也可以手动修改..."
                      rows={12}
                      className="w-full rounded-lg border border-border bg-background px-4 py-3 text-sm text-foreground outline-none transition-colors focus:border-primary resize-none"
                    />
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Step 5: 生成最终结论 */}
          {step === 5 && (
            <div className="space-y-6">
              <div className="rounded-lg border border-primary bg-primary/5 p-6">
                <div className="mb-6 flex items-center gap-3">
                  <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary">
                    <CheckCircle className="h-6 w-6 text-primary-foreground" />
                  </div>
                  <div>
                    <h2 className="text-xl font-semibold text-foreground">
                      检索报告已生成
                    </h2>
                    <p className="text-sm text-muted-foreground">
                      点击下方"下载报告 (DOCX)"以通过 template-export 模板生成文档
                    </p>
                  </div>
                </div>
                {exportError && (
                  <div className="mb-4 rounded-lg border border-destructive bg-destructive/5 p-3">
                    <p className="text-sm text-destructive">{exportError}</p>
                  </div>
                )}
                <div className="space-y-4">
                  {/* 1. 提案名称 */}
                  <div className="rounded-lg border border-border bg-background p-4">
                    <h3 className="mb-2 font-semibold text-foreground">
                      提案名称
                    </h3>
                    <p className="text-sm text-foreground">{proposalName}</p>
                  </div>

                  {/* 2. 检索日期 */}
                  <div className="rounded-lg border border-border bg-background p-4">
                    <h3 className="mb-2 font-semibold text-foreground">
                      检索日期
                    </h3>
                    <p className="text-sm text-foreground">
                      {new Date().toLocaleDateString("zh-CN", {
                        year: "numeric",
                        month: "2-digit",
                        day: "2-digit",
                      })}
                    </p>
                  </div>

                  {/* 3. 检索领域 */}
                  <div className="rounded-lg border border-border bg-background p-4">
                    <h3 className="mb-2 font-semibold text-foreground">
                      检索领域
                    </h3>
                    <div className="space-y-1 text-sm text-foreground">
                      <p>
                        IPC/CPC 分类号：
                        {ipcList.map((ipc) => ipc.code).join(", ")}
                      </p>
                      <p>关键词：{keywords.map((kw) => kw.word).join("、")}</p>
                    </div>
                  </div>

                  {/* 4. 检索式 */}
                  <div className="rounded-lg border border-border bg-background p-4">
                    <h3 className="mb-2 font-semibold text-foreground">
                      检索式
                    </h3>
                    <div className="rounded-lg bg-accent/30 p-3 font-mono text-sm text-foreground">
                      {generatedFormula}
                    </div>
                  </div>

                  {/* 5. 相关文件 */}
                  <div className="rounded-lg border border-border bg-background p-4">
                    <h3 className="mb-3 font-semibold text-foreground">
                      相关文件（共 {searchResults.length} 件）
                    </h3>
                    <div className="overflow-hidden rounded-lg border border-border">
                      <table className="w-full">
                        <thead className="bg-accent/50">
                          <tr>
                            <th className="border-b border-border px-4 py-2 text-left text-sm font-semibold text-foreground">
                              公开号
                            </th>
                            <th className="border-b border-border px-4 py-2 text-left text-sm font-semibold text-foreground">
                              专利名称
                            </th>
                            <th className="border-b border-border px-4 py-2 text-left text-sm font-semibold text-foreground">
                              相同点
                            </th>
                            <th className="border-b border-border px-4 py-2 text-left text-sm font-semibold text-foreground">
                              不同点
                            </th>
                            <th className="border-b border-border px-4 py-2 text-center text-sm font-semibold text-foreground">
                              判定
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {searchResults.map((patent) => (
                            <tr
                              key={patent.id}
                              className="border-b border-border"
                            >
                              <td className="px-4 py-2 font-mono text-sm text-foreground">
                                {patent.publicationNumber}
                              </td>
                              <td className="px-4 py-2 text-sm text-foreground">
                                {patent.title}
                              </td>
                              <td className="px-4 py-2 text-sm text-foreground">
                                {patent.similarities || "—"}
                              </td>
                              <td className="px-4 py-2 text-sm text-foreground">
                                {patent.differences || "—"}
                              </td>
                              <td className="px-4 py-2 text-center">
                                <span
                                  className={cn(
                                    "inline-flex items-center justify-center rounded px-2 py-0.5 text-xs font-bold",
                                    patent.category === "X" &&
                                      "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
                                    patent.category === "Y" &&
                                      "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
                                    patent.category === "A" &&
                                      "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
                                  )}
                                >
                                  {patent.category}
                                </span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  {/* 6. 结论 */}
                  <div className="rounded-lg border border-border bg-background p-4">
                    <h3 className="mb-2 font-semibold text-foreground">结论</h3>
                    <div className="whitespace-pre-wrap text-sm text-foreground">
                      {conclusion}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </main>

      {/* Footer Navigation */}
      <footer className="flex items-center justify-between border-t border-border bg-card px-6 py-4">
        <div>
          {step > 1 && (
            <Button
              variant="outline"
              onClick={() => {
                setStep((step - 1) as any);
              }}
              className="gap-2 bg-transparent"
            >
              <ArrowLeft className="h-4 w-4" />
              上一步
            </Button>
          )}
        </div>
        <div className="flex gap-2">
          {step < 5 ? (
            <Button
              onClick={() => {
                setStep((step + 1) as any);
              }}
              disabled={
                (step === 1 &&
                  (ipcList.length === 0 || keywords.length === 0)) ||
                (step === 2 && !generatedFormula) ||
                (step === 3 && searchResults.length === 0)
              }
              className="gap-2"
            >
              下一步
              <ArrowRight className="h-4 w-4" />
            </Button>
          ) : (
            <Button
              onClick={() => void handleDownloadReport()}
              disabled={isExporting}
              className="gap-2"
            >
              {isExporting ? (
                <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary-foreground border-t-transparent"></div>
              ) : (
                <Download className="h-4 w-4" />
              )}
              下载报告 (DOCX)
            </Button>
          )}
        </div>
      </footer>
    </div>
  );
}
