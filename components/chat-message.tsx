"use client";

import { cn } from "@/lib/utils";
import { User, Bot } from "lucide-react";
import ReactMarkdown from "react-markdown";
import type { RagResult, RagSource } from "@/lib/rag/types";

export interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
  tool?: string;
  rag?: RagResult;
}

interface ChatMessageProps {
  message: Message;
}

type SourceFileGroup = {
  key: string;
  title: string;
  sources: RagSource[];
};

function groupSourcesByFile(sources: RagSource[]): SourceFileGroup[] {
  const groups = new Map<string, SourceFileGroup>();
  for (const source of sources) {
    const key = `${source.knowledgeBaseId}:${source.knowledgeId}`;
    const group = groups.get(key);
    if (group) group.sources.push(source);
    else groups.set(key, { key, title: source.title, sources: [source] });
  }
  return [...groups.values()];
}

export function ChatMessage({ message }: ChatMessageProps) {
  const isUser = message.role === "user";
  const sourceFiles = message.rag
    ? groupSourcesByFile(message.rag.sources)
    : [];

  return (
    <div
      className={cn(
        "flex w-full gap-4 px-4 py-6",
        isUser ? "bg-background" : "bg-muted/30",
      )}
    >
      <div className="flex w-full max-w-3xl mx-auto gap-4">
        {/* Avatar */}
        <div
          className={cn(
            "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg",
            isUser
              ? "bg-primary/10 text-primary"
              : "bg-primary text-primary-foreground",
          )}
        >
          {isUser ? <User className="h-4 w-4" /> : <Bot className="h-4 w-4" />}
        </div>

        {/* Content */}
        <div className="flex-1 space-y-2 overflow-hidden">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-foreground">
              {isUser ? "你" : "专利智能助手"}
            </span>
            {message.tool && (
              <span className="text-xs text-muted-foreground">
                · {message.tool}
              </span>
            )}
          </div>
          <div className="prose prose-sm max-w-none text-foreground leading-relaxed">
            <ReactMarkdown>{message.content}</ReactMarkdown>
          </div>
          {message.rag && (
            <div className="space-y-2 border-t border-border pt-3 text-xs text-muted-foreground">
              <p>
                {message.rag.status === "disabled"
                  ? "知识库未启用 · 当前回答仅供一般参考"
                  : message.rag.status === "empty"
                    ? "未检索到相关资料 · 当前问题缺少知识库依据"
                    : `检索参考资料 · ${sourceFiles.length} 个文件 · 命中 ${message.rag.sources.length} 个片段`}
              </p>
              {sourceFiles.map((file) => (
                <details
                  key={file.key}
                  className="rounded-md border border-border px-3 py-2"
                >
                  <summary className="cursor-pointer text-foreground">
                    {file.title} · 命中 {file.sources.length} 个片段
                  </summary>
                  <div className="mt-2 space-y-2">
                    {file.sources.map((source) => (
                      <details
                        key={source.id}
                        className="rounded border border-border/70 px-2 py-1.5"
                      >
                        <summary className="cursor-pointer text-foreground">
                          [{source.number}] 命中片段
                        </summary>
                        <p className="mt-2 whitespace-pre-wrap break-words leading-relaxed">
                          {source.content}
                        </p>
                      </details>
                    ))}
                  </div>
                </details>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
