"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import {
  ClipboardPenLine,
  FileBarChart,
  FileScan,
  FileSearch,
  Search,
  Send,
  Paperclip,
  Sparkles,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";

export function ChatInput({
  onSend,
  mode,
  disabled = false,
  value,
  onValueChange,
  onSelectDisclosure,
  onExitDisclosure,
  onUpload,
  onOptimize,
  optimizeDisabled = false,
  className = "",
}: {
  onSend: (message: string) => void;
  mode: "qa" | "search" | "disclosure";
  disabled?: boolean;
  value?: string;
  onValueChange?: (value: string) => void;
  onSelectDisclosure?: () => void;
  onExitDisclosure?: () => void;
  onUpload?: (file: File) => void;
  onOptimize?: () => void;
  optimizeDisabled?: boolean;
  className?: string;
}) {
  const [draft, setDraft] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);
  const message = value ?? draft;
  const setMessage = (next: string) =>
    onValueChange ? onValueChange(next) : setDraft(next);
  const disclosure = mode === "disclosure";
  const send = () => {
    if (message.trim() && !disabled) {
      onSend(message.trim());
      if (value === undefined) setDraft("");
    }
  };

  return (
    <div
      className={`mx-auto w-full max-w-3xl shrink-0 px-4 pb-4 ${className}`}
      data-chat-composer={mode}
    >
      <div
        className={`rounded-2xl border bg-card shadow-sm transition-[border-color,box-shadow] focus-within:border-primary/40 focus-within:ring-2 focus-within:ring-primary/10 ${disclosure ? "border-primary/30" : ""}`}
      >
        <textarea
          aria-label={
            disclosure
              ? "交底书补充材料"
              : mode === "search"
                ? "检索主题或关键词"
                : "专利问题"
          }
          value={message}
          disabled={disabled}
          maxLength={disclosure ? 20000 : undefined}
          onChange={(event) => setMessage(event.target.value)}
          onKeyDown={(event) => {
            if (
              event.key === "Enter" &&
              (disclosure ? event.ctrlKey || event.metaKey : !event.shiftKey) &&
              !event.nativeEvent.isComposing
            ) {
              event.preventDefault();
              send();
            }
          }}
          placeholder={
            disclosure
              ? "补充交底书内容，或上传材料…"
              : mode === "search"
                ? "描述要检索的技术主题或关键词…"
                : "向专利助手提问…"
          }
          className="max-h-40 min-h-20 w-full resize-none rounded-t-2xl bg-transparent p-4 text-base leading-7 outline-none sm:text-sm disabled:cursor-not-allowed"
        />
        <div className="flex flex-wrap items-center justify-between gap-2 px-3 pb-3">
          {disclosure ? (
            <div className="flex min-w-0 flex-wrap items-center gap-1 min-[430px]:gap-2">
              <span
                title="专利交底书"
                className="inline-flex min-h-8 items-center gap-1 rounded-full bg-primary/10 ps-2 pe-1 text-xs font-medium text-primary sm:gap-1.5 sm:text-sm"
              >
                <ClipboardPenLine className="size-4" aria-hidden="true" />
                <span className="hidden min-[400px]:inline">专利交底书</span>
                <span className="min-[400px]:hidden">交底书</span>
                {onExitDisclosure && (
                  <button
                    type="button"
                    aria-label="退出专利交底书模式"
                    title="返回对话"
                    className="flex size-7 min-[360px]:size-8 shrink-0 items-center justify-center rounded-full hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    onClick={onExitDisclosure}
                  >
                    <X className="size-3.5" aria-hidden="true" />
                  </button>
                )}
              </span>
              {onOptimize && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="px-1.5 text-primary has-[>svg]:px-1.5 min-[460px]:px-2 min-[460px]:has-[>svg]:px-2"
                  aria-label="总体优化"
                  disabled={disabled || optimizeDisabled}
                  onClick={onOptimize}
                >
                  <Sparkles aria-hidden="true" />
                  <span className="hidden min-[800px]:inline">总体优化</span>
                  <span className="hidden min-[460px]:inline min-[800px]:hidden">
                    优化
                  </span>
                </Button>
              )}
              {onUpload && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="px-1.5 text-muted-foreground has-[>svg]:px-1.5 min-[460px]:px-2 min-[460px]:has-[>svg]:px-2"
                  aria-label="上传文件 / 图片"
                  disabled={disabled}
                  onClick={() => fileInput.current?.click()}
                >
                  <Paperclip aria-hidden="true" />
                  <span className="hidden min-[1024px]:inline">
                    上传文件 / 图片
                  </span>
                  <span className="hidden min-[460px]:inline min-[1024px]:hidden">
                    上传
                  </span>
                </Button>
              )}
              <input
                ref={fileInput}
                type="file"
                className="hidden"
                accept=".docx,.pdf,.png,.jpg,.jpeg"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) onUpload?.(file);
                  event.target.value = "";
                }}
              />
            </div>
          ) : (
            <nav aria-label="专业功能" className="flex flex-wrap gap-2">
              <WorkspaceLink href="/patent-search" label="专利检索">
                <Search className="h-4 w-4" />
              </WorkspaceLink>
              <WorkspaceLink href="/patent-parse" label="专利解析">
                <FileScan className="h-4 w-4" />
              </WorkspaceLink>
              <WorkspaceLink href="/patent-search-formula" label="检索式生成">
                <FileSearch className="h-4 w-4" />
              </WorkspaceLink>
              <WorkspaceLink href="/report" label="检索报告">
                <FileBarChart className="h-4 w-4" />
              </WorkspaceLink>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="min-h-8 gap-1.5 bg-muted px-2.5 text-muted-foreground hover:bg-primary/10 hover:text-primary"
                disabled={disabled}
                onClick={onSelectDisclosure}
              >
                <ClipboardPenLine className="h-4 w-4" />
                专利交底书
              </Button>
            </nav>
          )}
          <Button
            type="button"
            size="sm"
            aria-label="发送"
            className="ms-auto shrink-0 gap-2 px-2 has-[>svg]:px-2"
            disabled={disabled || !message.trim()}
            onClick={send}
          >
            <Send className="h-4 w-4" aria-hidden="true" />
            <span className="hidden min-[500px]:inline">发送</span>
          </Button>
        </div>
      </div>
      {disabled && !disclosure && (
        <p
          role="status"
          className="mt-2 text-left text-sm text-muted-foreground"
        >
          请等待当前处理完成，或先确认上方检索条件。
        </p>
      )}
    </div>
  );
}

function WorkspaceLink({
  href,
  label,
  children,
}: {
  href: string;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className="inline-flex min-h-8 items-center gap-1.5 rounded-md bg-muted px-2.5 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-primary/10 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {children}
      {label}
    </Link>
  );
}
