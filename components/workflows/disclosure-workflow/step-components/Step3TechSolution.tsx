"use client";

import React from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  Plus,
  X,
  ImageIcon,
  Sparkles,
  BookOpen,
  RefreshCw,
  AlertTriangle,
} from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { useDisclosureContext } from "../context";
import ReactMarkdown from "react-markdown";

export function Step3TechSolution() {
  const {
    contentBlocks,
    isRewriting,
    optimizingBlockId,
    keywords,
    aiWarnings,
    problemDetectionResult,
    addContentBlock,
    updateContentBlock,
    deleteContentBlock,
    handleImageUpload,
    handleOptimizeBlock,
    handleRedetectImage,
    handleAIRewrite,
    extractKeywords,
    addKeyword,
    updateKeyword,
    deleteKeyword,
  } = useDisclosureContext();

  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-border bg-card p-6">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-xl font-semibold text-foreground">
            本发明的技术方案
          </h2>
        </div>

        <p className="mb-4 text-sm text-muted-foreground">
          请详细描述您的技术方案，可以添加文字说明和配图。AI
          只能优化语言和格式并识别专有词汇，不会生成、补全或改变核心技术方案。内容空泛时，请先补充具体实现。
        </p>

        <div className="space-y-4">
          {contentBlocks.map((block, index) => (
            <div
              key={block.id}
              className="group relative rounded-lg border border-border bg-background p-4"
            >
              <div className="mb-2 flex items-center justify-between">
                <span className="text-xs font-medium text-muted-foreground">
                  {block.type === "text"
                    ? `文本块 ${index + 1}`
                    : `图片 ${index + 1}`}
                </span>
                {contentBlocks.length > 1 && (
                  <button
                    onClick={() => deleteContentBlock(block.id)}
                    className="text-muted-foreground hover:text-destructive transition-colors"
                  >
                    <X className="h-4 w-4" />
                  </button>
                )}
              </div>

              {block.type === "text" ? (
                <div className="relative">
                  <Textarea
                    value={block.content}
                    onChange={(e) =>
                      updateContentBlock(block.id, e.target.value)
                    }
                    placeholder="请输入技术方案的详细描述..."
                    rows={6}
                    className="w-full resize-none pb-14"
                  />
                  <div className="absolute bottom-4 right-2">
                    <Button
                      size="sm"
                      variant="secondary"
                      className="h-7 gap-1 text-xs"
                      onClick={() => handleOptimizeBlock(block.id)}
                      disabled={optimizingBlockId === block.id}
                    >
                      <Sparkles
                        className={cn(
                          "h-3 w-3",
                          optimizingBlockId === block.id && "animate-pulse",
                        )}
                      />
                      {optimizingBlockId === block.id
                        ? "优化中..."
                        : "优化语言和格式"}
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="space-y-4">
                  {block.isDetecting ? (
                    <div className="flex flex-col items-center justify-center py-8">
                      <div className="mb-2 h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent"></div>
                      <p className="text-sm text-muted-foreground">
                        正在检测图片...
                      </p>
                    </div>
                  ) : block.imageUrl ? (
                    <div className="space-y-3">
                      <img
                        src={block.imageUrl || "/placeholder.svg"}
                        alt={block.content}
                        className="max-h-64 w-full rounded-lg object-contain"
                      />

                      {/* 图片检测结果 */}
                      {block.detectionResult && (
                        <div
                          className={cn(
                            "rounded-lg border p-3",
                            block.detectionResult.pass
                              ? "border-green-500/50 bg-green-500/10"
                              : "border-red-500/50 bg-red-500/10",
                          )}
                        >
                          <div className="flex items-center justify-between mb-1">
                            <div className="flex items-center gap-2">
                              {block.detectionResult.pass ? (
                                <>
                                  <div className="h-3 w-3 rounded-full bg-green-500"></div>
                                  <span className="text-sm font-medium text-green-700 dark:text-green-400">
                                    图片检测通过
                                  </span>
                                </>
                              ) : (
                                <>
                                  <div className="h-3 w-3 rounded-full bg-red-500"></div>
                                  <span className="text-sm font-medium text-red-700 dark:text-red-400">
                                    图片检测未通过
                                  </span>
                                </>
                              )}
                            </div>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-6 px-2 text-xs"
                              onClick={() => handleRedetectImage(block.id)}
                            >
                              <RefreshCw className="h-3 w-3 mr-1" />
                              重新检测
                            </Button>
                          </div>
                          <p className="text-xs text-muted-foreground mt-1">
                            {block.detectionResult.reason}
                          </p>
                          <div className="mt-2 flex gap-4 text-xs">
                            <span
                              className={cn(
                                block.detectionResult.isWhiteBackground
                                  ? "text-green-600"
                                  : "text-red-600",
                              )}
                            >
                              背景:{" "}
                              {block.detectionResult.isWhiteBackground
                                ? "白色"
                                : "非白色"}
                            </span>
                            <span
                              className={cn(
                                block.detectionResult.isBlackLines
                                  ? "text-green-600"
                                  : "text-red-600",
                              )}
                            >
                              线条:{" "}
                              {block.detectionResult.isBlackLines
                                ? "黑色"
                                : "非黑色"}
                            </span>
                          </div>
                        </div>
                      )}

                      {/* 图片描述输入框 */}
                      <Input
                        type="text"
                        value={block.content}
                        onChange={(e) =>
                          updateContentBlock(block.id, e.target.value)
                        }
                        placeholder="请输入图片描述..."
                      />
                    </div>
                  ) : (
                    <label className="flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed border-border py-8 transition-colors hover:border-primary">
                      <ImageIcon className="mb-2 h-8 w-8 text-muted-foreground" />
                      <span className="text-sm text-muted-foreground">
                        点击上传图片（将自动检测是否符合专利要求）
                      </span>
                      <input
                        type="file"
                        accept="image/*"
                        onChange={(e) => handleImageUpload(block.id, e)}
                        className="hidden"
                      />
                    </label>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>

        <div className="mt-4 flex items-center justify-between">
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={() => addContentBlock("text")}
              className="gap-2 bg-transparent"
            >
              <Plus className="h-4 w-4" />
              添加文本
            </Button>
            <Button
              variant="outline"
              onClick={() => addContentBlock("image")}
              className="gap-2 bg-transparent"
            >
              <ImageIcon className="h-4 w-4" />
              添加图片
            </Button>
          </div>
          <div className="flex gap-2">
            <Button
              onClick={extractKeywords}
              disabled={isRewriting}
              className="gap-2"
            >
              <BookOpen
                className={cn("h-4 w-4", isRewriting && "animate-pulse")}
              />
              提取关键词
            </Button>
            <Button
              onClick={handleAIRewrite}
              disabled={isRewriting}
              className="gap-2"
            >
              <Sparkles
                className={cn("h-4 w-4", isRewriting && "animate-pulse")}
              />
              {isRewriting ? "AI 处理中..." : "优化全部语言和格式"}
            </Button>
          </div>
        </div>
      </div>

      {aiWarnings.length > 0 && (
        <div className="rounded-lg border border-amber-500/50 bg-amber-500/10 p-4">
          <div className="mb-2 flex items-center gap-2">
            <span className="h-5 w-5 rounded-full bg-amber-500 flex items-center justify-center">
              <span className="text-white text-xs font-bold">!</span>
            </span>
            <h3 className="font-medium text-amber-700 dark:text-amber-400">
              AI 检测到以下问题
            </h3>
          </div>
          <ul className="space-y-1">
            {aiWarnings.map((warning, index) => (
              <li
                key={index}
                className="flex items-start gap-2 text-sm text-amber-700 dark:text-amber-400"
              >
                <span className="mt-1 h-1.5 w-1.5 rounded-full bg-amber-600 flex-shrink-0" />
                {warning.message}
              </li>
            ))}
          </ul>
        </div>
      )}

      {problemDetectionResult.content || problemDetectionResult.isLoading ? (
        <div className="rounded-lg border border-red-500/50 bg-red-500/10 p-6">
          <div className="mb-4 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-red-600" />
              <h3 className="font-semibold text-red-700 dark:text-red-400">
                技术方案问题检测
              </h3>
            </div>
            {problemDetectionResult.isLoading && (
              <div className="flex items-center gap-2 text-sm text-red-600">
                <div className="h-4 w-4 animate-spin rounded-full border-2 border-red-600 border-t-transparent"></div>
                <span>检测中...</span>
              </div>
            )}
          </div>
          {problemDetectionResult.content ? (
            <div className="prose prose-sm max-w-none dark:prose-invert leading-relaxed">
              <ReactMarkdown>{problemDetectionResult.content}</ReactMarkdown>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
              <div className="h-8 w-8 animate-spin rounded-full border-2 border-red-600 border-t-transparent mb-2"></div>
              <p className="text-sm">正在检测技术方案中存在的问题...</p>
            </div>
          )}
        </div>
      ) : null}

      <div className="rounded-lg border border-border bg-card p-6">
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <BookOpen className="h-5 w-5 text-primary" />
            <h3 className="font-semibold text-foreground">关键词表</h3>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={addKeyword}
            className="gap-2 text-primary hover:text-primary/80"
          >
            <Plus className="h-4 w-4" />
            添加关键词
          </Button>
        </div>

        {keywords.length > 0 ? (
          <div className="overflow-hidden rounded-lg border border-border">
            <table className="w-full">
              <thead className="bg-accent/50">
                <tr>
                  <th className="border-b border-border px-4 py-2 text-left text-sm font-semibold text-foreground w-1/3">
                    术语
                  </th>
                  <th className="border-b border-border px-4 py-2 text-left text-sm font-semibold text-foreground">
                    释义
                  </th>
                  <th className="border-b border-border px-4 py-2 w-12"></th>
                </tr>
              </thead>
              <tbody>
                {keywords.map((kw, index) => (
                  <tr
                    key={index}
                    className="border-b border-border last:border-0"
                  >
                    <td className="p-2">
                      <Input
                        type="text"
                        value={kw.term}
                        onChange={(e) =>
                          updateKeyword(index, "term", e.target.value)
                        }
                        placeholder="输入术语"
                        className="border-transparent bg-transparent hover:border-border focus:bg-background"
                      />
                    </td>
                    <td className="p-2">
                      <Input
                        type="text"
                        value={kw.definition}
                        onChange={(e) =>
                          updateKeyword(index, "definition", e.target.value)
                        }
                        placeholder="输入释义"
                        className="border-transparent bg-transparent hover:border-border focus:bg-background"
                      />
                    </td>
                    <td className="p-2 text-center">
                      <button
                        onClick={() => deleteKeyword(index)}
                        className="text-muted-foreground hover:text-destructive transition-colors"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border py-8 text-center">
            <p className="text-sm text-muted-foreground">
              暂无关键词，点击"提取关键词"按钮或等待 AI 自动生成
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
