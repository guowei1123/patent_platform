"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  FileText,
  Folder,
  MessageSquare,
  PanelLeftClose,
  Plus,
  Search,
  Trash2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";

export type SidebarConversation = {
  id: string;
  type: "qa" | "search" | "report" | "disclosure";
  title: string;
  status: string;
  updatedAt: string;
  pendingApproval?: unknown;
};

export function ChatSidebar({
  conversations,
  activeConversationId,
  onNewChat,
  onSelectConversation,
  onDeleteConversation,
  mode,
}: {
  conversations: SidebarConversation[];
  activeConversationId: string | null;
  onNewChat: () => void;
  onSelectConversation: (id: string) => void;
  onDeleteConversation?: (id: string) => void;
  mode: "qa" | "search" | "report" | "disclosure";
}) {
  const [collapsed, setCollapsed] = useState(false);
  const [query, setQuery] = useState("");
  const currentConversations = useMemo(
    () =>
      conversations.filter(
        (item) =>
          item.type === mode &&
          item.title.toLowerCase().includes(query.toLowerCase()),
      ),
    [conversations, mode, query],
  );
  const counts = {
    qa: conversations.filter((item) => item.type === "qa").length,
    search: conversations.filter((item) => item.type === "search").length,
    disclosure: conversations.filter((item) => item.type === "disclosure")
      .length,
    report: conversations.filter((item) => item.type === "report").length,
  };
  if (collapsed)
    return (
      <aside className="flex h-full min-h-0 w-14 flex-col items-center overflow-hidden border-r bg-sidebar py-3">
        <Button variant="ghost" size="icon" onClick={() => setCollapsed(false)}>
          <PanelLeftClose className="h-4 w-4 rotate-180" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          onClick={onNewChat}
          className="mt-3"
        >
          <Plus className="h-4 w-4" />
        </Button>
      </aside>
    );
  return (
    <aside className="flex h-full min-h-0 w-64 flex-col overflow-hidden border-r bg-sidebar">
      <div className="flex h-14 items-center justify-between border-b px-3">
        <div className="flex items-center gap-2 font-semibold">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary">
            <FileText className="h-4 w-4 text-primary-foreground" />
          </span>
          专利助手
        </div>
        <Button variant="ghost" size="icon" onClick={() => setCollapsed(true)}>
          <PanelLeftClose className="h-4 w-4" />
        </Button>
      </div>
      <div className="p-3">
        <Button className="w-full justify-start gap-2" onClick={onNewChat}>
          <Plus className="h-4 w-4" />
          新建对话
        </Button>
      </div>
      <div className="mx-3 flex items-center gap-2 rounded-lg border px-2 py-2">
        <Search className="h-4 w-4 text-muted-foreground" />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="搜索对话…"
          className="min-w-0 flex-1 bg-transparent text-sm outline-none"
        />
      </div>
      <ScrollArea
        type="always"
        className="h-0 min-h-0 flex-1 overflow-hidden px-2 py-3"
      >
        <p className="px-2 pb-2 text-xs font-medium text-muted-foreground">
          历史记录
        </p>
        <div className="space-y-1">
          {(["qa", "search", "report", "disclosure"] as const).map((folder) => (
            <div key={folder} className="mb-2">
              <Link
                href={
                  folder === "qa"
                    ? "/qa"
                    : folder === "search"
                      ? "/patent-search"
                      : folder === "report"
                        ? "/report"
                        : "/disclosure"
                }
                className={cn(
                  "flex w-full items-center gap-2 rounded-lg px-2 py-2 text-sm hover:bg-sidebar-accent",
                  mode === folder && "bg-sidebar-accent/60 font-medium",
                )}
              >
                <Folder className="h-5 w-5 text-sky-600" />
                <span className="flex-1">
                  {folder === "qa"
                    ? "通用对话"
                    : folder === "search"
                      ? "专利检索"
                      : folder === "report"
                        ? "检索报告"
                        : "交底书撰写"}
                </span>
                <span className="text-muted-foreground">{counts[folder]}</span>
              </Link>
              {mode === folder && (
                <div className="ml-4 border-l pl-2">
                  {currentConversations.map((item) => (
                    <div
                      key={item.id}
                      className={cn(
                        "group flex w-full items-start gap-1 rounded-lg hover:bg-sidebar-accent",
                        item.id === activeConversationId && "bg-sidebar-accent",
                      )}
                    >
                      <button
                        onClick={() => onSelectConversation(item.id)}
                        className="flex min-w-0 flex-1 items-start gap-2 px-2 py-2 text-left text-sm"
                      >
                        <MessageSquare className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate">{item.title}</span>
                          <span className="mt-0.5 block text-xs text-muted-foreground">
                            {item.type === "search"
                              ? "专利检索"
                              : item.type === "report"
                                ? "检索报告"
                                : item.type === "disclosure"
                                  ? "交底书撰写"
                                  : "专利问答"}
                            {item.status === "awaiting_approval"
                              ? " · 待确认"
                              : ""}
                          </span>
                        </span>
                      </button>
                      {onDeleteConversation && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          title="删除对话"
                          aria-label={`删除对话：${item.title}`}
                          onClick={() => onDeleteConversation(item.id)}
                          className="mt-1 h-7 w-7 shrink-0 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </div>
                  ))}
                  {currentConversations.length === 0 && (
                    <p className="px-2 py-4 text-sm text-muted-foreground">
                      暂无历史对话
                    </p>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      </ScrollArea>
      <div className="border-t p-3 text-xs text-muted-foreground">
        匿名会话 · 自动保留 30 天
      </div>
    </aside>
  );
}
