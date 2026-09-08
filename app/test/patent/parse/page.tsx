"use client";

import { useState } from "react";
import { Copy, Eraser, FileSearch, FileText, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

interface PatentParseResult {
  inventionName: string;
  applicationType: "发明" | "实用新型" | "外观设计" | "无法判断";
  technicalField: string;
  technicalProblem: string;
  technicalSolution: string;
  technicalEffect: string;
}

interface PatentContent {
  bibliographicData: string;
  title: string;
  abstract: string;
  description: string;
  claims: string;
  drawings: string;
}

interface PatentParseResponse {
  success: true;
  data: PatentParseResult;
  meta: {
    inputTextLength: number;
    analyzedTextLength: number;
    truncated: boolean;
    includedSections: Array<keyof PatentContent>;
  };
}

const initialContent: PatentContent = {
  bibliographicData: "申请类型：发明专利",
  title: "一种动力电池热管理控制方法及系统",
  abstract:
    "本发明公开一种动力电池热管理控制方法及系统，采集电池包内多个电池单体的温度，根据相邻单体温差动态调节冷却介质流量，并在温差超过阈值时对温度异常单体执行局部冷却，以改善电池包温度一致性。",
  description:
    "现有动力电池冷却系统通常根据电池包总体温度统一控制冷却泵，难以及时处理局部单体温度异常，容易造成电池包内部温差增大。该系统包括温度采集模块、控制器、流量调节模块和多个局部冷却支路。控制器计算相邻单体温差，并根据温差控制对应支路的调节阀和冷却泵。",
  claims:
    "1. 一种动力电池热管理控制方法，其特征在于：采集多个电池单体的温度数据；计算相邻电池单体之间的温差；根据所述温差动态调节冷却介质流量；当所述温差超过预设阈值时，开启与温度异常单体对应的局部冷却支路。",
  drawings:
    "图1为系统结构示意图；图2为控制方法流程图。图中，温度传感器分别连接控制器，控制器连接冷却泵及各局部冷却支路的调节阀。",
};

const emptyContent: PatentContent = {
  bibliographicData: "",
  title: "",
  abstract: "",
  description: "",
  claims: "",
  drawings: "",
};

const resultFields: Array<{
  key: keyof PatentParseResult;
  label: string;
}> = [
  { key: "inventionName", label: "发明名称" },
  { key: "applicationType", label: "申请类型" },
  { key: "technicalField", label: "技术领域" },
  { key: "technicalProblem", label: "技术问题（技术背景）" },
  { key: "technicalSolution", label: "技术手段（技术方案）" },
  { key: "technicalEffect", label: "技术效果" },
];

const textAreas: Array<{
  key: "abstract" | "description" | "claims" | "drawings";
  label: string;
  placeholder: string;
  minHeight: string;
}> = [
  {
    key: "abstract",
    label: "专利摘要",
    placeholder: "粘贴专利摘要",
    minHeight: "min-h-28",
  },
  {
    key: "description",
    label: "说明书",
    placeholder:
      "粘贴说明书正文（含技术领域、背景技术、发明内容、具体实施方式等）",
    minHeight: "min-h-40",
  },
  {
    key: "claims",
    label: "权利要求书",
    placeholder: "粘贴权利要求书内容",
    minHeight: "min-h-36",
  },
  {
    key: "drawings",
    label: "专利附图及附图说明",
    placeholder: "粘贴附图说明、图中部件关系或上游识别出的附图文本",
    minHeight: "min-h-24",
  },
];

export default function PatentParseTestPage() {
  const [content, setContent] = useState<PatentContent>(initialContent);
  const [responseData, setResponseData] = useState<PatentParseResponse | null>(
    null,
  );
  const [loading, setLoading] = useState(false);

  const updateField = (key: keyof PatentContent, value: string) => {
    setContent((current) => ({ ...current, [key]: value }));
    setResponseData(null);
  };

  const handleParse = async () => {
    const totalLength = [
      content.abstract,
      content.description,
      content.claims,
      content.drawings,
    ]
      .join("")
      .trim().length;
    if (totalLength < 80) {
      toast.error("专利内容过少", {
        description: "请提供合计不少于 80 字的专利文献内容",
      });
      return;
    }

    setLoading(true);
    setResponseData(null);
    try {
      const response = await fetch("/api/patent/parse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(content),
      });
      const data = (await response.json()) as
        | PatentParseResponse
        | { error?: string };
      if (!response.ok || !("success" in data)) {
        throw new Error(
          "error" in data && data.error ? data.error : "专利解析失败",
        );
      }

      setResponseData(data);
      toast.success("解析完成", {
        description: "已提取专利文献的六项核心信息",
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
    setContent(emptyContent);
    setResponseData(null);
  };

  const handleCopy = async () => {
    if (!responseData) return;
    await navigator.clipboard.writeText(
      JSON.stringify(responseData.data, null, 2),
    );
    toast.success("已复制", { description: "六项解析结果已复制为 JSON" });
  };

  const result = responseData?.data;

  return (
    <div className="mx-auto flex h-[calc(100vh-6rem)] w-full max-w-7xl flex-col gap-4 p-4 pt-0">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">专利文件解析</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            输入专利摘要、说明书、权利要求及附图说明，提取结构化技术信息。
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
            <CardTitle>专利文献内容</CardTitle>
            <CardDescription>
              JSON 接口：POST
              /api/patent/parse；各字段可单独为空，但总内容不得少于 80 字。
            </CardDescription>
          </CardHeader>
          <CardContent className="min-h-0 flex-1 space-y-4 overflow-y-auto">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="patent-title">专利名称（可选）</Label>
                <Input
                  id="patent-title"
                  value={content.title}
                  onChange={(event) => updateField("title", event.target.value)}
                  placeholder="输入专利名称"
                  disabled={loading}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="bibliographic-data">著录信息（可选）</Label>
                <Input
                  id="bibliographic-data"
                  value={content.bibliographicData}
                  onChange={(event) =>
                    updateField("bibliographicData", event.target.value)
                  }
                  placeholder="例如：申请类型、文献种类代码"
                  disabled={loading}
                />
              </div>
            </div>

            {textAreas.map(({ key, label, placeholder, minHeight }) => (
              <div key={key} className="space-y-2">
                <Label htmlFor={`patent-${key}`}>{label}</Label>
                <Textarea
                  id={`patent-${key}`}
                  value={content[key]}
                  onChange={(event) => updateField(key, event.target.value)}
                  placeholder={placeholder}
                  className={`${minHeight} resize-y`}
                  disabled={loading}
                />
              </div>
            ))}

            <Button className="w-full" onClick={handleParse} disabled={loading}>
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
              <CardDescription>结果仅基于提交的专利文献字段。</CardDescription>
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
              <div className="space-y-5 rounded-md border bg-background p-5 text-sm">
                {resultFields.map(({ key, label }) => (
                  <section key={key}>
                    <h3 className="font-medium">{label}</h3>
                    <p className="mt-1 whitespace-pre-wrap leading-6 text-muted-foreground">
                      {result[key] || "原文未披露"}
                    </p>
                  </section>
                ))}
                {responseData && (
                  <div className="border-t pt-3 text-xs text-muted-foreground">
                    <p>
                      输入约 {responseData.meta.inputTextLength} 字，本次分析约{" "}
                      {responseData.meta.analyzedTextLength} 字。
                    </p>
                    {responseData.meta.truncated && (
                      <p className="mt-1 text-amber-600">
                        个别字段较长，已按字段上限截取后分析。
                      </p>
                    )}
                  </div>
                )}
              </div>
            ) : (
              <div className="flex h-full flex-col items-center justify-center gap-4 text-muted-foreground opacity-60">
                <FileText className="h-12 w-12" />
                <p>填写专利文献字段并开始解析后查看六项结果。</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
