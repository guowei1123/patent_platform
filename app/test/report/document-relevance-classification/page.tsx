"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Eraser, FileSearch, Sparkles } from "lucide-react";
import { toast } from "sonner";

interface ClassificationResult {
  category: "X" | "Y" | "A";
  confidence: "高" | "中" | "低";
  conclusion: string;
  featureMappings: Array<{
    targetFeature: string;
    referenceDisclosure: string;
    assessment: "已披露" | "未披露" | "部分披露";
  }>;
  reviewNote: string;
}

const initialTarget = `目标技术方案：一种动力电池热管理控制方法。采集多个电池单体的温度数据，根据相邻单体温差动态调节冷却介质流量，并在温差超过阈值时对温度异常单体执行局部冷却，以提高电池包温度一致性。`;
const initialReference = `对比文献摘要：公开一种电动汽车电池冷却系统，采集电池包总体温度，并根据总体温度控制冷却泵的启停和转速，实现电池包冷却。文献未描述相邻单体温差，也未描述针对异常单体的局部冷却。`;

export default function DocumentRelevanceClassificationTestPage() {
  const [targetText, setTargetText] = useState(initialTarget);
  const [referenceText, setReferenceText] = useState(initialReference);
  const [result, setResult] = useState<ClassificationResult | null>(null);
  const [loading, setLoading] = useState(false);

  const handleClassify = async () => {
    if (targetText.trim().length < 20 || referenceText.trim().length < 20) {
      toast.error("输入内容不足", {
        description: "请分别提供目标技术方案和对比文献片段",
      });
      return;
    }

    setLoading(true);
    setResult(null);
    try {
      const response = await fetch(
        "/api/report/document-relevance-classification",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ targetText, referenceText }),
        },
      );
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "对比文献分类失败");
      setResult(data as ClassificationResult);
      toast.success("分类完成", {
        description: "请结合原始权利要求和公开日进行人工复核",
      });
    } catch (error) {
      toast.error("分类失败", {
        description:
          error instanceof Error ? error.message : "网络或服务器错误",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleReset = () => {
    setTargetText(initialTarget);
    setReferenceText(initialReference);
    setResult(null);
  };

  return (
    <div className="mx-auto flex h-[calc(100vh-6rem)] w-full max-w-7xl flex-col gap-4 p-4 pt-0">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">
            对比文献 X/Y/A 分类
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            基于目标技术方案与单篇对比文献进行初步相关性标注和技术特征比对。
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
            <CardTitle>比对输入</CardTitle>
            <CardDescription>
              建议使用权利要求或经交底书解析后的关键技术特征，并提供对比文献的权利要求、摘要或正文。
            </CardDescription>
          </CardHeader>
          <CardContent className="flex min-h-0 flex-1 flex-col gap-4">
            <label className="text-sm font-medium">目标技术方案</label>
            <Textarea
              value={targetText}
              onChange={(event) => setTargetText(event.target.value)}
              className="min-h-36 resize-none"
              disabled={loading}
            />
            <label className="text-sm font-medium">对比文献</label>
            <Textarea
              value={referenceText}
              onChange={(event) => setReferenceText(event.target.value)}
              className="min-h-36 flex-1 resize-none"
              disabled={loading}
            />
            <Button
              className="w-full"
              onClick={handleClassify}
              disabled={loading}
            >
              {loading ? (
                <Sparkles className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <FileSearch className="mr-2 h-4 w-4" />
              )}
              {loading ? "正在比对..." : "开始 X/Y/A 分类"}
            </Button>
          </CardContent>
        </Card>

        <Card className="flex min-h-0 flex-col bg-muted/30">
          <CardHeader>
            <CardTitle>分类与特征比对结果</CardTitle>
            <CardDescription>
              X/Y/A 为检索辅助标注，不构成专利性法律结论。
            </CardDescription>
          </CardHeader>
          <CardContent className="min-h-0 flex-1 overflow-y-auto">
            {result ? (
              <div className="space-y-5 rounded-md border bg-background p-5">
                <div className="flex flex-wrap items-center gap-3">
                  <span className="font-medium">类别</span>
                  <Badge>{result.category}</Badge>
                  <span className="font-medium">置信度</span>
                  <Badge variant="secondary">{result.confidence}</Badge>
                </div>
                <div>
                  <h3 className="font-medium">初步结论</h3>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {result.conclusion || "未提供"}
                  </p>
                </div>
                <div>
                  <h3 className="font-medium">技术特征比对</h3>
                  {result.featureMappings.length ? (
                    <div className="mt-2 overflow-x-auto">
                      <table className="w-full min-w-[560px] text-left text-sm">
                        <thead className="border-b">
                          <tr>
                            <th className="p-2">目标特征</th>
                            <th className="p-2">对比文献披露</th>
                            <th className="p-2">判断</th>
                          </tr>
                        </thead>
                        <tbody>
                          {result.featureMappings.map((item, index) => (
                            <tr key={index} className="border-b align-top">
                              <td className="p-2">{item.targetFeature}</td>
                              <td className="p-2 text-muted-foreground">
                                {item.referenceDisclosure}
                              </td>
                              <td className="p-2">
                                <Badge variant="outline">
                                  {item.assessment}
                                </Badge>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <p className="mt-1 text-sm text-muted-foreground">
                      未提取到可比对特征
                    </p>
                  )}
                </div>
                <div>
                  <h3 className="font-medium">人工复核提示</h3>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {result.reviewNote ||
                      "请核对权利要求、对比文献公开日与原文披露位置。"}
                  </p>
                </div>
              </div>
            ) : (
              <div className="flex h-full flex-col items-center justify-center gap-4 text-muted-foreground opacity-60">
                <FileSearch className="h-12 w-12" />
                <p>填写两侧文献内容并开始分类后查看结果。</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
