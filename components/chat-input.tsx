"use client";

import { useState } from "react";
import { MessageCircleQuestion, Search, Send } from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";
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
          value={message}
          disabled={disabled}
          onChange={(event) => setMessage(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              send();
            }
          }}
          placeholder={
            mode === "search"
              ? "描述要检索的技术主题或关键词…"
              : "向专利助手提问…"
          }
          className="min-h-[76px] w-full resize-none bg-transparent p-4 text-sm outline-none disabled:cursor-not-allowed"
        />
        <div className="flex items-center justify-between border-t px-3 py-2">
          <div className="flex items-center gap-1 text-sm text-muted-foreground">
            <Link
              href="/qa"
              className={cn(
                "flex items-center gap-1 rounded px-2 py-1.5 hover:bg-muted",
                mode === "qa" && "bg-muted text-foreground",
              )}
            >
              <MessageCircleQuestion className="h-4 w-4" />
              通用问答
            </Link>
            <Link
              href="/patent-search"
              className={cn(
                "flex items-center gap-1 rounded px-2 py-1.5 hover:bg-muted",
                mode === "search" && "bg-muted text-foreground",
              )}
            >
              <Search className="h-4 w-4" />
              专利检索
            </Link>
          </div>
          <Button
            type="button"
            size="icon"
            className={cn(!message.trim() && "opacity-50")}
            disabled={disabled || !message.trim()}
            onClick={send}
          >
            <Send className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
