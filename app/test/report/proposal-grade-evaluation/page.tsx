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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Eraser, Sparkles } from "lucide-react";
import { toast } from "sonner";

type Enforceability = "高" | "低" | "无";

interface RuleResult {
  usageProspect: string;
  authorizationProspect: string;
  proposalGrade: string;
  applicationType: string;
  inventionPointAssessments: Array<{
    name: string;
    prospect: string;
    reason: string;
  }>;
  ruleTrace: string[];
  manualReviewRequired: boolean;
}

const initialInput = {
  isUsedOnProduct: false,
  isUsedOnMarketProduct: false,
  enforceability: "高" as Enforceability,
  isStandardEssentialPatent: false,
  relatedADocumentCount: 3,
  pointName: "基于单体温差的局部冷却控制",
  hasXDocument: false,
  yDocumentCount: 0,
  yCombinationObvious: false,
  isCommonKnowledgeOrObvious: false,
};

export default function ProposalGradeEvaluationTestPage() {
  const [form, setForm] = useState(initialInput);
  const [result, setResult] = useState<RuleResult | null>(null);
  const [loading, setLoading] = useState(false);

  const update = <K extends keyof typeof initialInput>(
    key: K,
    value: (typeof initialInput)[K],
  ) => setForm((current) => ({ ...current, [key]: value }));

  const handleEvaluate = async () => {
    if (!form.pointName.trim()) {
      toast.error("请填写发明点名称");
      return;
    }
    setLoading(true);
    setResult(null);
    try {
      const response = await fetch("/api/report/proposal-grade-evaluation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          isUsedOnProduct: form.isUsedOnProduct,
          isUsedOnMarketProduct: form.isUsedOnMarketProduct,
          enforceability: form.enforceability,
          isStandardEssentialPatent: form.isStandardEssentialPatent,
          relatedADocumentCount: Number(form.relatedADocumentCount),
          inventionPoints: [
            {
              name: form.pointName,
              hasXDocument: form.hasXDocument,
              yDocumentCount: Number(form.yDocumentCount),
              yCombinationObvious: form.yCombinationObvious,
              isCommonKnowledgeOrObvious: form.isCommonKnowledgeOrObvious,
            },
          ],
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "规则判定失败");
      setResult(data as RuleResult);
      toast.success("规则判定完成");
    } catch (error) {
      toast.error("规则判定失败", {
        description:
          error instanceof Error ? error.message : "网络或服务器错误",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleReset = () => {
    setForm(initialInput);
    setResult(null);
  };

  return (
    <div className="mx-auto flex h-[calc(100vh-6rem)] w-full max-w-6xl flex-col gap-4 p-4 pt-0">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">
            提案分级规则判定
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            按《提案分级评价细则 V3》判定用途前景、授权前景及提案等级。
          </p>
        </div>
        <Button variant="outline" onClick={handleReset} disabled={loading}>
          <Eraser className="mr-2 h-4 w-4" />
          清空重置
        </Button>
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-6 lg:grid-cols-2">
        <Card className="min-h-0 overflow-y-auto">
          <CardHeader>
            <CardTitle>规则输入</CardTitle>
            <CardDescription>
              检索事实应来自 X/Y/A 对比文献分类与人工复核。
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="space-y-2">
              <Label>发明点名称</Label>
              <Input
                value={form.pointName}
                onChange={(event) => update("pointName", event.target.value)}
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>维权性</Label>
                <Select
                  value={form.enforceability}
                  onValueChange={(value) =>
                    update("enforceability", value as Enforceability)
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
              <div className="space-y-2">
                <Label>A 类文件数量</Label>
                <Input
                  type="number"
                  min="0"
                  value={form.relatedADocumentCount}
                  onChange={(event) =>
                    update("relatedADocumentCount", Number(event.target.value))
                  }
                />
              </div>
            </div>
            <div className="grid gap-3">
              <Check
                label="已使用/计划使用于产品"
                checked={form.isUsedOnProduct}
                onChange={(value) => update("isUsedOnProduct", value)}
              />
              <Check
                label="已使用于上市车型"
                checked={form.isUsedOnMarketProduct}
                onChange={(value) => update("isUsedOnMarketProduct", value)}
              />
              <Check
                label="属于 SEP（标准必要专利）"
                checked={form.isStandardEssentialPatent}
                onChange={(value) => update("isStandardEssentialPatent", value)}
              />
              <Check
                label="存在 X 类文件"
                checked={form.hasXDocument}
                onChange={(value) => update("hasXDocument", value)}
              />
              <Check
                label="属于公知常识或容易想到"
                checked={form.isCommonKnowledgeOrObvious}
                onChange={(value) =>
                  update("isCommonKnowledgeOrObvious", value)
                }
              />
              <Check
                label="Y 类文件组合容易想到"
                checked={form.yCombinationObvious}
                onChange={(value) => update("yCombinationObvious", value)}
              />
            </div>
            <div className="space-y-2">
              <Label>Y 类文件数量</Label>
              <Input
                type="number"
                min="0"
                value={form.yDocumentCount}
                onChange={(event) =>
                  update("yDocumentCount", Number(event.target.value))
                }
              />
            </div>
            <Button
              className="w-full"
              onClick={handleEvaluate}
              disabled={loading}
            >
              {loading ? (
                <Sparkles className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Sparkles className="mr-2 h-4 w-4" />
              )}
              {loading ? "正在判定..." : "执行规则判定"}
            </Button>
          </CardContent>
        </Card>
        <Card className="min-h-0 overflow-y-auto bg-muted/30">
          <CardHeader>
            <CardTitle>判定结果</CardTitle>
            <CardDescription>
              规则未覆盖的组合会标记为需人工确认。
            </CardDescription>
          </CardHeader>
          <CardContent>
            {result ? (
              <div className="space-y-5 rounded-md border bg-background p-5">
                <div className="flex flex-wrap gap-3">
                  <Badge>用途前景：{result.usageProspect}</Badge>
                  <Badge>授权前景：{result.authorizationProspect}</Badge>
                  <Badge>提案等级：{result.proposalGrade}</Badge>
                  <Badge variant="secondary">
                    申请类型：{result.applicationType}
                  </Badge>
                </div>
                <section>
                  <h3 className="font-medium">发明点评估</h3>
                  {result.inventionPointAssessments.map((point) => (
                    <p
                      key={point.name}
                      className="mt-2 text-sm text-muted-foreground"
                    >
                      <span className="font-medium text-foreground">
                        {point.name}（{point.prospect}）：
                      </span>
                      {point.reason}
                    </p>
                  ))}
                </section>
                <section>
                  <h3 className="font-medium">规则命中说明</h3>
                  <ul className="mt-2 list-disc space-y-2 pl-5 text-sm text-muted-foreground">
                    {result.ruleTrace.map((rule, index) => (
                      <li key={index}>{rule}</li>
                    ))}
                  </ul>
                </section>
                {result.manualReviewRequired && (
                  <p className="rounded bg-amber-50 p-3 text-sm text-amber-800">
                    当前组合不在评价细则的明确映射范围内，请人工确认。
                  </p>
                )}
              </div>
            ) : (
              <div className="flex h-72 items-center justify-center text-sm text-muted-foreground">
                填写规则输入后查看用途前景、授权前景和提案等级。
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function Check({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className="flex items-center gap-2 text-sm">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
      {label}
    </label>
  );
}
