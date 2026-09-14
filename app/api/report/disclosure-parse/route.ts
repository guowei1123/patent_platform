import { DisclosureParseInputError, parseDisclosureFile } from "./service";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const file = formData.get("file");
    if (!(file instanceof File)) {
      return Response.json({ error: "请上传专利交底书文件" }, { status: 400 });
    }

    const result = await parseDisclosureFile({
      fileName: file.name,
      buffer: Buffer.from(await file.arrayBuffer()),
    });
    return Response.json(result);
  } catch (error) {
    if (error instanceof DisclosureParseInputError) {
      return Response.json({ error: error.message }, { status: error.status });
    }
    console.error("Disclosure parse failed", error);
    return Response.json(
      { error: "交底书解析失败，请检查文件内容或稍后重试" },
      { status: 500 },
    );
  }
}
