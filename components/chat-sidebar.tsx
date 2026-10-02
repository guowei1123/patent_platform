"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  Menu,
  FileText,
  Folder,
  MessageSquare,
  MoreHorizontal,
  PanelLeftClose,
  Pencil,
  Plus,
  Search,
  Trash2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Sheet,
  SheetContent,
  SheetTrigger,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Input } from "@/components/ui/input";

export type SidebarConversation = {
  id: string;
  type:
    | "qa"
    | "search"
    | "report"
    | "disclosure"
    | "analysis"
    | "search_formula";
  title: string;
  status: string;
  updatedAt: string;
  pendingApproval?: unknown;
};

const folders = [
  "qa",
  "search",
  "search_formula",
  "report",
  "disclosure",
  "analysis",
] as const;
type SidebarFolder = (typeof folders)[number];

const folderLabels: Record<SidebarFolder, string> = {
  qa: "通用对话",
  search: "专利检索",
  search_formula: "检索式生成",
  report: "检索报告",
  disclosure: "交底书撰写",
  analysis: "专利解析",
};

const folderPaths: Record<SidebarFolder, string> = {
  qa: "/qa",
  search: "/patent-search",
  search_formula: "/patent-search-formula",
  report: "/report",
  disclosure: "/disclosure",
  analysis: "/patent-parse",
};

export function ChatSidebar({
  conversations,
  activeConversationId,
  onNewChat,
  onSelectConversation,
  onDeleteConversation,
  onRenameConversation,
  mode,
}: {
  conversations: SidebarConversation[];
  activeConversationId: string | null;
  onNewChat: () => void;
  onSelectConversation: (id: string) => void;
  onDeleteConversation?: (id: string) => void;
  onRenameConversation?: (id: string, title: string) => Promise<void>;
  mode:
    | "qa"
    | "search"
    | "report"
    | "disclosure"
    | "analysis"
    | "search_formula";
}) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [query, setQuery] = useState("");
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [renamingConversation, setRenamingConversation] =
    useState<SidebarConversation | null>(null);
  const [renameTitle, setRenameTitle] = useState("");
  const [renaming, setRenaming] = useState(false);
  const [expandedFolders, setExpandedFolders] = useState<Set<SidebarFolder>>(
    () => new Set([mode]),
  );
  const matchingConversations = useMemo(
    () =>
      conversations.filter((item) =>
        item.title.toLowerCase().includes(query.toLowerCase()),
      ),
    [conversations, query],
  );
  const counts = {
    qa: conversations.filter((item) => item.type === "qa").length,
    search: conversations.filter((item) => item.type === "search").length,
    search_formula: conversations.filter(
      (item) => item.type === "search_formula",
    ).length,
    disclosure: conversations.filter((item) => item.type === "disclosure")
      .length,
    report: conversations.filter((item) => item.type === "report").length,
    analysis: conversations.filter((item) => item.type === "analysis").length,
  };
  const beginRename = (conversation: SidebarConversation) => {
    setRenamingConversation(conversation);
    setRenameTitle(conversation.title);
  };
  const submitRename = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!renamingConversation || !onRenameConversation) return;
    const title = renameTitle.trim();
    if (!title) return;
    if (title === renamingConversation.title) {
      setRenamingConversation(null);
      return;
    }
    setRenaming(true);
    try {
      await onRenameConversation(renamingConversation.id, title);
      setRenamingConversation(null);
    } finally {
      setRenaming(false);
    }
  };
  const compactSidebar = (
    <aside className="relative z-20 flex h-full min-h-0 w-14 shrink-0 flex-col items-center overflow-hidden border-r bg-sidebar py-3">
      <Button
        variant="ghost"
        size="icon"
        aria-label="展开菜单"
        title="展开菜单"
        onClick={() => setCollapsed(false)}
      >
        <PanelLeftClose className="h-4 w-4 rotate-180" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        onClick={onNewChat}
        aria-label="新建任务"
        title="新建任务"
        className="mt-3"
      >
        <Plus className="h-4 w-4" />
      </Button>
    </aside>
  );
  const sidebar = (
    <aside className="relative z-20 flex h-full min-h-0 w-full shrink-0 flex-col overflow-hidden border-r bg-sidebar">
      <div className="flex h-14 items-center justify-between border-b px-3">
        <div className="flex items-center gap-2 font-semibold">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary">
            <FileText className="h-4 w-4 text-primary-foreground" />
          </span>
          专利助手
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="hidden md:inline-flex"
          aria-label="收起菜单"
          title="收起菜单"
          onClick={() => setCollapsed(true)}
        >
          <PanelLeftClose className="h-4 w-4" />
        </Button>
      </div>
      <div className="p-3">
        <Button
          className="w-full justify-start gap-2"
          data-close-menu
          onClick={onNewChat}
        >
          <Plus className="h-4 w-4" />
          {mode === "analysis"
            ? "新建专利解析"
            : mode === "report"
              ? "新建检索报告"
              : mode === "search"
                ? "新建检索"
                : "新建问答"}
        </Button>
      </div>
      <div className="mx-3 mt-3 flex items-center gap-2 rounded-lg border px-2 py-2">
        <Search className="h-4 w-4 text-muted-foreground" />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          aria-label="搜索历史记录"
          placeholder="搜索历史记录…"
          className="min-w-0 flex-1 bg-transparent text-sm outline-none"
        />
      </div>
      <ScrollArea
        type="always"
        className="h-0 min-h-0 flex-1 overflow-hidden px-2 py-3 [&_[data-slot=scroll-area-viewport]>div]:!block"
      >
        <p className="px-2 pb-2 text-xs font-medium text-muted-foreground">
          历史记录
        </p>
        <div className="space-y-1">
          {folders.map((folder) => {
            const folderConversations = matchingConversations.filter(
              (item) => item.type === folder,
            );
            const expanded = expandedFolders.has(folder);
            return (
              <div key={folder} className="mb-2">
                <button
                  type="button"
                  aria-expanded={expanded}
                  onClick={() =>
                    setExpandedFolders((previous) => {
                      const next = new Set(previous);
                      if (next.has(folder)) next.delete(folder);
                      else next.add(folder);
                      return next;
                    })
                  }
                  className={cn(
                    "flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-sm hover:bg-sidebar-accent",
                    mode === folder && "bg-sidebar-accent/60 font-medium",
                  )}
                >
                  <Folder className="h-5 w-5 text-sky-600" />
                  <span className="flex-1">{folderLabels[folder]}历史</span>
                  <span className="text-muted-foreground">
                    {counts[folder]}
                  </span>
                </button>
                {expanded && (
                  <div className="ml-4 border-l pl-2">
                    {folderConversations.map((item) => (
                      <div
                        key={item.id}
                        className={cn(
                          "group/item relative flex w-full items-start gap-1 rounded-lg hover:bg-sidebar-accent",
                          item.id === activeConversationId &&
                            "bg-sidebar-accent",
                        )}
                      >
                        {folder === mode ? (
                          <button
                            onClick={() => {
                              onSelectConversation(item.id);
                              setMobileOpen(false);
                            }}
                            className="flex min-w-0 flex-1 items-start gap-2 pr-9 py-2 pl-2 text-left text-sm"
                          >
                            <MessageSquare className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                            <HistoryItem item={item} />
                          </button>
                        ) : (
                          <Link
                            href={`${folderPaths[folder]}?conversationId=${encodeURIComponent(item.id)}`}
                            className="flex min-w-0 flex-1 items-start gap-2 pr-9 py-2 pl-2 text-left text-sm"
                          >
                            <MessageSquare className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                            <HistoryItem item={item} />
                          </Link>
                        )}
                        <DropdownMenu
                          open={openMenuId === item.id}
                          onOpenChange={(open) =>
                            setOpenMenuId(open ? item.id : null)
                          }
                        >
                          <DropdownMenuTrigger
                            aria-label={`操作历史记录：${item.title}`}
                            className="absolute right-2 top-2 z-10 inline-flex h-7 w-7 items-center justify-center rounded-md border border-border bg-background text-foreground shadow-sm transition-[color,opacity] hover:bg-sidebar-accent md:opacity-0 group-hover/item:opacity-100 group-focus-within/item:opacity-100 data-[state=open]:opacity-100 [@media(hover:none)]:opacity-100"
                          >
                            <MoreHorizontal className="h-4 w-4" />
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            {onRenameConversation && (
                              <DropdownMenuItem
                                onSelect={() => beginRename(item)}
                              >
                                <Pencil className="h-4 w-4" />
                                重命名
                              </DropdownMenuItem>
                            )}
                            {onDeleteConversation && (
                              <DropdownMenuItem
                                variant="destructive"
                                onSelect={() => onDeleteConversation(item.id)}
                              >
                                <Trash2 className="h-4 w-4" />
                                删除
                              </DropdownMenuItem>
                            )}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    ))}
                    {folderConversations.length === 0 && (
                      <p className="px-2 py-4 text-sm text-muted-foreground">
                        {query
                          ? "没有匹配的历史记录，请调整搜索词"
                          : "暂无历史记录"}
                      </p>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </ScrollArea>
      <div className="border-t p-3 text-xs text-muted-foreground">
        匿名会话 · 自动保留 30 天
      </div>
      <Dialog
        open={Boolean(renamingConversation)}
        onOpenChange={(open) => {
          if (!open && !renaming) setRenamingConversation(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>重命名历史记录</DialogTitle>
          </DialogHeader>
          <form onSubmit={submitRename} className="space-y-4">
            <Input
              value={renameTitle}
              onChange={(event) => setRenameTitle(event.target.value)}
              maxLength={80}
              autoFocus
              disabled={renaming}
              aria-label="历史记录名称"
            />
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                disabled={renaming}
                onClick={() => setRenamingConversation(null)}
              >
                取消
              </Button>
              <Button type="submit" disabled={renaming || !renameTitle.trim()}>
                {renaming ? "保存中…" : "保存"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </aside>
  );
  return (
    <>
      <div
        className={cn(
          "hidden h-full shrink-0 md:block",
          collapsed ? "w-14" : "w-60",
        )}
      >
        {collapsed ? compactSidebar : sidebar}
      </div>
      <div className="w-12 shrink-0 border-r bg-card px-1 py-2 md:hidden">
        <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
          <SheetTrigger asChild aria-controls={`workspace-menu-${mode}`}>
            <Button variant="ghost" size="icon" aria-label="打开菜单">
              <Menu className="h-5 w-5" />
            </Button>
          </SheetTrigger>
          <SheetContent
            id={`workspace-menu-${mode}`}
            side="left"
            className="w-[min(288px,90vw)] gap-0 p-0"
          >
            <SheetTitle className="sr-only">功能导航与历史记录</SheetTitle>
            <SheetDescription className="sr-only">
              选择功能，或打开已保存的历史记录。
            </SheetDescription>
            <div
              className="h-full min-h-0"
              onClick={(event) => {
                const target = event.target as HTMLElement;
                if (
                  target.closest("a") ||
                  target.closest("button[data-close-menu]")
                )
                  setMobileOpen(false);
              }}
            >
              {sidebar}
            </div>
          </SheetContent>
        </Sheet>
      </div>
    </>
  );
}

function HistoryItem({ item }: { item: SidebarConversation }) {
  return (
    <span className="min-w-0 flex-1">
      <span className="block truncate" title={item.title}>
        {item.title}
      </span>
      <span className="mt-0.5 block text-xs text-muted-foreground">
        {folderLabels[item.type as SidebarFolder] || "已停用功能"}
        {item.status === "awaiting_approval" ? " · 待确认" : ""}
      </span>
    </span>
  );
}
