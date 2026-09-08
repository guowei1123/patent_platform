import Link from "next/link";
import { searchPatents } from "@/app/api/report/patent-search/service";
import { PatentAnalysisButton } from "@/components/patent-analysis-button";

export default async function PatentDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const id = (await params).id;
  const patent = (await searchPatents({ id, limit: 1 })).items[0];
  if (!patent) return <main className="p-8">未找到该专利。</main>;
  return (
    <main className="mx-auto max-w-4xl p-8">
      <Link href="/patent-search" className="text-primary">
        ← 返回专利检索
      </Link>
      <article className="mt-5 rounded-xl border p-6">
        <p className="text-sm text-primary">
          公开号：{patent.docNumber || "未知"} · {patent.kind} ·{" "}
          {patent.pubDate}
        </p>
        <h1 className="mt-3 text-2xl font-semibold">{patent.title}</h1>
        <p className="mt-4">申请人：{patent.applicant || "未知"}</p>
        <p className="mt-3 font-mono text-sm">
          {patent.ipcCodes.join("、") || "暂无 IPC"}
        </p>
        <h2 className="mt-6 border-t pt-4 font-semibold">摘要</h2>
        <p className="mt-3 whitespace-pre-wrap leading-7">
          {patent.abstract || "暂无摘要"}
        </p>
      </article>
      <PatentAnalysisButton id={patent.id} />
    </main>
  );
}
