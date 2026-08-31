"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Search, Eraser, Info, ChevronLeft, ChevronRight, Copy } from "lucide-react";
import { toast } from "sonner";

interface PatentItem {
  id: string;
  docNumber: string;
  kind: string;
  title: string;
  abstract: string;
  pubDate: string;
  applicant: string;
  ipcCodes: string[];
}

interface SearchResponse {
  success?: boolean;
  total: number;
  limit: number;
  offset: number;
  items: PatentItem[];
  error?: string;
}

export default function PatentSearchTestPage() {
  const [keywords, setKeywords] = useState("人工智能\n机器学习\n深度学习");
  const [ipcCodes, setIpcCodes] = useState("G06F\nG06N");
  const [applicant, setApplicant] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [kind, setKind] = useState("");
  const [sortBy, setSortBy] = useState("pub_date_desc");
  const [limit, setLimit] = useState(10);
  const [offset, setOffset] = useState(0);

  const [result, setResult] = useState<SearchResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const parseList = (text: string) =>
    text
      .split(/[，、,\n\r]/)
      .map((s) => s.trim())
      .filter(Boolean);

  const handleSearch = async (resetOffset = true) => {
    const kw = parseList(keywords);
    const ipc = parseList(ipcCodes);
    const hasApplicant = applicant.trim().length > 0;
    const hasDateFrom = dateFrom.trim().length > 0;
    const hasDateTo = dateTo.trim().length > 0;
    const hasKind = kind.trim().length > 0;

    if (
      kw.length === 0 &&
      ipc.length === 0 &&
      !hasApplicant &&
      !hasDateFrom &&
      !hasDateTo &&
      !hasKind
    ) {
      toast.error("请至少填写一个过滤条件");
      return;
    }

    const finalOffset = resetOffset ? 0 : offset;
    setLoading(true);
    setResult(null);

    try {
      const response = await fetch("/api/report/patent-search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          keywords: kw,
          ipcCodes: ipc,
          applicant: hasApplicant ? applicant.trim() : undefined,
          dateFrom: hasDateFrom ? dateFrom.trim() : undefined,
          dateTo: hasDateTo ? dateTo.trim() : undefined,
          kind: hasKind ? kind.trim() : undefined,
          sortBy,
          limit,
          offset: finalOffset,
        }),
      });
      const payload = (await response.json()) as SearchResponse;
      if (!response.ok || payload.error) {
        toast.error(payload.error || "检索失败");
        return;
      }
      setResult(payload);
      if (resetOffset) setOffset(0);
      toast.success(`检索完成，共 ${payload.total} 条`);
    } catch (err) {
      console.error("请求出错:", err);
      toast.error("网络或服务器错误");
    } finally {
      setLoading(false);
    }
  };

  const handlePrev = () => {
    if (!result || offset === 0) return;
    const newOffset = Math.max(0, offset - limit);
    setOffset(newOffset);
    void handleSearch(false);
  };

  const handleNext = () => {
    if (!result || offset + limit >= result.total) return;
    const newOffset = offset + limit;
    setOffset(newOffset);
    void handleSearch(false);
  };

  const handleClear = () => {
    setKeywords("");
    setIpcCodes("");
    setApplicant("");
    setDateFrom("");
    setDateTo("");
    setKind("");
    setSortBy("pub_date_desc");
    setLimit(10);
    setOffset(0);
    setResult(null);
    setExpandedId(null);
  };

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text);
    toast.success("已复制");
  };

  const kindBadgeColor = (k: string) => {
    if (k === "B") return "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300";
    if (k === "U") return "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300";
    if (k === "A") return "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300";
    if (k === "S") return "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300";
    return "bg-muted text-muted-foreground";
  };

  const currentPage = result ? Math.floor(result.offset / result.limit) + 1 : 1;
  const totalPages = result ? Math.max(1, Math.ceil(result.total / result.limit)) : 1;

  return (
    <div className="container mx-auto p-4">
      <div className="flex flex-1 flex-col gap-4 p-4 pt-0 max-w-7xl mx-auto w-full h-[calc(100vh-6rem)]">
        <div className="flex items-center justify-between space-y-2 mb-2">
          <div>
            <h2 className="text-3xl font-bold tracking-tight">专利检索</h2>
            <p className="text-sm text-muted-foreground mt-1">
              从 PostgreSQL 数据库 <code className="text-xs bg-muted px-1 py-0.5 rounded">patent_etl.cnipa.patent</code> 检索中国专利文献
            </p>
          </div>
          <Button variant="outline" onClick={handleClear} disabled={loading}>
            <Eraser className="mr-2 h-4 w-4" />
            清空重置
          </Button>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 h-full">
          {/* 左侧输入区 */}
          <Card className="flex flex-col h-full">
            <CardHeader>
              <CardTitle>检索条件</CardTitle>
              <CardDescription>
                至少填写一项过滤条件；条件之间为 AND 关系；关键词命中标题或摘要任一即可。
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4 flex-1 overflow-y-auto">
              <div className="space-y-2">
                <Label htmlFor="keywords">
                  关键词 <span className="text-muted-foreground text-xs">(命中标题或摘要)</span>
                </Label>
                <Textarea
                  id="keywords"
                  value={keywords}
                  onChange={(e) => setKeywords(e.target.value)}
                  placeholder={"例如：\n人工智能\n机器学习\n深度学习"}
                  className="min-h-[80px] resize-none"
                  disabled={loading}
                />
                <p className="text-xs text-muted-foreground">支持用顿号、逗号或换行分隔</p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="ipcCodes">
                  IPC 分类号 <span className="text-muted-foreground text-xs">(前缀匹配)</span>
                </Label>
                <Textarea
                  id="ipcCodes"
                  value={ipcCodes}
                  onChange={(e) => setIpcCodes(e.target.value)}
                  placeholder={"例如：\nG06F\nG06N\nH04L"}
                  className="min-h-[80px] resize-none"
                  disabled={loading}
                />
                <p className="text-xs text-muted-foreground">如 G06F 会匹配所有 G06F 开头的子类</p>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label htmlFor="applicant">申请人</Label>
                  <Input
                    id="applicant"
                    value={applicant}
                    onChange={(e) => setApplicant(e.target.value)}
                    placeholder="模糊匹配, 如: 华为"
                    disabled={loading}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="kind">文献类型</Label>
                  <Input
                    id="kind"
                    value={kind}
                    onChange={(e) => setKind(e.target.value)}
                    placeholder="B / U / A / S"
                    disabled={loading}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label htmlFor="dateFrom">公开日 起始</Label>
                  <Input
                    id="dateFrom"
                    type="date"
                    value={dateFrom}
                    onChange={(e) => setDateFrom(e.target.value)}
                    disabled={loading}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="dateTo">公开日 结束</Label>
                  <Input
                    id="dateTo"
                    type="date"
                    value={dateTo}
                    onChange={(e) => setDateTo(e.target.value)}
                    disabled={loading}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label>排序方式</Label>
                  <Select value={sortBy} onValueChange={setSortBy} disabled={loading}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="pub_date_desc">公开日 降序</SelectItem>
                      <SelectItem value="pub_date_asc">公开日 升序</SelectItem>
                      <SelectItem value="relevance">相关度</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="limit">每页条数</Label>
                  <Select
                    value={String(limit)}
                    onValueChange={(v) => setLimit(Number(v))}
                    disabled={loading}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="5">5</SelectItem>
                      <SelectItem value="10">10</SelectItem>
                      <SelectItem value="20">20</SelectItem>
                      <SelectItem value="50">50</SelectItem>
                      <SelectItem value="100">100</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <Alert className="bg-muted/50 border-muted">
                <Info className="h-4 w-4" />
                <AlertTitle>使用提示</AlertTitle>
                <AlertDescription className="text-xs mt-1 leading-relaxed">
                  <ul className="list-disc pl-4 space-y-1">
                    <li>所有过滤条件之间是 AND 关系</li>
                    <li>关键词之间是 OR 关系（任一命中即返回）</li>
                    <li>IPC 分类号为前缀匹配，可只输入大类号如 G06F</li>
                    <li>最大返回 100 条，超大数据请使用分页</li>
                  </ul>
                </AlertDescription>
              </Alert>

              <div className="pt-2">
                <Button
                  className="w-full"
                  onClick={() => handleSearch(true)}
                  disabled={loading}
                >
                  {loading ? (
                    <>
                      <Search className="mr-2 h-4 w-4 animate-spin" />
                      正在检索...
                    </>
                  ) : (
                    <>
                      <Search className="mr-2 h-4 w-4" />
                      开始检索
                    </>
                  )}
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* 右侧结果区 */}
          <Card className="flex flex-col h-full bg-muted/30">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <div>
                <CardTitle>检索结果</CardTitle>
                {result && (
                  <p className="text-xs text-muted-foreground mt-1">
                    共 {result.total} 条 · 第 {currentPage}/{totalPages} 页 ·
                    当前 {result.items.length} 条
                  </p>
                )}
              </div>
              {result && result.items.length > 0 && (
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handlePrev}
                    disabled={loading || offset === 0}
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleNext}
                    disabled={loading || offset + limit >= result.total}
                  >
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              )}
            </CardHeader>
            <CardContent className="flex-1 p-4 pt-2 overflow-y-auto space-y-3">
              {!result ? (
                <div className="h-full flex flex-col items-center justify-center text-muted-foreground space-y-4 opacity-50">
                  <Search className="h-12 w-12" />
                  <p>在左侧填写检索条件并点击开始检索...</p>
                </div>
              ) : result.items.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-muted-foreground space-y-4 opacity-50">
                  <Search className="h-12 w-12" />
                  <p>未找到匹配的专利文献</p>
                </div>
              ) : (
                result.items.map((patent) => {
                  const isExpanded = expandedId === patent.id;
                  return (
                    <div
                      key={patent.id}
                      className="rounded-lg border bg-background p-4 transition-shadow hover:shadow-sm"
                    >
                      <div className="flex items-start justify-between gap-3 mb-2">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <button
                              onClick={() => handleCopy(patent.docNumber)}
                              className="font-mono text-sm font-medium text-primary hover:underline"
                              title="点击复制公开号"
                            >
                              {patent.docNumber}
                            </button>
                            {patent.kind && (
                              <Badge variant="secondary" className={`text-xs ${kindBadgeColor(patent.kind)}`}>
                                {patent.kind}
                              </Badge>
                            )}
                            {patent.pubDate && (
                              <span className="text-xs text-muted-foreground">
                                {patent.pubDate}
                              </span>
                            )}
                          </div>
                          <h3 className="text-sm font-semibold text-foreground leading-snug">
                            {patent.title}
                          </h3>
                        </div>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setExpandedId(isExpanded ? null : patent.id)}
                          className="text-xs shrink-0"
                        >
                          {isExpanded ? "收起" : "展开"}
                        </Button>
                      </div>

                      {patent.applicant && (
                        <p className="text-xs text-muted-foreground mb-1">
                          <span className="font-medium">申请人：</span>
                          {patent.applicant}
                        </p>
                      )}
                      {patent.ipcCodes.length > 0 && (
                        <div className="flex flex-wrap gap-1 mb-2">
                          {patent.ipcCodes.map((ipc, idx) => (
                            <Badge key={idx} variant="outline" className="text-[10px] font-mono">
                              {ipc}
                            </Badge>
                          ))}
                        </div>
                      )}

                      {isExpanded && patent.abstract && (
                        <div className="mt-2 pt-2 border-t">
                          <p className="text-xs text-foreground leading-relaxed whitespace-pre-wrap">
                            {patent.abstract}
                          </p>
                        </div>
                      )}

                      {!isExpanded && patent.abstract && (
                        <p className="text-xs text-muted-foreground line-clamp-2 mt-1">
                          {patent.abstract}
                        </p>
                      )}
                    </div>
                  );
                })
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
