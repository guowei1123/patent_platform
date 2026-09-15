import { PDFLoader } from "@langchain/community/document_loaders/fs/pdf";
import AdmZip from "adm-zip";
import { extractDisclosureText } from "@/app/api/report/disclosure-parse/service";
import { imageSize } from "./images";

const MAX_MATERIAL_TEXT = 120000;

function isPdf(buffer: Buffer) {
  return buffer.subarray(0, 5).toString("ascii") === "%PDF-";
}

export async function extractPdfDisclosureText(buffer: Buffer) {
  if (!isPdf(buffer)) throw new Error("上传文件不是有效的 PDF");
  try {
    const loader = new PDFLoader(new Blob([new Uint8Array(buffer)]), {
      splitPages: false,
      parsedItemSeparator: " ",
    });
    const pages = await loader.load();
    const text = pages
      .map((page) => page.pageContent)
      .join("\n")
      .trim();
    if (!text) throw new Error("PDF 未提取到可读文本");
    if (text.length > MAX_MATERIAL_TEXT)
      throw new Error("文档正文超过 12 万字，请拆分材料后再上传");
    return text;
  } catch (error) {
    throw new Error(
      error instanceof Error && error.message.includes("超过")
        ? error.message
        : "无法读取该 PDF 的文字内容；扫描件请先进行 OCR 后再上传",
    );
  }
}

export async function extractDisclosureMaterial(input: {
  fileName: string;
  buffer: Buffer;
}) {
  if (/\.docx$/i.test(input.fileName)) return extractDisclosureText(input.buffer);
  if (/\.pdf$/i.test(input.fileName)) return extractPdfDisclosureText(input.buffer);
  throw new Error("只支持 DOCX 或 PDF 文档材料");
}

/** DOCX 的 word/media 目录只接收可安全解析的 PNG/JPEG，其他嵌入对象忽略。 */
export function extractDocxImages(buffer: Buffer) {
  const zip = new AdmZip(buffer);
  return zip
    .getEntries()
    .filter((entry) => /^word\/media\//i.test(entry.entryName) && !entry.isDirectory)
    .flatMap((entry, index) => {
      try {
        const data = entry.getData();
        const dimensions = imageSize(data);
        const extension = dimensions.mime === "image/png" ? "png" : "jpg";
        return [
          {
            name: `DOCX内嵌附图${index + 1}.${extension}`,
            mime: dimensions.mime,
            data,
          },
        ];
      } catch {
        return [];
      }
    });
}
