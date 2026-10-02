import { ChatOpenAI } from "@langchain/openai";
import AdmZip from "adm-zip";
import mammoth from "mammoth";
import { z } from "zod";

export const MAX_DISCLOSURE_FILE_SIZE = 10 * 1024 * 1024;

export const parsedDisclosureSchema = z.object({
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
  sourceTextLength: z.number().int().nonnegative(),
});

export type ParsedDisclosure = z.infer<typeof parsedDisclosureSchema>;

export class DisclosureParseInputError extends Error {
  constructor(
    message: string,
    public readonly status: 400 | 413 | 422,
  ) {
    super(message);
    this.name = "DisclosureParseInputError";
  }
}

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
  if (typeof value === "string" || typeof value === "number")
    return String(value).trim();
  if (Array.isArray(value)) return value.map(toText).filter(Boolean).join("；");
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    for (const key of [
      "text",
      "content",
      "description",
      "point",
      "reason",
      "analysis",
      "feature",
      "name",
      "value",
    ]) {
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

function detectPrimaryLanguage(text: string): "中文" | "英文" {
  const chineseCharacters = (text.match(/[\u3400-\u9fff]/g) || []).length;
  const latinCharacters = (text.match(/[A-Za-z]/g) || []).length;
  return chineseCharacters >= latinCharacters ? "中文" : "英文";
}

function extractContentText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.map(extractContentText).join("");
  if (content && typeof content === "object") {
    const record = content as Record<string, unknown>;
    for (const key of ["text", "content", "output_text", "value"]) {
      const text = extractContentText(record[key]);
      if (text) return text;
    }
  }
  return "";
}

function findJsonObject(text: string): Record<string, unknown> {
  const normalized = text
    .replace(/^\uFEFF/, "")
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .trim()
    .replace(/^\s*```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/, "")
    .trim();

  try {
    return JSON.parse(normalized) as Record<string, unknown>;
  } catch {
    // Some compatible model providers prepend an explanation before the JSON.
  }

  for (let start = normalized.indexOf("{"); start >= 0; ) {
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let index = start; index < normalized.length; index += 1) {
      const character = normalized[index];
      if (inString) {
        if (escaped) escaped = false;
        else if (character === "\\") escaped = true;
        else if (character === '"') inString = false;
        continue;
      }
      if (character === '"') inString = true;
      else if (character === "{") depth += 1;
      else if (character === "}" && --depth === 0) {
        try {
          return JSON.parse(normalized.slice(start, index + 1)) as Record<
            string,
            unknown
          >;
        } catch {
          break;
        }
      }
    }
    start = normalized.indexOf("{", start + 1);
  }
  throw new SyntaxError("模型未返回可解析的 JSON 对象");
}

function unwrapModelResult(parsed: Record<string, unknown>) {
  for (const key of ["data", "result", "output"]) {
    const value = parsed[key];
    if (value && typeof value === "object" && !Array.isArray(value))
      return value as Record<string, unknown>;
  }
  return parsed;
}

function field(record: Record<string, unknown>, ...names: string[]) {
  for (const name of names) {
    if (record[name] !== undefined && record[name] !== null)
      return record[name];
  }
  return undefined;
}

export function parseDisclosureModelResponse(
  content: unknown,
  sourceTextLength: number,
): ParsedDisclosure {
  const text = extractContentText(content);
  const parsed = unwrapModelResult(findJsonObject(text));
  return parsedDisclosureSchema.parse({
    inventionName: toText(
      field(parsed, "inventionName", "invention_name", "发明名称"),
    ),
    technicalField: toText(
      field(parsed, "technicalField", "technical_field", "技术领域"),
    ),
    backgroundTechnology: toText(
      field(
        parsed,
        "backgroundTechnology",
        "background_technology",
        "背景技术",
      ),
    ),
    technicalProblem: toText(
      field(parsed, "technicalProblem", "technical_problem", "技术问题"),
    ),
    technicalSolution: toText(
      field(parsed, "technicalSolution", "technical_solution", "技术方案"),
    ),
    beneficialEffects: toText(
      field(parsed, "beneficialEffects", "beneficial_effects", "有益效果"),
    ),
    keyTechnicalFeatures: toTextList(
      field(
        parsed,
        "keyTechnicalFeatures",
        "key_technical_features",
        "关键技术特征",
      ),
      12,
    ),
    searchKeywords: toTextList(
      field(parsed, "searchKeywords", "search_keywords", "检索关键词"),
      15,
    ),
    ipcSuggestions: toIpcList(
      field(parsed, "ipcSuggestions", "ipc_suggestions", "IPC建议"),
    ),
    sourceTextLength,
  });
}

export async function parseDisclosureText(
  disclosureText: string,
): Promise<ParsedDisclosure> {
  const normalized = disclosureText.replace(/\s+/g, " ").trim();
  if (normalized.length < 80) {
    throw new DisclosureParseInputError(
      "未能从文件中提取足够文本，请确认上传的是可编辑的专利交底书",
      422,
    );
  }

  const sourceLanguage = detectPrimaryLanguage(normalized);
  const keywordLanguage = sourceLanguage;
  const prompt = `你是一名专利检索分析师。请从以下专利交底书中提取客观的技术事实，作为后续专利检索、新颖性和创造性判断的输入。

交底书主语言：${sourceLanguage}。首次检索关键词必须使用${keywordLanguage}，并与交底书主语言保持一致；不要混入其他语言的词。

要求：
1. 仅基于原文，不得编造；原文未说明的字段使用空字符串或空数组。
2. 技术特征要写成可与现有技术逐项比对的最小技术要素。
3. 本步骤不得判断新颖性或创造性，不得输出与现有技术的相同点、区别点、技术启示、授权前景或任何法律结论。
4. searchKeywords 应覆盖核心部件、方法步骤和技术效果，并严格使用指定的关键词语言；IPC 建议必须谨慎，不确定时返回空数组。
5. 只返回合法 JSON，字段必须为：inventionName、technicalField、backgroundTechnology、technicalProblem、technicalSolution、beneficialEffects、keyTechnicalFeatures、searchKeywords、ipcSuggestions；所有非 IPC 数组的每个元素必须为字符串，ipcSuggestions 的元素为 code 和 name。
6. keyTechnicalFeatures 最多 12 项，searchKeywords 最多 15 项，ipcSuggestions 最多 6 项。

交底书原文：
${normalized.slice(0, 50_000)}`;

  const response = await getModel().invoke(prompt);
  return parseDisclosureModelResponse(response.content, normalized.length);
}

function decodeXmlText(text: string) {
  return text
    .replace(/<[^>]+>/g, "")
    .replace(/&#x([0-9a-f]+);/gi, (_, value: string) =>
      String.fromCodePoint(Number.parseInt(value, 16)),
    )
    .replace(/&#(\d+);/g, (_, value: string) =>
      String.fromCodePoint(Number.parseInt(value, 10)),
    )
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function extractTextFromWordXml(xml: string) {
  const parts: string[] = [];
  const tokenPattern =
    /<(?:w:t|w:instrText|a:t)\b[^>]*>([\s\S]*?)<\/(?:w:t|w:instrText|a:t)>|<w:tab\b[^>]*\/>|<w:(?:br|cr)\b[^>]*\/>|<\/w:p>|<\/w:tc>/gi;
  for (const match of xml.matchAll(tokenPattern)) {
    if (match[1] !== undefined) parts.push(decodeXmlText(match[1]));
    else if (/^<w:tab\b|^<\/w:tc>/i.test(match[0])) parts.push("\t");
    else parts.push("\n");
  }
  return parts
    .join("")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function extractDocxTextFallback(buffer: Buffer) {
  const archive = new AdmZip(buffer);
  const entries = archive
    .getEntries()
    .filter((entry) =>
      /^word\/(?:document|footnotes|endnotes|header\d+|footer\d+)\.xml$/i.test(
        entry.entryName,
      ),
    )
    .sort((left, right) => {
      if (left.entryName === "word/document.xml") return -1;
      if (right.entryName === "word/document.xml") return 1;
      return left.entryName.localeCompare(right.entryName);
    });
  if (!entries.some((entry) => entry.entryName === "word/document.xml"))
    throw new Error("DOCX 缺少 word/document.xml");
  return entries
    .map((entry) => extractTextFromWordXml(entry.getData().toString("utf8")))
    .filter(Boolean)
    .join("\n");
}

export async function extractDisclosureText(buffer: Buffer) {
  try {
    const extracted = await mammoth.extractRawText({ buffer });
    if (extracted.value.trim()) return extracted.value;
  } catch {
    // 部分 DOCX 在当前 Node 环境中不受 Mammoth 支持，继续使用 XML 兜底提取。
  }
  try {
    const fallbackText = extractDocxTextFallback(buffer);
    if (fallbackText.trim()) return fallbackText;
  } catch (error) {
    console.error("DOCX XML fallback failed", error);
  }
  throw new DisclosureParseInputError(
    "无法读取该 DOCX 的正文，请使用 Word 或 WPS 重新另存为 DOCX 后再上传",
    422,
  );
}

export async function parseDisclosureFile(input: {
  fileName: string;
  buffer: Buffer;
}): Promise<ParsedDisclosure> {
  const isDocx = input.fileName.toLowerCase().endsWith(".docx");
  const isTxt = input.fileName.toLowerCase().endsWith(".txt");
  if (!isDocx && !isTxt) {
    throw new DisclosureParseInputError(
      "目前支持 DOCX 或 TXT 格式的专利交底书",
      400,
    );
  }
  if (input.buffer.length === 0)
    throw new DisclosureParseInputError("文件不能为空", 400);
  if (input.buffer.length > MAX_DISCLOSURE_FILE_SIZE)
    throw new DisclosureParseInputError("文件不得超过 10MB", 413);

  const text = isDocx
    ? await extractDisclosureText(input.buffer)
    : input.buffer.toString("utf8");
  return parseDisclosureText(text);
}
