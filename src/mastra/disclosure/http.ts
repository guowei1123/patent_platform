import { z } from "zod";
import { DisclosureRequestError } from "./runtime";
import { DisclosureParseInputError } from "../../../app/api/report/disclosure-parse/service";

export function disclosureError(error: unknown) {
  if (error instanceof DisclosureRequestError)
    return Response.json({ error: error.message }, { status: error.status });
  if (error instanceof DisclosureParseInputError)
    return Response.json({ error: error.message }, { status: error.status });
  if (error instanceof z.ZodError || error instanceof SyntaxError)
    return Response.json(
      { error: "输入或生成内容格式不正确，请检查后重试" },
      { status: 400 },
    );
  console.error(
    "Disclosure operation failed",
    error instanceof Error ? error.message : "unknown",
  );
  return Response.json(
    { error: "交底书服务暂不可用，原文稿已保留，请重试" },
    { status: 500 },
  );
}
export const uuid = z.string().uuid();
