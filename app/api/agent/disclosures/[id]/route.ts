import { getAnonymousResourceId } from "@/src/mastra/anonymous-session";
import { getDisclosureTask } from "@/src/mastra/disclosure/task-service";
import { executeDisclosure } from "@/src/mastra/disclosure/runtime";
import { commandSchema } from "@/src/mastra/disclosure/contracts";
import { disclosureError, uuid } from "@/src/mastra/disclosure/http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 180;
type Context = { params: Promise<{ id: string }> };
export async function GET(_request: Request, context: Context) {
  try {
    const task = await getDisclosureTask(
      await getAnonymousResourceId(),
      uuid.parse((await context.params).id),
    );
    return task
      ? Response.json({ task })
      : Response.json({ error: "交底书不存在或已过期" }, { status: 404 });
  } catch (error) {
    return disclosureError(error);
  }
}
export async function POST(request: Request, context: Context) {
  try {
    const command = commandSchema.parse(await request.json());
    // 图片和材料只允许由上传端点创建，不能借此注入他人资产。
    if (command.source || command.image || command.images || command.action === "image")
      return Response.json(
        { error: "请通过上传入口添加材料" },
        { status: 400 },
      );
    return Response.json({
      task: await executeDisclosure(
        await getAnonymousResourceId(),
        uuid.parse((await context.params).id),
        command,
      ),
    });
  } catch (error) {
    return disclosureError(error);
  }
}
