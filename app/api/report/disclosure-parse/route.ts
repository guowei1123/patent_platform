import mammoth from "mammoth";
import { ChatOpenAI } from "@langchain/openai";
import { z } from "zod";

export const runtime = "nodejs";

const MAX_FILE_SIZE = 10 * 1024 * 1024;

const parsedDisclosureSchema = z.object({
  inventionName: z.string(),
  technicalField: z.string(),
  backgroundTechnology: z.string(),
  technicalProblem: z.string(),
  technicalSolution: z.string(),
  beneficialEffects: z.string(),
  keyTechnicalFeatures: z.array(z.string()).max(12),
  searchKeywords: z.array(z.string()).max(15),
  ipcSuggestions: z
    .array(z.object({ code: z.string(), name: z.string() }))
    .max(6),
});

function getModel() {
  return new ChatOpenAI({
    modelName: process.env.OPENAI_CHAT_MODEL,
    temperature: 0.1,
    openAIApiKey: process.env.OPENAI_API_KEY,
    configuration: { baseURL: process.env.OPENAI_BASE_URL },
    timeout: 120_000,
    maxRetries: 1,
  });
}

function toText(value: unknown): string {
  if (typeof value === "string" || typeof value === "number") {
    return String(value).trim();
  }
  if (Array.isArray(value)) {
    return value.map(toText).filter(Boolean).join("；");
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const preferredKeys = [
      "text",
      "content",
      "description",
      "point",
      "reason",
      "analysis",
      "feature",
      "name",
      "value",
    ];
    for (const key of preferredKeys) {
      const text = toText(record[key]);
      if (text) return text;
    }
    return Object.values(record).map(toText).filter(Boolean).join("；");
  }
  return "";
}

function toTextList(value: unknown, max: number) {
  const source = Array.isArray(value) ? value : value ? [value] : [];
  return [...new Set(source.map(toText).filter(Boolean))].slice(0, max);
}

function toIpcList(value: unknown) {
  const source = Array.isArray(value) ? value : [];
  return source
    .map((item) => {
      const record =
        item && typeof item === "object"
          ? (item as Record<string, unknown>)
          : {};
      return {
        code: toText(record.code || record.ipc || item),
        name: toText(record.name || record.description || record.title),
      };
    })
    .filter((item) => item.code)
    .slice(0, 6);
}

function parseModelJson(content: unknown) {
  const text = Array.isArray(content)
    ? content.map((item) => (typeof item === "string" ? item : "")).join("")
    : String(content);
  const json = text
    .replace(/^\s*```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/, "");
  const parsed = JSON.parse(json) as Record<string, unknown>;
  return parsedDisclosureSchema.parse({
    inventionName: toText(parsed.inventionName),
    technicalField: toText(parsed.technicalField),
    backgroundTechnology: toText(parsed.backgroundTechnology),
    technicalProblem: toText(parsed.technicalProblem),
    technicalSolution: toText(parsed.technicalSolution),
    beneficialEffects: toText(parsed.beneficialEffects),
    keyTechnicalFeatures: toTextList(parsed.keyTechnicalFeatures, 12),
    searchKeywords: toTextList(parsed.searchKeywords, 15),
    ipcSuggestions: toIpcList(parsed.ipcSuggestions),
  });
}

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const file = formData.get("file");

    if (!(file instanceof File)) {
      return Response.json({ error: "请上传专利交底书文件" }, { status: 400 });
    }
    if (!file.name.toLowerCase().endsWith(".docx")) {
      return Response.json(
        { error: "目前仅支持 DOCX 格式的专利交底书" },
        { status: 400 },
      );
    }
    if (file.size === 0 || file.size > MAX_FILE_SIZE) {
      return Response.json(
        { error: "文件不能为空且不得超过 10MB" },
        { status: 400 },
      );
    }

    const result = await mammoth.extractRawText({
      buffer: Buffer.from(await file.arrayBuffer()),
    });
    const disclosureText = result.value.replace(/\s+/g, " ").trim();
    if (disclosureText.length < 80) {
      return Response.json(
        { error: "未能从文件中提取足够文本，请确认上传的是可编辑的专利交底书" },
        { status: 422 },
      );
    }

    const prompt = `你是一名专利检索分析师。请从以下专利交底书中提取客观的技术事实，作为后续专利检索、新颖性和创造性判断的输入。

要求：
1. 仅基于原文，不得编造；原文未说明的字段使用空字符串或空数组。
2. 技术特征要写成可与现有技术逐项比对的最小技术要素。
3. 本步骤不得判断新颖性或创造性，不得输出与现有技术的相同点、区别点、技术启示、授权前景或任何法律结论。
4. 检索关键词应覆盖核心部件、方法步骤、技术效果与同义表述；IPC 建议必须谨慎，不确定时返回空数组。
5. 只返回合法 JSON，字段必须为：inventionName、technicalField、backgroundTechnology、technicalProblem、technicalSolution、beneficialEffects、keyTechnicalFeatures、searchKeywords、ipcSuggestions；所有非 IPC 数组的每个元素必须为字符串，ipcSuggestions 的元素为 code 和 name。
6. keyTechnicalFeatures 最多 12 项，searchKeywords 最多 15 项，ipcSuggestions 最多 6 项。

交底书原文：
${disclosureText.slice(0, 50_000)}`;

    const response = await getModel().invoke(prompt);
    return Response.json({
      ...parseModelJson(response.content),
      sourceTextLength: disclosureText.length,
    });
  } catch (error) {
    console.error("Disclosure parse failed", error);
    return Response.json(
      { error: "交底书解析失败，请检查文件内容或稍后重试" },
      { status: 500 },
    );
  }
}
