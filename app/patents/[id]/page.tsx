import Link from "next/link";
import {
  getPatentComparisonMaterials,
  searchPatents,
} from "@/app/api/report/patent-search/service";
import { PatentAnalysisButton } from "@/components/patent-analysis-button";
import { Badge } from "@/components/ui/badge";

function DetailItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="space-y-1 border-l-2 border-primary/20 pl-3.5">
      <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
      <dd className="break-words text-sm font-semibold leading-6">
        {value || "暂无信息"}
      </dd>
    </div>
  );
}

const descriptionSectionMeta = [
  { id: "technical-field", title: "技术领域" },
  { id: "background-art", title: "背景技术" },
  { id: "disclosure", title: "发明内容" },
  { id: "beneficial-effect", title: "有益效果" },
  { id: "drawings-description", title: "附图说明" },
  { id: "embodiment", title: "具体实施方式" },
] as const;

type DescriptionSection = {
  id: string;
  title: string;
  content: string;
};

function parseStoredText(value: string) {
  const content = value.trim();
  if (!content) return "";
  try {
    const parsed = JSON.parse(content);
    if (typeof parsed === "string") return parsed.trim();
  } catch {
    // 不是 JSON 字符串时，按原始正文处理。
  }
  return content.replace(/\\n/g, "\n");
}

function stripSectionHeading(content: string, title: string) {
  return content
    .replace(new RegExp(`^\\s*(?:${title}|实用新型内容)\\s*(?:\\r?\\n|$)`), "")
    .trim();
}

function splitClaims(value: string) {
  const content = parseStoredText(value);
  if (!content) return [];
  const matches = [...content.matchAll(/(?:^|\n)\s*(\d+)[.、]\s*/g)];
  if (!matches.length) return [content];
  return matches
    .map((match, index) =>
      content.slice(match.index, matches[index + 1]?.index).trim(),
    )
    .filter(Boolean);
}

function splitDescriptionText(value: string): DescriptionSection[] {
  const content = parseStoredText(value);
  if (!content) return [];
  const matches = [
    ...content.matchAll(
      /(?:^|\n)\s*(技术领域|背景技术|发明内容|实用新型内容|附图说明|具体实施方式)\s*(?=\n|$)/g,
    ),
  ];
  if (!matches.length)
    return [{ id: "full-text", title: "说明书正文", content }];

  return matches
    .map((match, index) => {
      const sourceTitle = match[1];
      const title = sourceTitle === "实用新型内容" ? "发明内容" : sourceTitle;
      const meta = descriptionSectionMeta.find(
        (section) => section.title === title,
      );
      return {
        id: meta?.id || `section-${index + 1}`,
        title,
        content: content
          .slice(match.index + match[0].length, matches[index + 1]?.index)
          .trim(),
      };
    })
    .filter((section) => section.content);
}

function splitDescription(value: string): DescriptionSection[] {
  const raw = value.trim();
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const record = parsed as Record<string, unknown>;
      const fields = [
        ["technical_field", "technical-field", "技术领域"],
        ["background_art", "background-art", "背景技术"],
        ["disclosure", "disclosure", "发明内容"],
        ["beneficial_effect", "beneficial-effect", "有益效果"],
        ["drawings_description", "drawings-description", "附图说明"],
        ["embodiment", "embodiment", "具体实施方式"],
      ] as const;
      const sections = fields.flatMap(([field, id, title]) => {
        const value = record[field];
        if (typeof value !== "string" || !value.trim()) return [];
        return [{ id, title, content: stripSectionHeading(value, title) }];
      });
      if (sections.length) return sections;
    }
  } catch {
    // 不是结构化 JSON 时，继续按普通说明书正文拆分。
  }
  return splitDescriptionText(raw);
}

function patentKindLabel(kind: string) {
  const labels: Record<string, string> = {
    A: "发明公开",
    B: "发明授权",
    D: "外观设计",
    U: "实用新型",
  };
  return labels[kind] || kind || "未知类型";
}

export default async function PatentDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ returnTo?: string }>;
}) {
  const id = (await params).id;
  const { returnTo } = await searchParams;
  const backToSearchFormula = returnTo === "patent-search-formula";
  const [searchResult, materials] = await Promise.all([
    searchPatents({ id, limit: 1 }),
    getPatentComparisonMaterials([id]),
  ]);
  const patent = searchResult.items[0];
  if (!patent) return <main className="p-8">未找到该专利。</main>;
  const material = materials.get(id);
  const claims = splitClaims(material?.claims || "");
  const descriptionSections = splitDescription(material?.description || "");
  const navigation = [
    { href: "#section-abstract", label: "摘要", detail: "概览" },
    {
      href: "#section-claims",
      label: "权利要求",
      detail: claims.length ? `${claims.length} 条` : "未入库",
    },
    {
      href: "#section-description",
      label: "说明书",
      detail: descriptionSections.length
        ? `${descriptionSections.length} 节`
        : "未入库",
    },
  ];

  return (
    <main className="mx-auto max-w-5xl p-5 sm:p-8">
      <Link
        href={backToSearchFormula ? "/patent-search-formula" : "/patent-search"}
        className="inline-flex rounded-md px-1 py-1 text-sm font-medium text-primary transition-colors hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        ← 返回专利检索
      </Link>

      <article
        id="top"
        className="mt-5 overflow-hidden rounded-2xl border border-primary/15 bg-card/90 shadow-sm"
      >
        <div className="h-1 w-24 rounded-br-full bg-primary" />
        <div className="p-6 sm:p-8">
          <div className="flex flex-wrap items-center gap-2 text-sm font-medium text-primary">
            <span>{patentKindLabel(patent.kind)}</span>
            <span>· 公开号：{patent.docNumber || "未知"}</span>
            {patent.appDate && <span>· 申请日：{patent.appDate}</span>}
          </div>
          <h1 className="mt-3 max-w-4xl break-words text-2xl font-semibold leading-tight tracking-tight text-balance sm:text-3xl">
            {patent.title || "未命名专利"}
          </h1>

          <dl className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            <DetailItem label="申请人" value={patent.applicant} />
            <DetailItem label="IPC 分类" value={patent.ipcCodes.join("、")} />
            <DetailItem label="文献类型" value={patent.kind} />
          </dl>
        </div>
      </article>

      <nav
        aria-label="专利正文导航"
        className="mt-6 rounded-2xl border bg-card/70 p-5 shadow-sm"
      >
        <p className="text-sm font-semibold tracking-wide">页面导航</p>
        <p className="mt-1 text-sm text-muted-foreground">
          快速跳转到专利的正文区块。
        </p>
        <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {navigation.map((item) => (
            <a
              key={item.href}
              href={item.href}
              className="rounded-xl border border-transparent bg-muted/70 px-4 py-3 text-sm transition-colors hover:border-primary/20 hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <span className="block font-medium">{item.label}</span>
              <span className="text-xs text-muted-foreground">
                {item.detail}
              </span>
            </a>
          ))}
        </div>
      </nav>

      <section className="mt-8">
        <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-xl font-semibold tracking-tight">内容概览</h2>
          <p className="text-sm text-muted-foreground">
            关键著录信息与文献正文覆盖情况
          </p>
        </div>
        <div className="grid gap-4 lg:grid-cols-3">
          <article className="rounded-2xl border bg-card/70 p-5 shadow-sm">
            <h3 className="font-semibold">文献内容</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              当前专利正文与主体信息的覆盖情况。
            </p>
            <dl className="mt-5 grid grid-cols-2 gap-4 text-sm">
              <DetailItem
                label="申请人"
                value={patent.applicant ? "1 个" : "0 个"}
              />
              <DetailItem
                label="权利要求"
                value={claims.length ? `${claims.length} 条` : "未入库"}
              />
              <DetailItem
                label="说明书章节"
                value={
                  descriptionSections.length
                    ? `${descriptionSections.length} 节`
                    : "未入库"
                }
              />
            </dl>
          </article>
          <article className="rounded-2xl border bg-card/70 p-5 shadow-sm">
            <h3 className="font-semibold">参与主体</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              当前数据中可读取的主体信息。
            </p>
            <dl className="mt-5 space-y-4">
              <DetailItem label="申请人" value={patent.applicant} />
              <DetailItem
                label="专利类型"
                value={patentKindLabel(patent.kind)}
              />
            </dl>
          </article>
          <article className="rounded-2xl border bg-card/70 p-5 shadow-sm">
            <h3 className="font-semibold">技术分类</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              IPC 分类号与文献公开信息。
            </p>
            <dl className="mt-5 space-y-4">
              <DetailItem label="申请日期" value={patent.appDate} />
              <div className="space-y-2 border-l pl-4">
                <dt className="text-xs text-muted-foreground">IPC 分类</dt>
                <dd className="flex flex-wrap gap-2">
                  {patent.ipcCodes.length ? (
                    patent.ipcCodes.map((code) => (
                      <Badge key={code} variant="outline">
                        {code}
                      </Badge>
                    ))
                  ) : (
                    <span className="text-sm font-medium">暂无信息</span>
                  )}
                </dd>
              </div>
            </dl>
          </article>
        </div>
      </section>

      <section
        id="section-abstract"
        className="mt-8 scroll-mt-6 rounded-2xl border bg-card/80 p-6 shadow-sm sm:p-8"
        aria-labelledby="patent-content-title"
      >
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2
            id="patent-content-title"
            className="text-2xl font-semibold tracking-tight"
          >
            摘要
          </h2>
          <p className="text-sm text-muted-foreground">专利内容的核心概览</p>
        </div>
        <p className="mt-5 max-w-[75ch] whitespace-pre-wrap break-words text-sm leading-7 text-muted-foreground">
          {patent.abstract || "该专利暂无摘要。"}
        </p>
      </section>

      <PatentAnalysisButton id={patent.id} />

      <section id="section-claims" className="mt-10 scroll-mt-6">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-2xl font-semibold tracking-tight">权利要求</h2>
          <p className="text-sm text-muted-foreground">
            优先展示结构化条目，便于逐条阅读。
          </p>
        </div>
        {claims.length ? (
          <div className="mt-5 space-y-4">
            {claims.map((claim, index) => (
              <article
                key={index}
                className="rounded-2xl border bg-card/80 p-5 shadow-sm transition-shadow hover:shadow-md"
              >
                <div className="flex items-center gap-3">
                  <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
                    {index + 1}
                  </span>
                  <h3 className="text-sm font-semibold">
                    权利要求 {index + 1}
                  </h3>
                </div>
                <p className="mt-4 max-w-[78ch] whitespace-pre-wrap break-words text-sm leading-7 text-muted-foreground">
                  {claim}
                </p>
              </article>
            ))}
          </div>
        ) : (
          <p className="mt-5 rounded-2xl border border-dashed bg-card/60 p-5 text-sm text-muted-foreground">
            该专利库未提供权利要求书。
          </p>
        )}
      </section>

      <section id="section-description" className="mt-10 scroll-mt-6">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-2xl font-semibold tracking-tight">说明书</h2>
          <p className="text-sm text-muted-foreground">
            按可识别章节整理，减少长文本阅读负担。
          </p>
        </div>
        {descriptionSections.length ? (
          <>
            <nav
              aria-label="说明书章节"
              className="mt-5 flex flex-wrap gap-2 rounded-2xl border bg-card/70 p-3 shadow-sm"
            >
              {descriptionSections.map((section) => (
                <a
                  key={section.id}
                  href={`#description-${section.id}`}
                  className="rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-primary/10 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {section.title}
                </a>
              ))}
            </nav>
            <div className="mt-5 space-y-5">
              {descriptionSections.map((section) => (
                <article
                  id={`description-${section.id}`}
                  key={section.id}
                  className="scroll-mt-6 rounded-2xl border bg-card/80 p-6 shadow-sm"
                >
                  <h3 className="text-lg font-semibold tracking-tight">
                    {section.title}
                  </h3>
                  <p className="mt-4 max-w-[78ch] whitespace-pre-wrap break-words text-sm leading-7 text-muted-foreground">
                    {section.content}
                  </p>
                </article>
              ))}
            </div>
          </>
        ) : (
          <p className="mt-5 rounded-2xl border border-dashed bg-card/60 p-5 text-sm text-muted-foreground">
            该专利库未提供说明书。
          </p>
        )}
      </section>

    </main>
  );
}
