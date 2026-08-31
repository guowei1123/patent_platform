"use client";

import React from "react";

import { useState, useRef } from "react";
import { cn } from "@/lib/utils";
import {
  Send,
  Paperclip,
  Globe,
  FileSearch,
  FileText,
  FileBarChart,
  FileScan,
  Upload,
  X,
  Search,
} from "lucide-react";
import { Button } from "@/components/ui/button";

interface Tool {
  id: string;
  name: string;
  icon: React.ReactNode;
  description: string;
  color: string;
}

const tools: Tool[] = [
  {
    id: "patent-search",
    name: "专利检索",
    icon: <Search className="h-5 w-5" />,
    description: "全库专利检索",
    color: "bg-indigo-500/10 text-indigo-600 hover:bg-indigo-500/20",
  },
  {
    id: "disclosure",
    name: "专利交底书",
    icon: <FileText className="h-5 w-5" />,
    description: "撰写技术交底书",
    color: "bg-emerald-500/10 text-emerald-600 hover:bg-emerald-500/20",
  },
  {
    id: "search-formula",
    name: "专利检索式",
    icon: <FileSearch className="h-5 w-5" />,
    description: "生成专业检索式",
    color: "bg-blue-500/10 text-blue-600 hover:bg-blue-500/20",
  },
  {
    id: "report",
    name: "专利检索报告",
    icon: <FileBarChart className="h-5 w-5" />,
    description: "生成检索报告",
    color: "bg-amber-500/10 text-amber-600 hover:bg-amber-500/20",
  },
  {
    id: "analysis",
    name: "专利解析",
    icon: <FileScan className="h-5 w-5" />,
    description: "深度解析专利",
    color: "bg-rose-500/10 text-rose-600 hover:bg-rose-500/20",
  },
];

interface ChatInputProps {
  onSend?: (message: string, tool?: string, files?: File[]) => void;
  disabled?: boolean;
}

export function ChatInput({ onSend, disabled = false }: ChatInputProps) {
  const [message, setMessage] = useState("");
  const [selectedTool, setSelectedTool] = useState<string | null>(null);
  const [uploadedFiles, setUploadedFiles] = useState<File[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 判断是否需要文件上传
  const needsFileUpload =
    selectedTool === "search-formula" ||
    selectedTool === "report" ||
    selectedTool === "analysis";

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (needsFileUpload) {
      setIsDragging(true);
    }
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    if (!needsFileUpload) return;

    const files = Array.from(e.dataTransfer.files);
    if (files.length === 0) return;

    // 根据工具类型过滤文件
    const validExtensions =
      selectedTool === "analysis"
        ? [".doc", ".docx", ".pdf"]
        : selectedTool === "report"
          ? [".docx"]
          : [".doc", ".docx"];

    const validFiles = files.filter((file) => {
      const lowerName = file.name.toLowerCase();
      return validExtensions.some((ext) => lowerName.endsWith(ext));
    });

    if (validFiles.length > 0) {
      if (selectedTool === "analysis") {
        setUploadedFiles((prev) => [...prev, ...validFiles]);
      } else {
        setUploadedFiles([validFiles[0]]);
      }
    }
  };

  const handleSend = () => {
    if (disabled) return;

    // 专利交底书直接进入工作流
    if (selectedTool === "disclosure") {
      onSend?.("开始专利交底书流程", selectedTool);
      setSelectedTool(null);
      return;
    }

    if (needsFileUpload && uploadedFiles.length > 0) {
      const fileNames = uploadedFiles.map((f) => f.name).join("、");
      onSend?.(
        `已上传文件：${fileNames}`,
        selectedTool || undefined,
        uploadedFiles,
      );
      setUploadedFiles([]);
    } else if (!needsFileUpload && message.trim()) {
      onSend?.(message, selectedTool || undefined);
      setMessage("");
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    const validFiles = files.filter((file) => {
      const name = file.name.toLowerCase();
      return selectedTool === "report"
        ? name.endsWith(".docx")
        : selectedTool === "analysis"
          ? [".doc", ".docx", ".pdf"].some((extension) =>
              name.endsWith(extension),
            )
          : [".doc", ".docx"].some((extension) => name.endsWith(extension));
    });
    if (validFiles.length > 0) {
      if (selectedTool === "analysis") {
        setUploadedFiles((prev) => [...prev, ...validFiles]);
      } else {
        setUploadedFiles([validFiles[0]]);
      }
    }
    // 重置 input value 以允许重复上传同一文件
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const handleUploadClick = () => {
    fileInputRef.current?.click();
  };

  const handleRemoveFile = (index: number) => {
    setUploadedFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const getUploadText = () => {
    if (selectedTool === "analysis")
      return "点击或拖拽上传专利文件（支持多选）";
    if (selectedTool === "search-formula") return "点击或拖拽上传技术交底书";
    if (selectedTool === "report")
      return "点击或拖拽上传专利交底书（自动解析）";
    return "点击或拖拽上传文件";
  };

  const getAcceptTypes = () => {
    if (selectedTool === "analysis") return ".doc,.docx,.pdf";
    return selectedTool === "report" ? ".docx" : ".doc,.docx";
  };

  const getFormatText = () => {
    if (selectedTool === "analysis") return "支持 DOC、DOCX、PDF 格式";
    return selectedTool === "report"
      ? "支持 DOCX 格式，最大 10MB"
      : "支持 DOC、DOCX 格式";
  };

  const getPlaceholderText = () => {
    if (selectedTool === "patent-search") {
      return "请输入关键词进行检索...";
    }
    return "向专利助手提问...";
  };

  return (
    <div className="w-full max-w-3xl mx-auto px-4 pb-6">
      {/* Main Input Box */}
      <div className="rounded-2xl border border-border bg-card shadow-lg">
        {/* Hidden file input */}
        <input
          ref={fileInputRef}
          type="file"
          accept={getAcceptTypes()}
          onChange={handleFileChange}
          className="hidden"
          multiple={selectedTool === "analysis"}
        />

        {/* Text Input Area or File Upload Area */}
        {needsFileUpload ? (
          <div
            className={cn(
              "p-4 transition-colors",
              isDragging && "bg-primary/5",
            )}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
          >
            {uploadedFiles.length > 0 ? (
              <div className="flex flex-col gap-2 max-h-[260px] overflow-y-auto pr-1 custom-scrollbar">
                {uploadedFiles.map((file, index) => (
                  <div
                    key={index}
                    className="flex items-center justify-between rounded-lg border border-border bg-accent/50 px-4 py-3"
                  >
                    <div className="flex items-center gap-3">
                      <FileText className="h-5 w-5 text-primary" />
                      <div className="flex flex-col">
                        <span className="text-sm font-medium text-foreground">
                          {file.name}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {(file.size / 1024).toFixed(2)} KB
                        </span>
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => handleRemoveFile(index)}
                      className="h-8 w-8 text-muted-foreground hover:text-foreground"
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
                {selectedTool === "analysis" && (
                  <button
                    onClick={handleUploadClick}
                    className="flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-border bg-accent/30 py-2 text-sm text-muted-foreground transition-colors hover:border-primary hover:bg-accent/50 hover:text-foreground"
                  >
                    <Upload className="h-4 w-4" />
                    继续上传（或拖拽文件）
                  </button>
                )}
              </div>
            ) : (
              <button
                onClick={handleUploadClick}
                className={cn(
                  "flex w-full items-center justify-center gap-3 rounded-lg border-2 border-dashed border-border bg-accent/30 px-4 py-8 transition-colors hover:border-primary hover:bg-accent/50",
                  isDragging && "border-primary bg-primary/10",
                )}
              >
                <Upload className="h-6 w-6 text-muted-foreground" />
                <div className="flex flex-col items-start">
                  <span className="text-sm font-medium text-foreground">
                    {getUploadText()}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {getFormatText()}
                  </span>
                </div>
              </button>
            )}
          </div>
        ) : (
          <div className="p-4">
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              onKeyDown={handleKeyDown}
              disabled={disabled}
              placeholder={getPlaceholderText()}
              className="w-full resize-none bg-transparent text-foreground placeholder:text-muted-foreground focus:outline-none min-h-[60px] max-h-[200px]"
              rows={2}
            />
          </div>
        )}

        {/* Toolbar */}
        <div className="flex items-center justify-between border-t border-border px-4 py-3">
          {/* Left Side - Tool Options */}
          <div className="flex items-center gap-2">
            {tools.map((tool) => (
              <button
                key={tool.id}
                disabled={disabled}
                onClick={() => {
                  // 专利交底书直接触发工作流
                  if (tool.id === "disclosure") {
                    onSend?.("开始专利交底书流程", "disclosure");
                    return;
                  }
                  setSelectedTool(selectedTool === tool.id ? null : tool.id);
                }}
                className={cn(
                  "flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm transition-colors",
                  selectedTool === tool.id
                    ? "bg-primary/10 text-primary"
                    : "text-muted-foreground hover:bg-accent hover:text-foreground",
                )}
              >
                {tool.icon}
                <span>{tool.name}</span>
              </button>
            ))}
          </div>

          {/* Right Side - Actions */}
          <div className="flex items-center gap-2">
            <Button
              onClick={handleSend}
              disabled={
                disabled ||
                (needsFileUpload ? uploadedFiles.length === 0 : !message.trim())
              }
              size="icon"
              className={cn(
                "h-9 w-9 rounded-full transition-all",
                (needsFileUpload ? uploadedFiles.length > 0 : message.trim())
                  ? "bg-primary text-primary-foreground hover:bg-primary/90"
                  : "bg-muted text-muted-foreground",
              )}
            >
              <Send className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
