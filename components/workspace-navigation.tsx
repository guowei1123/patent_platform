"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const destinations = [
  ["/qa", "专利问答"],
  ["/patent-search", "专利检索"],
  ["/patent-parse", "专利解析"],
  ["/patent-search-formula", "检索式生成"],
  ["/report", "检索报告"],
  ["/disclosure", "交底书撰写"],
] as const;

export function WorkspaceNavigation({
  vertical = false,
}: {
  vertical?: boolean;
}) {
  const pathname = usePathname();
  return (
    <nav
      aria-label="功能导航"
      className={cn("flex gap-1", vertical ? "flex-col" : "flex-wrap")}
    >
      {destinations.map(([href, label]) => {
        const active =
          pathname === href || (pathname === "/" && href === "/qa");
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "rounded-lg px-3 py-2 text-sm transition-colors hover:bg-muted",
              active
                ? "bg-primary/10 font-semibold text-primary"
                : "text-muted-foreground",
            )}
          >
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
