"use client";
import { useState } from "react";
import ReactMarkdown from "react-markdown";
import { Button } from "@/components/ui/button";
export function PatentAnalysisButton({ id }: { id: string }) {
  const [content, setContent] = useState("");
  const [loading, setLoading] = useState(false);
  const analyze = async () => {
    setLoading(true);
    const r = await fetch(`/api/patents/${id}/analysis`, { method: "POST" });
    const d = await r.json();
    setContent(r.ok ? d.data.content : d.error || "解析失败");
    setLoading(false);
  };
  return (
    <section className="mt-6 rounded-xl border p-5">
      <Button onClick={analyze} disabled={loading || Boolean(content)}>
        {loading ? "解析中…" : "专利解析"}
      </Button>
      {content && (
        <div className="prose prose-sm mt-4 max-w-none">
          <ReactMarkdown>{content}</ReactMarkdown>
        </div>
      )}
    </section>
  );
}
