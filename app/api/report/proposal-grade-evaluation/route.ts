import { z } from "zod";

import {
  evaluateProposal,
  proposalEvaluationInputSchema,
} from "@/lib/service/proposal-grade-evaluation";

export async function POST(request: Request) {
  try {
    const input = proposalEvaluationInputSchema.parse(await request.json());
    return Response.json(evaluateProposal(input));
  } catch (error) {
    if (error instanceof z.ZodError || error instanceof SyntaxError) {
      return Response.json({ error: "规则判定参数不正确" }, { status: 400 });
    }
    console.error("Proposal grade evaluation failed", error);
    return Response.json(
      { error: "规则判定失败，请稍后重试" },
      { status: 500 },
    );
  }
}