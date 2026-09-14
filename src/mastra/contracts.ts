import { z } from "zod";
import type { RagResult } from "../../lib/rag/types";

const dateField = (endOfYear: boolean) =>
  z.preprocess(
    (value) => {
      if (typeof value !== "string") return value;
      const normalized = value.trim();
      if (
        /^(至今|现在|当前|today|present|至今|无|不限|当前日期)?$/i.test(
          normalized,
        )
      )
        return undefined;
      const year = normalized.match(/^(\d{4})(?:年)?$/);
      if (year) return `${year[1]}-${endOfYear ? "12-31" : "01-01"}`;
      if (/^\d{4}-\d{2}-\d{2}$/.test(normalized)) return normalized;
      return undefined;
    },
    z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
  );

const sortByField = z.preprocess(
  (value) => {
    if (value === "date_desc" || value === "newest") return "pub_date_desc";
    if (value === "date_asc" || value === "oldest") return "pub_date_asc";
    return value;
  },
  z
    .enum(["pub_date_desc", "pub_date_asc", "relevance"])
    .default("pub_date_desc"),
);

const stringListField = (maxItems: number, maxLength: number) =>
  z.preprocess(
    (value) => {
      if (typeof value !== "string") return value;
      const normalized = value.trim();
      if (normalized.startsWith("[")) {
        try {
          const parsed = JSON.parse(normalized) as unknown;
          if (Array.isArray(parsed)) return parsed;
        } catch {
          // 不是合法 JSON 时继续按常见分隔符拆分。
        }
      }
      return normalized
        .split(/[，、,;；\n\r]/)
        .map((item) => item.trim())
        .filter(Boolean);
    },
    z.array(z.string().trim().min(1).max(maxLength)).max(maxItems),
  );

const optionalTextField = (maxLength: number) =>
  z.preprocess((value) => {
    if (typeof value !== "string") return value;
    const normalized = value.trim();
    return /^(none|null|undefined|无|不限)?$/i.test(normalized)
      ? undefined
      : normalized;
  }, z.string().max(maxLength).optional());

const patentKindField = z.preprocess(
  (value) => {
    if (typeof value !== "string") return value;
    const normalized = value.trim();
    if (/^(none|null|undefined|无|不限)?$/i.test(normalized)) return undefined;
    if (/^(u|ut|实用新型|utility\s*model)$/i.test(normalized)) return "U";
    if (/^(a|发明公开|发明申请公开)$/i.test(normalized)) return "A";
    if (/^(b|发明授权|授权发明)$/i.test(normalized)) return "B";
    if (/^(s|外观设计|design)$/i.test(normalized)) return "S";
    return normalized.toUpperCase();
  },
  z.enum(["A", "B", "U", "S"]).optional(),
);

export const agentModeSchema = z.enum(["auto", "qa", "search", "report"]);
export type AgentMode = z.infer<typeof agentModeSchema>;

export const searchStrategySchema = z
  .object({
    topic: z.string().trim().min(1).max(300),
    keywords: stringListField(15, 100).refine((items) => items.length > 0, {
      message: "至少需要一个检索关键词",
    }),
    ipcCodes: stringListField(10, 30).default([]),
    applicant: optionalTextField(200),
    dateFrom: dateField(false),
    dateTo: dateField(true),
    kind: patentKindField,
    sortBy: sortByField,
    limit: z.coerce.number().int().min(1).max(50).default(20),
    explanation: z.string().trim().max(1000).default(""),
  })
  .superRefine((value, ctx) => {
    if (value.dateFrom && value.dateTo && value.dateFrom > value.dateTo) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "起始日期不能晚于结束日期",
        path: ["dateFrom"],
      });
    }
  });

export type SearchStrategy = z.infer<typeof searchStrategySchema>;

export const searchResumeSchema = z.object({
  decision: z.enum(["approve", "cancel"]),
  strategy: searchStrategySchema.optional(),
});

export const conversationTypeSchema = z.enum(["qa", "search", "report"]);
export type ConversationType = z.infer<typeof conversationTypeSchema>;

export type AgentEvent =
  | { type: "conversation"; conversationId: string; title: string }
  | { type: "text-delta"; content: string }
  | { type: "rag-sources"; data: RagResult }
  | { type: "plan"; steps: Array<{ id: string; title: string }> }
  | { type: "tool-start"; tool: string; label: string }
  | { type: "tool-result"; tool: string; summary: string }
  | {
      type: "approval-required";
      runId: string;
      toolCallId: string;
      strategy: SearchStrategy;
    }
  | { type: "search-results"; data: unknown }
  | { type: "error"; code: string; message: string; retryable: boolean }
  | { type: "done"; status: string };
