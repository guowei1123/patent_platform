import { useState, useRef } from "react";
import { toast } from "sonner";
import type {
  ContentBlock,
  KeywordDefinition,
  AIWarning,
  ProblemDetectionResult,
} from "./types";
import { callStreamAPI, fileToBase64, detectImage } from "./service";
import { inspectTechnicalSolution } from "@/src/mastra/disclosure/technical-solution-policy";

export function useDisclosureWorkflow() {
  const [step, setStep] = useState<1 | 2 | 3 | 4 | 5>(1);

  // Step 1: 基本信息
  const [inventionName, setInventionName] = useState("");
  const [contactPerson, setContactPerson] = useState("");
  const [applicationType, setApplicationType] = useState<
    "发明" | "实用新型" | ""
  >("");
  const [technicalField, setTechnicalField] = useState("");

  // Step 2: 技术背景
  const [techBackground, setTechBackground] = useState("");
  const [isGeneratingBackground, setIsGeneratingBackground] = useState(false);
  const [existingProblems, setExistingProblems] = useState("");

  // Step 3: 技术方案
  const [contentBlocks, setContentBlocks] = useState<ContentBlock[]>([
    { id: "1", type: "text", content: "" },
  ]);
  const [isRewriting, setIsRewriting] = useState(false);
  const [optimizingBlockId, setOptimizingBlockId] = useState<string | null>(
    null,
  );
  const [keywords, setKeywords] = useState<KeywordDefinition[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [aiWarnings, setAiWarnings] = useState<AIWarning[]>([]);
  const [problemDetectionResult, setProblemDetectionResult] =
    useState<ProblemDetectionResult>({
      content: "",
      isLoading: false,
    });

  // Step 4: 有益效果与保护点
  const [beneficialEffects, setBeneficialEffects] = useState("");
  const [protectionPoints, setProtectionPoints] = useState("");
  const [isGeneratingBeneficialEffects, setIsGeneratingBeneficialEffects] =
    useState(false);
  const [isGeneratingProtectionPoints, setIsGeneratingProtectionPoints] =
    useState(false);

  // Step 5: 导出状态
  const [isExporting, setIsExporting] = useState(false);

  // 获取技术方案文本
  const getTechSolutionText = () => {
    return contentBlocks
      .filter((block) => block.type === "text")
      .map((block) => block.content)
      .join("\n");
  };

  // 生成技术背景
  const generateTechBackground = async (type: "ai" | "refresh") => {
    if (!inventionName.trim() || !technicalField.trim()) {
      toast.error("请先填写发明名称和技术领域");
      return;
    }

    setIsGeneratingBackground(true);

    try {
      // 如果是刷新或当前内容不为空，则将当前内容作为 existingProblems 发送
      // 如果为空，则发送默认提示
      const problemToSubmit =
        existingProblems.trim() || "（未提供具体问题，请根据通用情况分析）";

      setTechBackground("");
      await callStreamAPI(
        "/api/disclosure/background-generation",
        {
          inventionName,
          technicalField,
          existingProblems: problemToSubmit,
        },
        (chunk) => setTechBackground((prev) => prev + chunk),
      );
    } catch (error) {
      toast.error("AI生成失败，请点击重新生成按钮");
    } finally {
      setIsGeneratingBackground(false);
    }
  };

  // 添加内容块
  const addContentBlock = (type: "text" | "image") => {
    const newBlock: ContentBlock = {
      id: Date.now().toString(),
      type,
      content: "",
    };
    setContentBlocks([...contentBlocks, newBlock]);
  };

  // 更新内容块
  const updateContentBlock = (id: string, content: string) => {
    setContentBlocks(
      contentBlocks.map((block) =>
        block.id === id ? { ...block, content } : block,
      ),
    );
  };

  // 删除内容块
  const deleteContentBlock = (id: string) => {
    if (contentBlocks.length > 1) {
      setContentBlocks(contentBlocks.filter((block) => block.id !== id));
    }
  };

  // 处理图片上传和检测
  const handleImageUpload = async (
    id: string,
    e: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // 设置检测状态
    setContentBlocks(
      contentBlocks.map((block) =>
        block.id === id ? { ...block, isDetecting: true } : block,
      ),
    );

    try {
      // 生成预览URL
      const url = URL.createObjectURL(file);

      // 转换图片为base64
      const imageBase64 = await fileToBase64(file);

      // 调用图片检测API
      const detectionResult = await detectImage(imageBase64);

      // 更新图片块
      setContentBlocks(
        contentBlocks.map((block) =>
          block.id === id
            ? {
                ...block,
                imageUrl: url,
                content: file.name,
                detectionResult,
                isDetecting: false,
              }
            : block,
        ),
      );

      // 如果检测不通过，添加到警告列表
      if (!detectionResult.pass) {
        setAiWarnings((prev) => [
          ...prev,
          {
            type: "image",
            message: `图片检测未通过：${detectionResult.reason}`,
          },
        ]);
      }
    } catch (error) {
      console.error("图片处理失败:", error);

      // 更新图片块（只设置预览，不设置检测结果）
      const url = URL.createObjectURL(file);
      setContentBlocks(
        contentBlocks.map((block) =>
          block.id === id
            ? {
                ...block,
                imageUrl: url,
                content: file.name,
                isDetecting: false,
              }
            : block,
        ),
      );

      toast.error("图片检测失败，请稍后重新上传检测");
    }
  };

  // 重新检测图片
  const handleRedetectImage = async (id: string) => {
    const block = contentBlocks.find((b) => b.id === id);
    if (!block?.imageUrl) return;

    setContentBlocks(
      contentBlocks.map((block) =>
        block.id === id ? { ...block, isDetecting: true } : block,
      ),
    );

    try {
      const detectionResult = await detectImage(block.imageUrl);

      setContentBlocks(
        contentBlocks.map((block) =>
          block.id === id
            ? {
                ...block,
                detectionResult,
                isDetecting: false,
              }
            : block,
        ),
      );

      // 更新警告列表
      if (!detectionResult.pass) {
        setAiWarnings((prev) => {
          const filtered = prev.filter((w) => !w.message.includes(id));
          return [
            ...filtered,
            {
              type: "image",
              message: `图片检测未通过：${detectionResult.reason}`,
            },
          ];
        });
      } else {
        setAiWarnings((prev) => prev.filter((w) => !w.message.includes(id)));
      }
    } catch (error) {
      console.error("重新检测失败:", error);
      setContentBlocks(
        contentBlocks.map((block) =>
          block.id === id ? { ...block, isDetecting: false } : block,
        ),
      );
      toast.error("重新检测失败，请稍后重试");
    }
  };

  // 单个文本块 AI 优化
  const handleOptimizeBlock = async (id: string) => {
    const block = contentBlocks.find((b) => b.id === id);
    if (!block || !block.content.trim()) {
      toast.error("请先输入要优化的内容");
      return false;
    }
    const assessment = inspectTechnicalSolution(block.content);
    if (!assessment.ready) {
      toast.error(assessment.message);
      return false;
    }

    setOptimizingBlockId(id);

    try {
      const optimized = await callStreamAPI(
        "/api/disclosure/proposal-text-optimization",
        {
          text: block.content,
          optimizationType: "standard",
        },
      );

      // 更新文本块内容
      setContentBlocks((prev) =>
        prev.map((block) => {
          if (block.id === id && block.type === "text") {
            return {
              ...block,
              content: optimized,
            };
          }
          return block;
        }),
      );

      toast.success("文本优化完成");
      return true;
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "语言和格式优化未完成，原文已保留",
      );
      return false;
    } finally {
      setOptimizingBlockId(null);
    }
  };

  // 提取关键词
  const extractKeywords = async () => {
    const techSolutionText = getTechSolutionText();
    if (!techSolutionText.trim()) {
      toast.error("请先输入技术方案内容");
      return;
    }

    try {
      const response = await fetch("/api/disclosure/explanation-of-keywords", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ techSolution: techSolutionText }),
      });

      if (!response.ok) {
        throw new Error("关键词提取失败");
      }

      const result = await response.json();

      // 合并关键词，避免重复
      if (result.keywords && Array.isArray(result.keywords)) {
        setKeywords((prev) => {
          const existingTerms = new Set(prev.map((kw) => kw.term));
          const newKeywords = result.keywords
            .filter((kw: any) => !existingTerms.has(kw.term))
            .map((kw: any) => ({
              term: kw.term,
              definition: kw.explanation,
            }));
          return [...prev, ...newKeywords];
        });

        toast.success(`成功提取 ${result.keywords.length} 个关键词`);
      }
    } catch (error) {
      console.error("关键词提取失败:", error);
      toast.error("关键词提取失败，请稍后重新点击提取");
    }
  };

  // 问题检测
  const detectProblems = async () => {
    const techSolutionText = getTechSolutionText();
    if (!techSolutionText.trim()) {
      return;
    }

    setProblemDetectionResult((prev) => ({ ...prev, isLoading: true }));

    try {
      const result = await callStreamAPI(
        "/api/disclosure/problem-detection",
        {
          technicalSolution: techSolutionText,
        },
        (chunk) =>
          setProblemDetectionResult((prev) => ({
            ...prev,
            content: prev.content + chunk,
          })),
      );

      setProblemDetectionResult({ content: result, isLoading: false });
    } catch (error) {
      console.error("问题检测失败:", error);
      setProblemDetectionResult((prev) => ({ ...prev, isLoading: false }));
    }
  };

  // AI 风格化改写
  const handleAIRewrite = async () => {
    const textBlocks = contentBlocks
      .filter((b) => b.type === "text" && b.content.trim())
      .map((b) => ({ id: b.id, content: b.content }));

    if (textBlocks.length === 0) {
      toast.error("请先输入技术方案内容");
      return;
    }

    setIsRewriting(true);

    try {
      // 逐个优化文本块
      for (const block of textBlocks) {
        if (!(await handleOptimizeBlock(block.id))) return;
      }

      // 自动提取关键词
      await extractKeywords();

      // 自动调用问题检测
      await detectProblems();

      toast.success("AI优化完成");
    } catch (error) {
      toast.error("AI优化失败，请稍后重试");
    } finally {
      setIsRewriting(false);
    }
  };

  // 生成有益效果
  const generateBeneficialEffects = async () => {
    const techSolutionText = getTechSolutionText();

    if (!techBackground.trim() || !techSolutionText.trim()) {
      toast.error("请先完成技术背景和技术方案");
      return;
    }

    setIsGeneratingBeneficialEffects(true);

    try {
      setBeneficialEffects("");
      await callStreamAPI(
        "/api/disclosure/beneficial-effect-generation",
        {
          technicalBackground: techBackground,
          technicalSolution: techSolutionText,
        },
        (chunk) => setBeneficialEffects((prev) => prev + chunk),
      );

      toast.success("有益效果生成完成");
    } catch (error) {
      toast.error("有益效果生成失败");
    } finally {
      setIsGeneratingBeneficialEffects(false);
    }
  };

  // 生成保护点
  const generateProtectionPoints = async () => {
    const techSolutionText = getTechSolutionText();

    if (!techBackground.trim() || !techSolutionText.trim()) {
      toast.error("请先完成技术背景和技术方案");
      return;
    }

    setIsGeneratingProtectionPoints(true);

    try {
      setProtectionPoints("");
      await callStreamAPI(
        "/api/disclosure/pre-protection-point-generation",
        {
          technicalBackground: techBackground,
          technicalSolution: techSolutionText,
        },
        (chunk) => setProtectionPoints((prev) => prev + chunk),
      );

      toast.success("保护点生成完成");
    } catch (error) {
      toast.error("保护点生成失败");
    } finally {
      setIsGeneratingProtectionPoints(false);
    }
  };

  // 关键词管理
  const addKeyword = () => {
    setKeywords([...keywords, { term: "", definition: "" }]);
  };

  const updateKeyword = (
    index: number,
    field: keyof KeywordDefinition,
    value: string,
  ) => {
    const newKeywords = [...keywords];
    newKeywords[index] = { ...newKeywords[index], [field]: value };
    setKeywords(newKeywords);
  };

  const deleteKeyword = (index: number) => {
    setKeywords(keywords.filter((_, i) => i !== index));
  };

  // DOCX模板导出功能
  const handleExportDocx = async () => {
    // 验证必填字段
    if (!inventionName || !technicalField || !techBackground) {
      toast.error("缺少必要信息：发明名称、技术领域、技术背景");
      return;
    }

    setIsExporting(true);

    try {
      const techSolutionText = getTechSolutionText();

      const response = await fetch("/api/disclosure/template-export", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          inventionName,
          contactPerson,
          applicationType,
          technicalField,
          techBackground,
          technicalSolution: techSolutionText,
          beneficialEffects,
          protectionPoints,
        }),
      });

      if (!response.ok) {
        throw new Error("导出失败");
      }

      // 创建Blob并下载
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `专利交底书-${inventionName}.docx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);

      toast.success("文档导出成功！");
    } catch (error) {
      console.error("文档导出错误:", error);
      toast.error("文档导出失败，请稍后重试");
    } finally {
      setIsExporting(false);
    }
  };

  return {
    // State
    step,
    setStep,
    inventionName,
    setInventionName,
    contactPerson,
    setContactPerson,
    applicationType,
    setApplicationType,
    technicalField,
    setTechnicalField,
    techBackground,
    setTechBackground,
    isGeneratingBackground,
    existingProblems,
    setExistingProblems,
    contentBlocks,
    setContentBlocks,
    isRewriting,
    optimizingBlockId,
    keywords,
    setKeywords,
    fileInputRef,
    aiWarnings,
    problemDetectionResult,
    beneficialEffects,
    setBeneficialEffects,
    protectionPoints,
    setProtectionPoints,
    isGeneratingBeneficialEffects,
    isGeneratingProtectionPoints,
    isExporting,

    // Actions
    generateTechBackground,
    addContentBlock,
    updateContentBlock,
    deleteContentBlock,
    handleImageUpload,
    handleRedetectImage,
    handleOptimizeBlock,
    handleAIRewrite,
    extractKeywords,
    detectProblems,
    addKeyword,
    updateKeyword,
    deleteKeyword,
    generateBeneficialEffects,
    generateProtectionPoints,
    handleExportDocx,
  };
}
