import Link from "next/link";
import { PatentItem } from "@/lib/types";
import { Button } from "@/components/ui/button";

interface PatentSearchResultsProps {
  results: PatentItem[];
}

export function PatentSearchResults({ results }: PatentSearchResultsProps) {
  return (
    <div className="space-y-4">
      {results.map((patent) => (
        <div
          key={patent.id}
          className="rounded-lg border border-border bg-card p-6 transition-all hover:shadow-md"
        >
          <div className="flex items-start justify-between">
            <div className="flex-1 pr-4">
              <div className="mb-2 flex items-center gap-2">
                <h4 className="text-lg font-semibold text-foreground">
                  {patent.title}
                </h4>
              </div>
              <div className="mb-3 flex items-center gap-4 text-sm text-muted-foreground">
                <span>{patent.publicationNumber}</span>
                <span>{patent.applicant}</span>
                <span>申请日：{patent.publicationDate || "日期未知"}</span>
              </div>
              <p className="text-sm text-muted-foreground line-clamp-2">
                <span className="font-semibold">摘要：</span>
                {patent.abstract}
              </p>
            </div>
            <Button
              asChild
              variant="outline"
              size="sm"
              className="shrink-0 bg-transparent"
            >
              <Link
                href={`/patents/${patent.id}?returnTo=patent-search-formula`}
              >
                查看详情
              </Link>
            </Button>
          </div>
        </div>
      ))}
    </div>
  );
}
