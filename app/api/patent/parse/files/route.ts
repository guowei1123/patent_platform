import { z } from "zod";
import {
  parsePatentContent,
  patentParseRequestSchema,
  PatentModelResponseError,
  type PatentFigureInput,
  summarizePatentAnalyses,
} from "@/app/api/patent/parse/service";
import {
  extractDisclosureMaterial,
  extractDocxImages,
  extractPdfPatentMaterial,
} from "@/src/mastra/disclosure/material-parser";

const MAX_FILE_SIZE = 100 * 1024 * 1024;
const MAX_DOCUMENTS = 10;
const MAX_FIGURES = 10;

export const runtime = "nodejs";
export const maxDuration = 180;

function isDocument(file: File) {
  return /\.(docx|pdf)$/i.test(file.name);
}

function isFigure(file: File) {
  return /\.(png|jpe?g)$/i.test(file.name);
}

function toFigure(input: {
  name: string;
  mime: "image/png" | "image/jpeg";
  buffer: Buffer;
}): PatentFigureInput {
  return {
    name: input.name,
    mime: input.mime,
    dataUrl: `data:${input.mime};base64,${input.buffer.toString("base64")}`,
  };
}

export async function POST(request: Request) {
  let stage = "读取上传文件";
  try {
    const formData = await request.formData();
    const files = formData
      .getAll("files")
      .filter((value): value is File => value instanceof File);

    const documentFiles = files.filter(isDocument);
    const figureFiles = files.filter(isFigure);
    if (documentFiles.length + figureFiles.length !== files.length)
      return Response.json(
        { error: "仅支持 DOCX、PDF、PNG 或 JPEG 文件" },
        { status: 400 },
      );
    if (!documentFiles.length)
      return Response.json(
        { error: "请至少上传一份 DOCX 或 PDF 专利文献" },
        { status: 400 },
      );
    if (documentFiles.length > MAX_DOCUMENTS)
      return Response.json(
        { error: `一次最多解析 ${MAX_DOCUMENTS} 份专利文献` },
        { status: 400 },
      );
    if (figureFiles.length > MAX_FIGURES)
      return Response.json(
        { error: `一次最多上传 ${MAX_FIGURES} 张补充附图` },
        { status: 400 },
      );

    for (const file of files) {
      if (!file.size)
        return Response.json(
          { error: `${file.name}：文件内容为空或尚未下载到本地，无法解析` },
          { status: 400 },
        );
      if (file.size > MAX_FILE_SIZE)
        return Response.json(
          {
            error: `${file.name}：单个文件不得超过 100MB`,
            detectedSizeBytes: file.size,
            limitBytes: MAX_FILE_SIZE,
          },
          { status: 413 },
        );
    }
    if (documentFiles.length > 1 && figureFiles.length)
      return Response.json(
        {
          error:
            "多份专利文献请使用 DOCX 内嵌附图；补充上传的 PNG/JPEG 附图仅支持与单份文献联合解析",
        },
        { status: 400 },
      );

    const supplementalFigures = await Promise.all(
      figureFiles.map(async (file) => {
        const buffer = Buffer.from(await file.arrayBuffer());
        return toFigure({
          name: file.name,
          mime: /\.png$/i.test(file.name) ? "image/png" : "image/jpeg",
          buffer,
        });
      }),
    );
    const analyses = [];
    for (const file of documentFiles) {
      stage = `解析文献：${file.name}`;
      const buffer = Buffer.from(await file.arrayBuffer());
      const pdfMaterial = /\.pdf$/i.test(file.name)
        ? await extractPdfPatentMaterial(buffer, MAX_FIGURES)
        : null;
      const text = pdfMaterial
        ? pdfMaterial.text
        : await extractDisclosureMaterial({
            fileName: file.name,
            buffer,
          });
      const embeddedFigures = /\.docx$/i.test(file.name)
        ? extractDocxImages(buffer)
            .slice(0, MAX_FIGURES)
            .map((image) =>
              toFigure({
                name: image.name,
                mime: image.mime === "image/png" ? "image/png" : "image/jpeg",
                buffer: image.data,
              }),
            )
        : (pdfMaterial?.visualInputs || []).map((image) =>
            toFigure({
              name: image.name,
              mime: image.mime,
              buffer: image.data,
            }),
          );
      const figures = [...embeddedFigures, ...supplementalFigures].slice(
        0,
        MAX_FIGURES,
      );
      const description =
        text.length >= 80
          ? text
          : `${text}\n\n该 PDF 为扫描型或以附图为主的文档。请先读取页面中的文字区和图号，再识别技术附图；没有图文依据时请明确说明无法判断。`;
      const input = patentParseRequestSchema.parse({
        bibliographicData: `文件名：${file.name}`,
        title: "",
        abstract: "",
        description,
        claims: "",
        drawings: "",
      });
      const { result, meta } = await parsePatentContent(input, figures);
      analyses.push({ fileName: file.name, result, meta });
    }

    stage = "生成多份专利汇总";
    return Response.json({
      success: true,
      data: {
        analyses,
        ...(analyses.length > 1
          ? { summary: await summarizePatentAnalyses(analyses) }
          : {}),
      },
    });
  } catch (error) {
    if (error instanceof z.ZodError)
      return Response.json(
        { error: "文件中可读取的专利正文不足 80 字，请检查文件内容" },
        { status: 422 },
      );
    if (error instanceof PatentModelResponseError)
      return Response.json(
        { error: `${stage}时模型连续两次返回不符合要求的结构，未保存解析结果。请重新解析；若持续失败，请检查模型是否支持严格结构化输出` },
        { status: 502 },
      );
    if (error instanceof Error && error.message.startsWith("PDF "))
      return Response.json({ error: error.message }, { status: 422 });
    if (
      error instanceof Error &&
      (error.message.startsWith("上传文件") || error.message.startsWith("无法读取该 PDF"))
    )
      return Response.json({ error: error.message }, { status: 422 });
    console.error("Patent file parse failed", error);
    return Response.json(
      { error: "专利文件解析失败，请检查文件内容或稍后重试" },
      { status: 500 },
    );
  }
}
