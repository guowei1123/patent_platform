import { z } from "zod";

export const sectionKeys = [
  "inventionName",
  "contactPerson",
  "applicationType",
  "technicalField",
  "techBackground",
  "technicalSolution",
  "beneficialEffects",
  "protectionPoints",
] as const;
export const sectionKeySchema = z.enum(sectionKeys);
export type SectionKey = z.infer<typeof sectionKeySchema>;
export const sectionLabels: Record<SectionKey, string> = {
  inventionName: "发明名称",
  contactPerson: "联系人",
  applicationType: "申请类型",
  technicalField: "技术领域",
  techBackground: "技术背景与问题",
  technicalSolution: "技术方案与实施方式",
  beneficialEffects: "有益效果",
  protectionPoints: "技术关键点和欲保护点",
};
export const sectionsSchema = z.object({
  inventionName: z.string().max(300),
  contactPerson: z.string().max(300),
  applicationType: z.enum(["", "发明", "实用新型"]),
  technicalField: z.string().max(2000),
  techBackground: z.string().max(20000),
  technicalSolution: z.string().max(40000),
  beneficialEffects: z.string().max(15000),
  protectionPoints: z.string().max(15000),
});
export const sourceSchema = z.object({
  id: z.string(),
  label: z.string(),
  text: z.string().max(120000),
});
export const factSchema = z.object({
  text: z.string().max(2000),
  sourceId: z.string(),
  quote: z.string().min(1).max(3000),
  category: z.enum(["问题", "技术手段", "实施方式", "效果依据", "基本信息"]),
});
export const issueSchema = z.object({
  section: sectionKeySchema,
  severity: z.enum(["error", "warning"]),
  message: z.string().max(2000),
});
export const patchSchema = z.object({
  section: sectionKeySchema,
  content: z.string().max(40000),
  reason: z.string().max(2000),
});
export const sectionImpactSchema = z.object({
  sourceSection: sectionKeySchema,
  affectedSection: sectionKeySchema,
  reason: z.string().max(1000),
  status: z.enum(["needs-review", "suggested"]),
});
export const imageReviewSchema = z.object({
  status: z.enum(["passed", "warning", "failed", "pending"]),
  summary: z.string().max(2000),
  detectedLabels: z.array(z.string().max(300)).max(30),
  issues: z.array(z.string().max(1000)).max(20),
});
export const patentRecordSchema = z.object({
  id: z.string().max(200),
  docNumber: z.string().max(200),
  kind: z.string().max(50),
  title: z.string().max(2000),
  abstract: z.string().max(12000),
  pubDate: z.string().max(50),
  applicant: z.string().max(2000),
  ipcCodes: z.array(z.string().max(100)).max(50),
});
export const patentSearchSchema = z.object({
  id: z.string().uuid(),
  keywords: z.array(z.string().min(1).max(100)).min(1).max(8),
  total: z.number().int().nonnegative(),
  items: z.array(patentRecordSchema).max(20),
  searchedAt: z.string().datetime(),
});
export const patentInsightSchema = z.object({
  id: z.string().uuid(),
  searchId: z.string().uuid(),
  patentIds: z.array(z.string().max(200)).min(1).max(10),
  summary: z.string().max(4000),
  backgroundSuggestion: z.string().max(8000),
  differenceSuggestion: z.string().max(8000),
  limitations: z.array(z.string().max(1000)).max(8),
  createdAt: z.string().datetime(),
});
export const modelResultSchema = z.object({
  reply: z.string().max(6000),
  facts: z.array(factSchema).max(100),
  questions: z.array(z.string().max(1000)).max(3),
  patches: z.array(patchSchema).max(8),
  issues: z.array(issueSchema).max(40),
});
export const imageSchema = z.object({
  id: z.string().uuid(),
  name: z.string().max(200),
  caption: z.string().max(1000),
  detection: z.enum(["passed", "warning", "failed", "pending"]),
  reason: z.string().max(2000),
  review: imageReviewSchema.optional(),
});
export const stateSchema = z.object({
  sections: sectionsSchema,
  sources: z.array(sourceSchema).max(150),
  facts: z.array(factSchema).max(150),
  questions: z.array(z.string()).max(3),
  issues: z.array(issueSchema).max(100),
  suggestions: z.array(patchSchema).max(8).default([]),
  lockedSections: z.array(sectionKeySchema).max(8),
  images: z.array(imageSchema).max(10),
  sectionImpacts: z.array(sectionImpactSchema).max(40).default([]),
  patentSearches: z.array(patentSearchSchema).max(5).default([]),
  patentInsights: z.array(patentInsightSchema).max(10).default([]),
  messages: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        text: z.string(),
        id: z.string(),
      }),
    )
    .max(300),
  stage: z.enum(["collecting", "awaiting_input", "draft", "ready"]),
});
export type DisclosureState = z.infer<typeof stateSchema>;
export type ModelResult = z.infer<typeof modelResultSchema>;
export const commandSchema = z
  .object({
    operationId: z.string().uuid(),
    baseVersion: z.number().int().nonnegative(),
    action: z.enum([
      "message",
      "draft",
      "revise",
      "check",
      "edit",
      "accept",
      "restore",
      "image",
      "remove-image",
      "check-images",
      "search-patents",
      "analyze-patents",
    ]),
    message: z.string().trim().max(20000).default(""),
    section: sectionKeySchema.optional(),
    content: z.string().max(40000).optional(),
    restoreVersion: z.number().int().nonnegative().optional(),
    source: sourceSchema.optional(),
    image: imageSchema.optional(),
    images: z.array(imageSchema).max(10).optional(),
    imageId: z.string().uuid().optional(),
    search: z
      .object({
        keywords: z.array(z.string().trim().min(1).max(100)).min(1).max(8),
        limit: z.number().int().min(1).max(20).default(10),
      })
      .optional(),
    searchId: z.string().uuid().optional(),
    patentIds: z.array(z.string().min(1).max(200)).min(1).max(10).optional(),
  })
  .superRefine((value, ctx) => {
    if (value.action === "message" && !value.message && !value.source)
      ctx.addIssue({ code: "custom", message: "请输入方案或补充信息" });
    if (["edit", "accept", "revise"].includes(value.action) && !value.section)
      ctx.addIssue({ code: "custom", message: "请选择章节" });
    if (value.action === "edit" && value.content === undefined)
      ctx.addIssue({ code: "custom", message: "缺少章节内容" });
    if (value.action === "revise" && !value.message)
      ctx.addIssue({ code: "custom", message: "请填写修改要求" });
    if (value.action === "restore" && value.restoreVersion === undefined)
      ctx.addIssue({ code: "custom", message: "请选择版本" });
    if (value.action === "image" && !value.image)
      ctx.addIssue({ code: "custom", message: "缺少图片" });
    if (value.action === "remove-image" && !value.imageId)
      ctx.addIssue({ code: "custom", message: "缺少图片编号" });
    if (value.action === "search-patents" && !value.search)
      ctx.addIssue({ code: "custom", message: "请输入至少一个检索关键词" });
    if (
      value.action === "analyze-patents" &&
      (!value.searchId || !value.patentIds?.length)
    )
      ctx.addIssue({ code: "custom", message: "请选择需要分析的检索专利" });
  });
export type DisclosureCommand = z.infer<typeof commandSchema>;
export function initialState(): DisclosureState {
  return {
    sections: {
      inventionName: "",
      contactPerson: "",
      applicationType: "",
      technicalField: "",
      techBackground: "",
      technicalSolution: "",
      beneficialEffects: "",
      protectionPoints: "",
    },
    sources: [],
    facts: [],
    questions: [],
    issues: [],
    suggestions: [],
    lockedSections: [],
    images: [],
    sectionImpacts: [],
    patentSearches: [],
    patentInsights: [],
    messages: [],
    stage: "collecting",
  };
}
export interface DisclosureTask {
  id: string;
  conversationId: string;
  version: number;
  state: DisclosureState;
  status: "idle" | "running" | "failed";
  error: string | null;
  updatedAt: string;
  pending: DisclosureCommand | null;
  lastOperationId: string | null;
}
