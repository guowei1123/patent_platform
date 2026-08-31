"use client";

import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  FileSearch,
  FileText,
  Copy,
  Eraser,
  Sparkles,
  Upload,
} from "lucide-react";
import { toast } from "sonner";

interface ParsedDisclosure {
  inventionName: string;
  technicalField: string;
  backgroundTechnology: string;
  technicalProblem: string;
  technicalSolution: string;
  beneficialEffects: string;
  keyTechnicalFeatures: string[];
  searchKeywords: string[];
  ipcSuggestions: Array<{ code: string; name: string }>;
  sourceTextLength: number;
}

const detailFields: Array<
  keyof Pick<
    ParsedDisclosure,
    | "backgroundTechnology"
    | "technicalProblem"
    | "technicalSolution"
    | "beneficialEffects"
  >
> = [
  "backgroundTechnology",
  "technicalProblem",
  "technicalSolution",
  "beneficialEffects",
];

const fieldLabels: Record<(typeof detailFields)[number], string> = {
  backgroundTechnology: "背景技术",
  technicalProblem: "待解决技术问题",
  technicalSolution: "技术方案",
  beneficialEffects: "有益效果",
};

export default function DisclosureParseTestPage() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<ParsedDisclosure | null>(null);
  const [loading, setLoading] = useState(false);

  const selectFile = (candidate?: File) => {
    if (!candidate) return;
    if (!candidate.name.toLowerCase().endsWith(".docx")) {
      toast.error("文件格式不支持", {
        description: "请上传 DOCX 格式的专利交底书",
      });
      return;
    }
    if (candidate.size > 10 * 1024 * 1024) {
      toast.error("文件过大", { description: "文件不得超过 10MB" });
      return;
    }
    setFile(candidate);
    setResult(null);
  };

  const handleParse = async () => {
    if (!file) {
      toast.error("请先选择文件");
      return;
    }

    setLoading(true);
    setResult(null);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const response = await fetch("/api/report/disclosure-parse", {
        method: "POST",
        body: formData,
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "交底书解析失败");

      setResult(data as ParsedDisclosure);
      toast.success("解析完成", {
        description: "已生成检索所需的技术事实与检索基础",
      });
    } catch (error) {
      toast.error("解析失败", {
        description:
          error instanceof Error ? error.message : "网络或服务器错误",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleReset = () => {
    setFile(null);
    setResult(null);
    if (inputRef.current) inputRef.current.value = "";
  };

  const handleCopy = async () => {
    if (!result) return;
    await navigator.clipboard.writeText(JSON.stringify(result, null, 2));
    toast.success("已复制", { description: "完整解析结果已复制为 JSON" });
  };

  return (
    <div className="mx-auto flex h-[calc(100vh-6rem)] w-full max-w-6xl flex-col gap-4 p-4 pt-0">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">交底书解析</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            调用正式解析接口，验证交底书到客观技术事实和检索基础数据的转换。
          </p>
        </div>
        <Button variant="outline" onClick={handleReset} disabled={loading}>
          <Eraser className="mr-2 h-4 w-4" />
          清空重置
        </Button>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-6 lg:grid-cols-2">
        <Card className="flex min-h-0 flex-col">
          <CardHeader>
            <CardTitle>上传测试文件</CardTitle>
            <CardDescription>
              支持可编辑的 DOCX 专利交底书，最大 10MB。
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-1 flex-col gap-4">
            <input
              ref={inputRef}
              type="file"
              accept=".docx"
              className="hidden"
              onChange={(event) => selectFile(event.target.files?.[0])}
            />
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              className="flex min-h-44 flex-1 flex-col items-center justify-center rounded-lg border-2 border-dashed border-border bg-muted/30 p-6 text-center transition-colors hover:border-primary hover:bg-primary/5"
            >
              <Upload className="mb-3 h-8 w-8 text-muted-foreground" />
              <span className="font-medium">
                {file ? file.name : "点击选择专利交底书"}
              </span>
              <span className="mt-1 text-xs text-muted-foreground">
                {file ? `${(file.size / 1024).toFixed(1)} KB` : "仅支持 DOCX"}
              </span>
            </button>
            <Button
              className="w-full"
              onClick={handleParse}
              disabled={!file || loading}
            >
              {loading ? (
                <Sparkles className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <FileSearch className="mr-2 h-4 w-4" />
              )}
              {loading ? "正在解析..." : "开始解析"}
            </Button>
          </CardContent>
        </Card>

        <Card className="flex min-h-0 flex-col bg-muted/30">
          <CardHeader className="flex flex-row items-center justify-between space-y-0">
            <div>
              <CardTitle>解析结果</CardTitle>
              <CardDescription>请人工复核后再用于专利判断。</CardDescription>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleCopy}
              disabled={!result || loading}
            >
              <Copy className="mr-2 h-4 w-4" />
              复制 JSON
            </Button>
          </CardHeader>
          <CardContent className="min-h-0 flex-1 overflow-y-auto">
            {result ? (
              <div className="space-y-5 rounded-md border bg-background p-4 text-sm">
                <div className="grid gap-3 sm:grid-cols-2">
                  <p>
                    <span className="font-medium">发明名称：</span>
                    {result.inventionName || "未识别"}
                  </p>
                  <p>
                    <span className="font-medium">技术领域：</span>
                    {result.technicalField || "未识别"}
                  </p>
                </div>
                {detailFields.map((field) => (
                  <section key={field}>
                    <h3 className="font-medium">{fieldLabels[field]}</h3>
                    <p className="mt-1 whitespace-pre-wrap text-muted-foreground">
                      {result[field] || "未识别"}
                    </p>
                  </section>
                ))}
                <ResultList
                  title="关键技术特征"
                  items={result.keyTechnicalFeatures}
                />
                <section>
                  <h3 className="font-medium">检索关键词</h3>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {result.searchKeywords.map((word) => (
                      <span
                        key={word}
                        className="rounded bg-secondary px-2 py-1 text-secondary-foreground"
                      >
                        {word}
                      </span>
                    ))}
                  </div>
                </section>
                <section>
                  <h3 className="font-medium">IPC/CPC 建议</h3>
                  <div className="mt-2 space-y-1 text-muted-foreground">
                    {result.ipcSuggestions.length ? (
                      result.ipcSuggestions.map((item) => (
                        <p key={`${item.code}-${item.name}`}>
                          <span className="font-mono font-medium text-foreground">
                            {item.code}
                          </span>
                          ：{item.name}
                        </p>
                      ))
                    ) : (
                      <p>未识别</p>
                    )}
                  </div>
                </section>
                <p className="border-t pt-3 text-xs text-muted-foreground">
                  已提取原文约 {result.sourceTextLength} 字。
                </p>
              </div>
            ) : (
              <div className="flex h-full flex-col items-center justify-center gap-4 text-muted-foreground opacity-60">
                <FileText className="h-12 w-12" />
                <p>上传 DOCX 文件并开始解析后查看结果。</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function ResultList({ title, items }: { title: string; items: string[] }) {
  return (
    <section>
      <h3 className="font-medium">{title}</h3>
      {items.length ? (
        <ul className="mt-1 list-disc space-y-1 pl-5 text-muted-foreground">
          {items.map((item, index) => (
            <li key={index}>{item}</li>
          ))}
        </ul>
      ) : (
        <p className="mt-1 text-muted-foreground">未识别</p>
      )}
    </section>
  );
}
