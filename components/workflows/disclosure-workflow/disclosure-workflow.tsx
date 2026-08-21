"use client";

import React from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ArrowLeft, CheckCircle, FileDown, RefreshCw } from "lucide-react";
import { Step1BasicInfo } from "@/components/workflows/disclosure-workflow/step-components/Step1BasicInfo";
import { Step2TechBackground } from "@/components/workflows/disclosure-workflow/step-components/Step2TechBackground";
import { Step3TechSolution } from "@/components/workflows/disclosure-workflow/step-components/Step3TechSolution";
import { Step4Benefits } from "@/components/workflows/disclosure-workflow/step-components/Step4Benefits";
import { Step5Preview } from "@/components/workflows/disclosure-workflow/step-components/Step5Preview";
import { DisclosureProvider, useDisclosureContext } from "./context";

interface DisclosureWorkflowProps {
  fileName: string;
  onBack: () => void;
}

function DisclosureWorkflowContent({ onBack }: { onBack: () => void }) {
  const {
    step,
    workflowStatus,
    isWorkflowTransitioning,
    handleNextStep,
    handlePreviousStep,
    handleExportDocx,
    isExporting,
  } = useDisclosureContext();

  return (
    <div className="flex h-full flex-col bg-background">
      {/* Header */}
      <header className="flex items-center justify-between border-b border-border bg-card px-6 py-4">
        <div className="flex items-center gap-4">
          <Button
            variant="ghost"
            size="icon"
            onClick={onBack}
            className="h-8 w-8"
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="text-lg font-semibold text-foreground">
              专利交底书
            </h1>
            <p className="text-sm text-muted-foreground">
              AI 辅助制作专利交底书 · 服务端流程
            </p>
          </div>
        </div>
        <span className="rounded-full bg-primary/10 px-3 py-1 text-xs text-primary">
          {workflowStatus === "draft"
            ? "尚未启动"
            : workflowStatus === "suspended"
              ? "等待填写"
              : workflowStatus === "success"
                ? "已完成"
                : "处理中"}
        </span>
      </header>

      {/* Progress Steps */}
      <div className="border-b border-border bg-card px-6 py-4">
        <div className="flex items-center justify-between">
          {[
            { num: 1, label: "基本信息" },
            { num: 2, label: "技术背景" },
            { num: 3, label: "技术方案" },
            { num: 4, label: "有益效果" },
            { num: 5, label: "预览导出" },
          ].map((s, index) => (
            <React.Fragment key={s.num}>
              <div className="flex items-center gap-2">
                <div
                  className={cn(
                    "flex h-8 w-8 items-center justify-center rounded-full text-sm font-medium transition-colors",
                    step >= s.num
                      ? "bg-primary text-primary-foreground"
                      : "bg-accent text-muted-foreground",
                  )}
                >
                  {step > s.num ? <CheckCircle className="h-4 w-4" /> : s.num}
                </div>
                <span
                  className={cn(
                    "text-sm font-medium",
                    step >= s.num ? "text-foreground" : "text-muted-foreground",
                  )}
                >
                  {s.label}
                </span>
              </div>
              {index < 4 && (
                <div
                  className={cn(
                    "mx-4 h-0.5 w-16 transition-colors",
                    step > s.num ? "bg-primary" : "bg-border",
                  )}
                />
              )}
            </React.Fragment>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6">
        <div className="mx-auto max-w-4xl">
          {/* Step 1: 基本信息 */}
          {step === 1 && <Step1BasicInfo />}

          {/* Step 2: 技术背景 */}
          {step === 2 && <Step2TechBackground />}

          {/* Step 3: 技术方案 */}
          {step === 3 && <Step3TechSolution />}

          {/* Step 4: 有益效果与保护点 */}
          {step === 4 && <Step4Benefits />}

          {/* Step 5: 预览导出 */}
          {step === 5 && <Step5Preview />}
        </div>
      </div>

      {/* Footer Navigation */}
      <div className="border-t border-border bg-card p-6">
        <div className="mx-auto flex max-w-4xl items-center justify-between">
          <Button
            variant="outline"
            onClick={handlePreviousStep}
            disabled={step === 1 || step > 2 || isWorkflowTransitioning}
          >
            上一步
          </Button>

          {step < 5 ? (
            <Button
              onClick={handleNextStep}
              disabled={isWorkflowTransitioning}
            >
              {isWorkflowTransitioning ? (
                <>
                  <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                  服务端处理中...
                </>
              ) : (
                "保存并进入下一步"
              )}
            </Button>
          ) : (
            <Button onClick={handleExportDocx} disabled={isExporting}>
              {isExporting ? (
                <>
                  <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                  导出中...
                </>
              ) : (
                <>
                  <FileDown className="mr-2 h-4 w-4" />
                  导出文档
                </>
              )}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

export function DisclosureWorkflow({
  fileName,
  onBack,
}: DisclosureWorkflowProps) {
  return (
    <DisclosureProvider>
      <DisclosureWorkflowContent onBack={onBack} />
    </DisclosureProvider>
  );
}
