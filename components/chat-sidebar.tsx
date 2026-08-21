"use client";

import { useMemo, useState } from "react";
import {
  FileText,
  Loader2,
  MessageSquare,
  PanelLeftClose,
  Plus,
  Search,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";

export interface ChatHistoryItem {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
}

interface ChatSidebarProps {
  chats: ChatHistoryItem[];
  activeChatId?: string;
  isLoading?: boolean;
  onNewChat?: () => void;
  onSelectChat?: (chatId: string) => void;
}

function formatRelativeDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";

  const today = new Date();
  const startOfToday = new Date(
    today.getFullYear(),
    today.getMonth(),
    today.getDate(),
  ).getTime();
  const startOfDate = new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
  ).getTime();
  const days = Math.round((startOfToday - startOfDate) / 86_400_000);

  if (days <= 0) return "今天";
  if (days === 1) return "昨天";
  if (days < 7) return `${days}天前`;
  return `${date.getMonth() + 1}月${date.getDate()}日`;
}

export function ChatSidebar({
  chats,
  activeChatId,
  isLoading = false,
  onNewChat,
  onSelectChat,
}: ChatSidebarProps) {
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const filteredChats = useMemo(() => {
    const query = searchQuery.trim().toLocaleLowerCase();
    if (!query) return chats;
    return chats.filter((chat) =>
      chat.title.toLocaleLowerCase().includes(query),
    );
  }, [chats, searchQuery]);

  if (isCollapsed) {
    return (
      <div className="flex h-full w-14 flex-col border-r border-border bg-sidebar">
        <div className="flex h-14 items-center justify-center border-b border-border">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setIsCollapsed(false)}
            className="h-8 w-8 text-sidebar-foreground hover:bg-sidebar-accent"
            aria-label="展开侧边栏"
          >
            <PanelLeftClose className="h-4 w-4 rotate-180" />
          </Button>
        </div>
        <div className="flex flex-col items-center gap-2 p-2">
          <Button
            variant="ghost"
            size="icon"
            onClick={onNewChat}
            className="h-9 w-9 text-sidebar-foreground hover:bg-sidebar-accent"
            aria-label="新建对话"
          >
            <Plus className="h-4 w-4" />
          </Button>
          {chats.slice(0, 8).map((chat) => (
            <Button
              key={chat.id}
              variant="ghost"
              size="icon"
              title={chat.title}
              onClick={() => onSelectChat?.(chat.id)}
              className={cn(
                "h-9 w-9 text-sidebar-foreground hover:bg-sidebar-accent",
                activeChatId === chat.id && "bg-sidebar-accent",
              )}
            >
              <MessageSquare className="h-4 w-4" />
            </Button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full w-64 flex-col border-r border-border bg-sidebar">
      <div className="flex h-14 items-center justify-between border-b border-border px-3">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary">
            <FileText className="h-4 w-4 text-primary-foreground" />
          </div>
          <span className="font-semibold text-sidebar-foreground">
            专利助手
          </span>
        </div>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setIsCollapsed(true)}
          className="h-8 w-8 text-sidebar-foreground hover:bg-sidebar-accent"
          aria-label="收起侧边栏"
        >
          <PanelLeftClose className="h-4 w-4" />
        </Button>
      </div>

      <div className="p-3">
        <Button
          className="w-full justify-start gap-2 bg-primary text-primary-foreground hover:bg-primary/90"
          onClick={onNewChat}
        >
          <Plus className="h-4 w-4" />
          新建对话
        </Button>
      </div>

      <div className="px-3 pb-2">
        <div className="flex items-center gap-2 rounded-lg border border-border bg-sidebar-accent/50 px-3 py-2">
          <Search className="h-4 w-4 text-muted-foreground" />
          <input
            type="search"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder="搜索历史对话..."
            className="min-w-0 flex-1 bg-transparent text-sm text-sidebar-foreground placeholder:text-muted-foreground focus:outline-none"
          />
        </div>
      </div>

      <div className="flex items-center justify-between px-4 py-2 text-xs text-muted-foreground">
        <span>历史对话</span>
        {!isLoading && <span>{filteredChats.length}</span>}
      </div>

      <ScrollArea className="flex-1 px-2">
        <div className="space-y-1 py-1">
          {isLoading ? (
            <div className="flex items-center justify-center gap-2 px-3 py-8 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              正在加载...
            </div>
          ) : filteredChats.length === 0 ? (
            <div className="px-3 py-8 text-center text-sm text-muted-foreground">
              {searchQuery ? "没有匹配的对话" : "暂无历史对话"}
            </div>
          ) : (
            filteredChats.map((chat) => (
              <button
                key={chat.id}
                type="button"
                onClick={() => onSelectChat?.(chat.id)}
                aria-current={activeChatId === chat.id ? "page" : undefined}
                className={cn(
                  "flex w-full items-start gap-2 rounded-lg px-2 py-2 text-left transition-colors",
                  activeChatId === chat.id
                    ? "bg-sidebar-accent text-sidebar-foreground"
                    : "text-muted-foreground hover:bg-sidebar-accent/50 hover:text-sidebar-foreground",
                )}
              >
                <MessageSquare className="mt-0.5 h-4 w-4 shrink-0" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm">{chat.title}</span>
                  <span className="block pt-0.5 text-xs text-muted-foreground">
                    {formatRelativeDate(chat.updatedAt)}
                  </span>
                </span>
              </button>
            ))
          )}
        </div>
      </ScrollArea>

      <div className="border-t border-border p-3">
        <div className="flex items-center gap-3 rounded-lg px-2 py-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10 text-primary">
            <span className="text-sm font-medium">用</span>
          </div>
          <p className="min-w-0 flex-1 truncate text-sm font-medium text-sidebar-foreground">
            我的空间
          </p>
        </div>
      </div>
    </div>
  );
}
