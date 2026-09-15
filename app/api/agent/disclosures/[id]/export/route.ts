import { z } from "zod";
import { getAnonymousResourceId } from "@/src/mastra/anonymous-session";
import {
  getDisclosureVersion,
  getDisclosureAsset,
} from "@/src/mastra/disclosure/task-service";
import { exportDisclosure } from "@/src/mastra/disclosure/export";
import { disclosureError, uuid } from "@/src/mastra/disclosure/http";
export const runtime = "nodejs";
export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const id = uuid.parse((await context.params).id),
      resourceId = await getAnonymousResourceId();
    const raw = new URL(request.url).searchParams.get("version");
    if (raw === null)
      return Response.json({ error: "请选择导出版本" }, { status: 400 });
    const version = z.coerce.number().int().nonnegative().parse(raw);
    const state = await getDisclosureVersion(resourceId, id, version);
    if (!state) return Response.json({ error: "版本不存在" }, { status: 404 });
    const assets = await Promise.all(
      state.images.map((image) => getDisclosureAsset(resourceId, id, image.id)),
    );
    if (assets.some((asset) => !asset))
      return Response.json(
        { error: "附图缺失，未导出，请重新上传" },
        { status: 422 },
      );
    const buffer = await exportDisclosure(
      state,
      assets as Array<{ mime: string; data: Buffer }>,
      version,
    );
    return new Response(new Uint8Array(buffer), {
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(`专利交底书-v${version}.docx`)}`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    return disclosureError(error);
  }
}
