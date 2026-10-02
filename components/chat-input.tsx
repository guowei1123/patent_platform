"use client";

import { useState } from "react";
import Link from "next/link";
import {
  ClipboardPenLine,
  FileBarChart,
  FileScan,
  FileSearch,
  Search,
  Send,
} from "lucide-react";
import { Button } from "@/components/ui/button";

export function ChatInput({
  onSend,
  mode,
  disabled = false,
}: {
  onSend: (message: string) => void;
  mode: "qa" | "search";
  disabled?: boolean;
}) {
  const [message, setMessage] = useState("");
  const send = () => {
    if (message.trim() && !disabled) {
      onSend(message.trim());
      setMessage("");
    }
  };

  return (
    <div className="mx-auto w-full max-w-3xl shrink-0 px-4 pb-6">
      <div className="rounded-2xl border bg-card shadow-sm">
        <textarea
          aria-label={mode === "search" ? "检索主题或关键词" : "专利问题"}
          value={message}
          disabled={disabled}
          onChange={(event) => setMessage(event.target.value)}
          onKeyDown={(event) => {
            if (
              event.key === "Enter" &&
              !event.shiftKey &&
              !event.nativeEvent.isComposing
            ) {
              event.preventDefault();
              send();
            }
          }}
          placeholder={
            mode === "search"
              ? "描述要检索的技术主题或关键词…"
              : "向专利助手提问…"
          }
          className="min-h-[112px] w-full resize-none bg-transparent rounded-t-2xl p-4 text-base leading-7 outline-none focus-visible:ring-2 focus-visible:ring-ring sm:text-sm disabled:cursor-not-allowed"
        />
        <div className="flex flex-wrap items-center gap-2 border-t px-3 py-3">
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
            <WorkspaceLink href="/disclosure" label="交底书撰写">
              <ClipboardPenLine className="h-4 w-4" />
            </WorkspaceLink>
          </nav>
          <Button
            type="button"
            className="ml-auto shrink-0 gap-2"
            disabled={disabled || !message.trim()}
            onClick={send}
          >
            <Send className="h-4 w-4" aria-hidden="true" />
            发送
          </Button>
        </div>
      </div>
      {disabled && (
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
