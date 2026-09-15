import { getAnonymousResourceId } from "@/src/mastra/anonymous-session";
import { getDisclosureAsset } from "@/src/mastra/disclosure/task-service";
import { disclosureError, uuid } from "@/src/mastra/disclosure/http";
export const runtime = "nodejs";
export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string; assetId: string }> },
) {
  try {
    const { id, assetId } = await context.params;
    const asset = await getDisclosureAsset(
      await getAnonymousResourceId(),
      uuid.parse(id),
      uuid.parse(assetId),
    );
    return asset
      ? new Response(new Uint8Array(asset.data), {
          headers: {
            "Content-Type": asset.mime,
            "Cache-Control": "private, no-store",
            "X-Content-Type-Options": "nosniff",
          },
        })
      : Response.json({ error: "图片不存在" }, { status: 404 });
  } catch (error) {
    return disclosureError(error);
  }
}
