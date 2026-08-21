"use client";

import {
  deleteClassificationIPC,
  getClassificationIPCList,
  getClassificationIPCVector,
  saveClassificationIPC,
  searchClassificationIPCs,
  type ClassificationIPC as IPC,
} from "@/lib/service/classification-ipc";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Plus, Search, RefreshCw, X, Edit, Trash2, Copy } from "lucide-react";
import { useState, useEffect, Suspense } from "react";
import { toast } from "sonner";
import { useRouter, useSearchParams } from "next/navigation";

function IPCPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();

  // Get params from URL
  const page = parseInt(searchParams.get("page") || "1");
  const pageSizeParam = parseInt(searchParams.get("pageSize") || "10");
  const codeParam = searchParams.get("code") || "";

  // Local state for UI
  const [pageSize, setPageSize] = useState(pageSizeParam);
  const [searchCode, setSearchCode] = useState(codeParam);

  const [data, setData] = useState<(IPC & { similarity?: string })[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [isSemanticSearch, setIsSemanticSearch] = useState(false);

  // Form states
  const [code, setCode] = useState("");
  const [level, setLevel] = useState("");
  const [descriptionZh, setDescriptionZh] = useState("");
  const [descriptionEn, setDescriptionEn] = useState("");
  const [note, setNote] = useState("");

  // Sync local state when URL params change
  useEffect(() => {
    setPageSize(pageSizeParam);
    setSearchCode(codeParam);
  }, [pageSizeParam, codeParam]);

  const loadData = async () => {
    setLoading(true);
    try {
      setIsSemanticSearch(false);
      const result = await getClassificationIPCList(
        page,
        pageSizeParam,
        codeParam,
      );
      setData(result.data);
      setTotal(result.total);
    } catch (error) {
      toast.error("加载数据失败");
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [page, pageSizeParam, codeParam]);

  const updateUrl = (newPage: number, newPageSize: number, newCode: string) => {
    const params = new URLSearchParams();
    params.set("page", newPage.toString());
    params.set("pageSize", newPageSize.toString());
    if (newCode) {
      params.set("code", newCode);
    }
    router.push(`?${params.toString()}`);
  };

  const handlePageSizeChange = (value: string) => {
    const newSize = parseInt(value);
    setPageSize(newSize); // Optimistic update
    updateUrl(1, newSize, codeParam);
  };

  const handleSearch = () => {
    updateUrl(1, pageSizeParam, searchCode);
  };

  const handleSemanticSearch = async () => {
    if (!searchCode) {
      toast.error("请输入搜索内容");
      return;
    }
    setLoading(true);
    try {
      const results = await searchClassificationIPCs(searchCode, 10);
      const ipcs = results.map((doc) => ({
        ...doc.metadata,
        similarity: doc.metadata.similarity,
      })) as (IPC & { similarity?: string })[];
      setData(ipcs);
      setTotal(ipcs.length);
      setIsSemanticSearch(true);
    } catch (error) {
      toast.error("语义搜索失败");
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  const handleResetSearch = () => {
    setSearchCode(""); // Optimistic update
    updateUrl(1, pageSizeParam, "");
  };

  const handlePageChange = (newPage: number) => {
    updateUrl(newPage, pageSizeParam, codeParam);
  };

  const handleCreate = async () => {
    if (!code || !level || !descriptionZh) {
      toast.error("请填写所有必填字段");
      return;
    }

    setSubmitting(true);
    try {
      await saveClassificationIPC({
        code,
        level,
        description_zh: descriptionZh,
        description_en: descriptionEn,
        note,
      });
      toast.success(isEditing ? "修改成功" : "创建成功");
      setCreateOpen(false);
      resetForm();
      setIsEditing(false);
      loadData();
    } catch (error) {
      toast.error(isEditing ? "修改失败" : "创建失败");
      console.error(error);
    } finally {
      setSubmitting(false);
    }
  };

  const resetForm = () => {
    setCode("");
    setLevel("");
    setDescriptionZh("");
    setDescriptionEn("");
    setNote("");
  };

  const handleEdit = (ipc: IPC) => {
    setIsEditing(true);
    setCode(ipc.code);
    setLevel(ipc.level);
    setDescriptionZh(ipc.description_zh);
    setDescriptionEn(ipc.description_en || "");
    setNote(ipc.note || "");
    setCreateOpen(true);
  };

  const handleCreateOpenChange = (open: boolean) => {
    setCreateOpen(open);
    if (!open) {
      resetForm();
      setIsEditing(false);
    }
  };

  const handleDeleteClick = (id: string) => {
    setDeleteId(id);
    setDeleteOpen(true);
  };

  const confirmDelete = async () => {
    if (!deleteId) return;
    try {
      await deleteClassificationIPC(deleteId);
      toast.success("删除成功");
      setDeleteOpen(false);
      loadData();
    } catch (error) {
      toast.error("删除失败");
    }
  };

  const handleCopyVector = async (code: string) => {
    try {
      const vector = await getClassificationIPCVector(code);
      if (vector) {
        await navigator.clipboard.writeText(JSON.stringify(vector));
        toast.success("向量已复制到剪贴板");
      } else {
        toast.error("未找到向量数据");
      }
    } catch (error) {
      toast.error("获取向量失败");
    }
  };

  const totalPages = Math.ceil(total / pageSize);

  return (
    <div className="flex flex-1 flex-col p-4 pt-0 max-w-6xl mx-auto w-full h-[calc(100vh-6rem)]">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between mb-4">
        <h2 className="text-3xl font-bold tracking-tight">IPC 管理</h2>
        <div className="flex flex-col sm:flex-row items-center gap-2">
          <div className="relative flex items-center w-full sm:w-auto">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              type="search"
              placeholder="搜索 IPC 编号或语义描述..."
              className="pl-8 w-full sm:w-[300px]"
              value={searchCode}
              onChange={(e) => setSearchCode(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSearch()}
            />
            {searchCode && (
              <Button
                variant="ghost"
                size="icon"
                className="absolute right-0 top-0 h-full px-3 py-2 hover:bg-transparent"
                onClick={handleResetSearch}
              >
                <X className="h-4 w-4 text-muted-foreground" />
                <span className="sr-only">清除</span>
              </Button>
            )}
          </div>
          <div className="flex items-center gap-2 w-full sm:w-auto">
            <Button variant="secondary" onClick={handleSearch}>
              搜索
            </Button>
            <Button variant="default" onClick={handleSemanticSearch}>
              语义搜索
            </Button>
            <Button
              variant="outline"
              onClick={() => loadData()}
              disabled={loading}
              size="icon"
              title="刷新"
            >
              <RefreshCw
                className={`h-4 w-4 ${loading ? "animate-spin" : ""}`}
              />
            </Button>
            <Dialog open={createOpen} onOpenChange={handleCreateOpenChange}>
              <DialogTrigger asChild>
                <Button>
                  <Plus className="mr-2 h-4 w-4" />
                  新增 IPC
                </Button>
              </DialogTrigger>
              <DialogContent className="sm:max-w-[425px]">
                <DialogHeader>
                  <DialogTitle>
                    {isEditing ? "编辑 IPC" : "新增 IPC"}
                  </DialogTitle>
                  <DialogDescription>
                    {isEditing
                      ? "修改 IPC 信息，保存后将自动重新生成向量。"
                      : "添加新的 IPC 分类信息到数据库。"}
                  </DialogDescription>
                </DialogHeader>
                <div className="grid gap-4 py-4">
                  <div className="grid grid-cols-4 items-center gap-4">
                    <Label htmlFor="code" className="text-right">
                      编号 <span className="text-red-500">*</span>
                    </Label>
                    <Input
                      id="code"
                      value={code}
                      onChange={(e) => setCode(e.target.value)}
                      className="col-span-3"
                      placeholder="例如：H04L"
                      disabled={isEditing}
                    />
                  </div>
                  <div className="grid grid-cols-4 items-center gap-4">
                    <Label htmlFor="level" className="text-right">
                      层级 <span className="text-red-500">*</span>
                    </Label>
                    <Input
                      id="level"
                      value={level}
                      onChange={(e) => setLevel(e.target.value)}
                      className="col-span-3"
                      placeholder="例如：部/大类/小类"
                    />
                  </div>
                  <div className="grid grid-cols-4 items-center gap-4">
                    <Label htmlFor="desc_zh" className="text-right">
                      中文描述 <span className="text-red-500">*</span>
                    </Label>
                    <Textarea
                      id="desc_zh"
                      value={descriptionZh}
                      onChange={(e) => setDescriptionZh(e.target.value)}
                      className="col-span-3"
                      placeholder="输入中文描述"
                    />
                  </div>
                  <div className="grid grid-cols-4 items-center gap-4">
                    <Label htmlFor="desc_en" className="text-right">
                      英文描述
                    </Label>
                    <Textarea
                      id="desc_en"
                      value={descriptionEn}
                      onChange={(e) => setDescriptionEn(e.target.value)}
                      className="col-span-3"
                      placeholder="输入英文描述"
                    />
                  </div>
                  <div className="grid grid-cols-4 items-center gap-4">
                    <Label htmlFor="note" className="text-right">
                      备注
                    </Label>
                    <Textarea
                      id="note"
                      value={note}
                      onChange={(e) => setNote(e.target.value)}
                      className="col-span-3"
                      placeholder="可选备注信息"
                    />
                  </div>
                </div>
                <DialogFooter>
                  <Button
                    variant="outline"
                    onClick={() => handleCreateOpenChange(false)}
                  >
                    取消
                  </Button>
                  <Button onClick={handleCreate} disabled={submitting}>
                    {submitting ? "提交中..." : "保存"}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        </div>
      </div>

      <Card className="flex-1 py-0 gap-0 overflow-hidden flex flex-col shadow-sm">
        <div className="p-4 flex items-center justify-between border-b">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <span>共 {total} 条记录</span>
            <Select
              value={pageSize.toString()}
              onValueChange={handlePageSizeChange}
            >
              <SelectTrigger className="h-8 w-[70px]">
                <SelectValue placeholder={pageSize} />
              </SelectTrigger>
              <SelectContent side="bottom">
                <SelectItem value="10">10</SelectItem>
                <SelectItem value="20">20</SelectItem>
                <SelectItem value="50">50</SelectItem>
              </SelectContent>
            </Select>
            <span>条/页</span>
          </div>
          <Pagination className="w-auto mx-0">
            <PaginationContent>
              {page > 1 && (
                <PaginationItem>
                  <PaginationPrevious
                    href="#"
                    onClick={(e) => {
                      e.preventDefault();
                      handlePageChange(page - 1);
                    }}
                  />
                </PaginationItem>
              )}

              {Array.from({ length: totalPages }, (_, i) => i + 1)
                .filter(
                  (p) =>
                    p === 1 ||
                    p === totalPages ||
                    (p >= page - 2 && p <= page + 2),
                )
                .map((p, index, array) => (
                  <PaginationItem key={p}>
                    {index > 0 && array[index - 1] !== p - 1 && (
                      <span className="mx-2">...</span>
                    )}
                    <PaginationLink
                      href="#"
                      isActive={page === p}
                      onClick={(e) => {
                        e.preventDefault();
                        handlePageChange(p);
                      }}
                    >
                      {p}
                    </PaginationLink>
                  </PaginationItem>
                ))}

              {page < totalPages && (
                <PaginationItem>
                  <PaginationNext
                    href="#"
                    onClick={(e) => {
                      e.preventDefault();
                      handlePageChange(page + 1);
                    }}
                  />
                </PaginationItem>
              )}
            </PaginationContent>
          </Pagination>
        </div>
        <div className="flex-1 overflow-auto">
          <Table>
            <TableHeader className="sticky top-0 bg-card z-10">
              <TableRow>
                <TableHead className="w-[100px]">编号</TableHead>
                <TableHead className="w-[150px]">层级</TableHead>
                <TableHead>中文描述</TableHead>
                <TableHead>英文描述</TableHead>
                <TableHead className="w-[150px]">备注</TableHead>
                <TableHead className="w-[180px]">创建时间</TableHead>
                {isSemanticSearch && (
                  <TableHead className="w-[100px]">相似度</TableHead>
                )}
                <TableHead className="w-[150px]">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell
                    colSpan={isSemanticSearch ? 8 : 7}
                    className="text-center h-24 text-muted-foreground"
                  >
                    加载中...
                  </TableCell>
                </TableRow>
              ) : data.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={isSemanticSearch ? 8 : 7}
                    className="text-center h-24 text-muted-foreground"
                  >
                    暂无数据
                  </TableCell>
                </TableRow>
              ) : (
                data.map((ipc) => (
                  <TableRow key={ipc.code}>
                    <TableCell className="font-medium">{ipc.code}</TableCell>
                    <TableCell>{ipc.level}</TableCell>
                    <TableCell
                      className="max-w-[200px] truncate"
                      title={ipc.description_zh}
                    >
                      {ipc.description_zh}
                    </TableCell>
                    <TableCell
                      className="max-w-[200px] truncate"
                      title={ipc.description_en}
                    >
                      {ipc.description_en}
                    </TableCell>
                    <TableCell className="max-w-[150px] truncate">
                      {ipc.note || "-"}
                    </TableCell>
                    <TableCell>
                      {ipc.created_at
                        ? new Date(ipc.created_at).toLocaleString()
                        : "-"}
                    </TableCell>
                    {isSemanticSearch && (
                      <TableCell>{ipc.similarity || "-"}</TableCell>
                    )}
                    <TableCell>
                      <div className="flex items-center gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleEdit(ipc)}
                          title="编辑"
                        >
                          <Edit className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleCopyVector(ipc.code)}
                          title="复制向量"
                        >
                          <Copy className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleDeleteClick(ipc.code)}
                          title="删除"
                          className="text-red-500 hover:text-red-600 hover:bg-red-50"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </Card>

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认删除?</AlertDialogTitle>
            <AlertDialogDescription>
              此操作将永久删除该 IPC 记录，无法撤销。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDelete}
              className="bg-red-500 hover:bg-red-600"
            >
              删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

export default function IPCPage() {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <IPCPageContent />
    </Suspense>
  );
}
