import { z } from "zod";
import { parsedDisclosureSchema } from "@/app/api/report/disclosure-parse/service";
import { documentClassificationResultSchema } from "@/app/api/report/document-relevance-classification/service";
import {
  candidateScreeningSchema,
  retrievalPlanSchema,
  retrievalRoundSchema,
} from "@/app/api/report/retrieval-plan/service";
import { proposalEvaluationInputSchema } from "@/lib/service/proposal-grade-evaluation";
import { searchStrategySchema } from "../contracts";

export const reportPatentSchema = z.object({
  id: z.string(),
  docNumber: z.string(),
  kind: z.string(),
  title: z.string(),
  abstract: z.string(),
  pubDate: z.string(),
  applicant: z.string(),
  ipcCodes: z.array(z.string()),
  retrievalRouteIds: z.array(z.string()).optional(),
});

export const reportPatentSearchResultSchema = z.object({
  total: z.number().int().nonnegative(),
  limit: z.number().int().positive(),
  offset: z.number().int().nonnegative(),
  items: z.array(reportPatentSchema),
});

export const classifiedReportPatentSchema = z.object({
  patent: reportPatentSchema,
  classification: documentClassificationResultSchema,
});

export const proposalEvaluationResultSchema = z.object({
  usageProspect: z.string(),
  authorizationProspect: z.string(),
  proposalGrade: z.string(),
  applicationType: z.string(),
  inventionPointAssessments: z.array(
    z.object({
      name: z.string(),
      prospect: z.string(),
      reason: z.string(),
    }),
  ),
  ruleTrace: z.array(z.string()),
  manualReviewRequired: z.boolean(),
});

export const reportWorkflowContextSchema = z.object({
  reportId: z.string().uuid(),
  status: z.enum(["active", "cancelled", "completed"]).default("active"),
  disclosure: parsedDisclosureSchema,
  /** 用户提供的正式权利要求；未提供时仅能生成待复核的技术方案比对。 */
  targetClaimsText: z.string().trim().max(80_000).optional(),
  strategy: searchStrategySchema.optional(),
  generatedFormula: z.string().optional(),
  retrievalPlan: retrievalPlanSchema.optional(),
  retrievalRounds: z.array(retrievalRoundSchema).max(8).optional(),
  searchResult: reportPatentSearchResultSchema.optional(),
  candidateScreening: z.array(candidateScreeningSchema).max(50).optional(),
  selectedPatentIds: z.array(z.string()).max(20).optional(),
  classifications: z.array(classifiedReportPatentSchema).optional(),
  evaluationInput: proposalEvaluationInputSchema.optional(),
  evaluation: proposalEvaluationResultSchema.optional(),
  conclusion: z.string().max(20_000).optional(),
  returnTo: z
    .enum([
      "strategy",
      "document-selection",
      "classification-review",
      "evaluation-input",
    ])
    .optional(),
});

export type ReportWorkflowContext = z.infer<typeof reportWorkflowContextSchema>;

export const reportApprovalSchema = z.object({
  decision: z.enum(["approve", "cancel"]),
  data: z.unknown().optional(),
});

export const reportSuspendPayloadSchema = z.object({
  reportId: z.string().uuid(),
  kind: z.enum([
    "strategy",
    "document-selection",
    "classification-review",
    "evaluation-input",
    "final-report",
  ]),
  title: z.string(),
  data: z.unknown(),
});

export type ReportSuspendPayload = z.infer<typeof reportSuspendPayloadSchema>;
