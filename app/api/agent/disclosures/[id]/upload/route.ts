import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  extractDisclosureMaterial,
  extractDocxImages,
} from "@/src/mastra/disclosure/material-parser";
import { detectImageProperties } from "@/app/api/disclosure/image-detection/service";
import { getAnonymousResourceId } from "@/src/mastra/anonymous-session";
import {
  getDisclosureTask,
  putDisclosureAsset,
} from "@/src/mastra/disclosure/task-service";
import { executeDisclosure } from "@/src/mastra/disclosure/runtime";
import { commandSchema } from "@/src/mastra/disclosure/contracts";
import { imageSize } from "@/src/mastra/disclosure/images";
import { disclosureError, uuid } from "@/src/mastra/disclosure/http";
export const runtime = "nodejs";
export const maxDuration = 180;
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const id = uuid.parse((await context.params).id),
      resourceId = await getAnonymousResourceId();
    const task = await getDisclosureTask(resourceId, id);
    if (!task) return Response.json({ error: "任务不存在" }, { status: 404 });
    const form = await request.formData(),
      file = form.get("file");
    if (!(file instanceof File) || file.size > 10 * 1024 * 1024 || !file.size)
      return Response.json(
        { error: "请上传不超过 10 MB 的 DOCX、PDF、PNG 或 JPEG 文件" },
        { status: 400 },
      );
    const baseVersion = z.coerce
      .number()
      .int()
      .nonnegative()
      .parse(form.get("baseVersion"));
    const operationId = uuid.parse(form.get("operationId"));
    if (task.lastOperationId === operationId) return Response.json({ task });
    if (task.version !== baseVersion || task.status === "running")
      return Response.json(
        { error: "任务版本已变化或正在处理，请刷新" },
        { status: 409 },
      );
    const buffer = Buffer.from(await file.arrayBuffer());
    if (/\.(docx|pdf)$/i.test(file.name)) {
      const text = await extractDisclosureMaterial({ fileName: file.name, buffer });
      if (!text.trim() || text.length > 120000)
        return Response.json(
          {
            error:
              "文档为空或超过 12 万字，请拆分材料。文档内附图请单独上传。",
          },
          { status: 422 },
        );
      const embeddedImages = /\.docx$/i.test(file.name)
        ? extractDocxImages(buffer).slice(0, 10)
        : [];
      if (task.state.images.length + embeddedImages.length > 10)
        return Response.json(
          { error: "文档内附图与已有图片合计不能超过 10 张" },
          { status: 400 },
        );
      const importedImages = await Promise.all(
        embeddedImages.map(async (item) => {
          const assetId = randomUUID();
          await putDisclosureAsset(resourceId, id, assetId, item.mime, item.data);
          return {
            id: assetId,
            name: item.name,
            caption: "",
            detection: "pending" as const,
            reason: "由 DOCX 内嵌附图导入，尚未完成图片格式检查",
          };
        }),
      );
      return Response.json({
        task: await executeDisclosure(
          resourceId,
          id,
          commandSchema.parse({
            operationId,
            baseVersion,
            action: "message",
            source: { id: operationId, label: file.name.slice(0, 200), text },
            message: `已导入材料：${file.name.slice(0, 200)}${importedImages.length ? `，同时提取 ${importedImages.length} 张内嵌附图，请补充图注并执行图文检查` : ""}`,
            images: importedImages,
          }),
        ),
      });
    }
    if (task.state.images.length >= 10)
      return Response.json(
        { error: "每份交底书最多 10 张图片" },
        { status: 400 },
      );
    let dimensions;
    try {
      dimensions = imageSize(buffer);
    } catch (error) {
      return Response.json(
        { error: (error as Error).message },
        { status: 400 },
      );
    }
    const assetId = randomUUID();
    let detection: "passed" | "warning" | "failed" = "failed",
      reason = "图片检测失败，未完成格式检查";
    try {
      const result = z
        .object({
          isWhiteBackground: z.boolean(),
          isBlackLines: z.boolean(),
          reason: z.string(),
        })
        .parse(
          await detectImageProperties({
            imageUrl: `data:${dimensions.mime};base64,${buffer.toString("base64")}`,
          }),
        );
      detection =
        result.isWhiteBackground && result.isBlackLines ? "passed" : "warning";
      reason = result.reason;
    } catch {
      /* 检测不可用时保留图片，明确未检查。 */
    }
    await putDisclosureAsset(resourceId, id, assetId, dimensions.mime, buffer);
    return Response.json({
      task: await executeDisclosure(
        resourceId,
        id,
        commandSchema.parse({
          operationId,
          baseVersion,
          action: "image",
          image: {
            id: assetId,
            name: file.name.slice(0, 200),
            caption: String(form.get("caption") || "").slice(0, 1000),
            detection,
            reason: reason.slice(0, 2000),
          },
        }),
      ),
    });
  } catch (error) {
    return disclosureError(error);
  }
}
