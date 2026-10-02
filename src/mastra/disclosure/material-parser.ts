import AdmZip from "adm-zip";
import { PDFParse } from "pdf-parse";
import { extractDisclosureText } from "@/app/api/report/disclosure-parse/service";
import { imageSize } from "./images";

const MAX_MATERIAL_TEXT = 120000;

export type PdfPageImage = {
  name: string;
  mime: "image/png" | "image/jpeg";
  data: Buffer;
};

export type PatentPdfMaterial = {
  text: string;
  visualInputs: PdfPageImage[];
  scanned: boolean;
};

function isPdf(buffer: Buffer) {
  return buffer.subarray(0, 5).toString("ascii") === "%PDF-";
}

export async function extractPdfDisclosureText(buffer: Buffer) {
  if (!isPdf(buffer)) throw new Error("上传文件不是有效的 PDF");
  try {
    const parser = new PDFParse({ data: buffer });
    let text = "";
    try {
      text = (await parser.getText()).text.trim();
    } finally {
      await parser.destroy();
    }
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

/**
 * 提取供专利分析使用的 PDF 正文和视觉资料。
 * 有文字层的 PDF 优先取内嵌图像；扫描型 PDF 使用页面图像，由视觉模型区分文字区和技术附图。
 */
export async function extractPdfPatentMaterial(
  buffer: Buffer,
  maxPages: number,
): Promise<PatentPdfMaterial> {
  if (!isPdf(buffer)) throw new Error("上传文件不是有效的 PDF");

  const parser = new PDFParse({ data: buffer });
  try {
    const failures: string[] = [];
    const capture = async <T>(stage: string, action: () => Promise<T>) => {
      try {
        return await action();
      } catch (error) {
        console.error(`PDF ${stage}提取失败`, error);
        failures.push(stage);
        return null;
      }
    };
    const textResult = await capture("文字层", () => parser.getText());
    const text = textResult?.text.trim() || "";
    const embedded = await capture("内嵌图像", () =>
      parser.getImage({
        first: maxPages,
        imageThreshold: 100,
        imageDataUrl: true,
        imageBuffer: true,
      }),
    );
    const embeddedImages = (embedded?.pages || []).flatMap((page) =>
      page.images.flatMap((image, index) => {
        const data = Buffer.from(image.data);
        try {
          const { mime } = imageSize(data);
          return [
            {
              name: `PDF内嵌图像：第${page.pageNumber}页-${index + 1}`,
              mime: mime === "image/png" ? "image/png" : "image/jpeg",
              data,
            } as PdfPageImage,
          ];
        } catch {
          const match = image.dataUrl.match(
            /^data:(image\/(?:png|jpeg));base64,(.+)$/i,
          );
          if (!match) return [];
          return [
            {
              name: `PDF内嵌图像：第${page.pageNumber}页-${index + 1}`,
              mime: match[1].toLowerCase() === "image/png" ? "image/png" : "image/jpeg",
              data: Buffer.from(match[2], "base64"),
            } as PdfPageImage,
          ];
        }
      }),
    );
    const screenshots = await capture("页面图像", () =>
      parser.getScreenshot({
        first: maxPages,
        desiredWidth: 1600,
        imageDataUrl: false,
        imageBuffer: true,
      }),
    );
    const pageImages = (screenshots?.pages || [])
      .filter((page) => page.data?.length)
      .map((page) => ({
        name: `PDF第${page.pageNumber}页.png`,
        mime: "image/png" as const,
        data: Buffer.from(page.data),
      }));

    const scanned = text.length < 80;
    const visualInputs = (scanned
      ? pageImages.length
        ? pageImages.map((image) => ({
            ...image,
            name: image.name.replace("PDF第", "PDF扫描页：第"),
          }))
        : embeddedImages
      : embeddedImages.length
        ? embeddedImages
        : pageImages
    ).slice(0, maxPages);

    if (!text && !visualInputs.length) {
      const failedStages = failures.length ? `（${failures.join("、")}提取失败）` : "";
      throw new Error(`PDF 未提取到可读文字或页面图像${failedStages}`);
    }
    return { text, visualInputs, scanned };
  } catch (error) {
    throw new Error(
      error instanceof Error && error.message.includes("未提取到")
        ? error.message
        : "无法读取该 PDF；请确认文件未损坏、未加密且已完整下载",
    );
  } finally {
    await parser.destroy();
  }
}

export async function extractDisclosureMaterial(input: {
  fileName: string;
  buffer: Buffer;
}) {
  if (/\.docx$/i.test(input.fileName))
    return extractDisclosureText(input.buffer);
  if (/\.pdf$/i.test(input.fileName))
    return extractPdfDisclosureText(input.buffer);
  throw new Error("只支持 DOCX 或 PDF 文档材料");
}

/** DOCX 的 word/media 目录只接收可安全解析的 PNG/JPEG，其他嵌入对象忽略。 */
export function extractDocxImages(buffer: Buffer) {
  const zip = new AdmZip(buffer);
  return zip
    .getEntries()
    .filter(
      (entry) => /^word\/media\//i.test(entry.entryName) && !entry.isDirectory,
    )
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
