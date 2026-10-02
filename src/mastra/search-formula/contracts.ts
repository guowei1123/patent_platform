import { z } from "zod";
import { parsedDisclosureSchema } from "@/app/api/report/disclosure-parse/service";

export const searchFormulaTemplateSchema = z.enum([
  "ipc-keywords",
  "keywords-only",
]);

export const keywordRelationGroupSchema = z.object({
  keywords: z.array(z.string().trim().min(1).max(200)).min(1).max(15),
  operator: z.enum(["AND", "OR"]),
});

export const searchFormulaStrategySchema = z.object({
  keywords: z.array(z.string().trim().min(1).max(200)).min(1).max(15),
  ipcCodes: z.array(z.string().trim().min(1).max(30)).max(10),
  keywordGroups: z.array(keywordRelationGroupSchema).min(1).max(15),
  rationale: z.string().trim().max(1000),
});

export const searchFormulaWorkflowInputSchema = z.object({
  disclosure: parsedDisclosureSchema,
  template: searchFormulaTemplateSchema,
  keywords: z
    .array(z.string().trim().min(1).max(200))
    .min(1)
    .max(15)
    .optional(),
  ipcCodes: z.array(z.string().trim().min(1).max(30)).max(10).optional(),
});

export const searchFormulaWorkflowOutputSchema =
  searchFormulaWorkflowInputSchema.extend({
    strategy: searchFormulaStrategySchema,
    generatedFormula: z.string().trim().min(1).max(2000),
  });

export type SearchFormulaWorkflowOutput = z.infer<
  typeof searchFormulaWorkflowOutputSchema
>;
