import AdmZip from "adm-zip";
import { generateDisclosureDocumentFromTemplate } from "../../../app/api/disclosure/template-export/service";
import { imageSize } from "./images";
import type { DisclosureState } from "./contracts";

const escapeXml = (text: string) =>
  text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
export async function exportDisclosure(
  state: DisclosureState,
  assets: Array<{ data: Buffer; mime: string }>,
  version: number,
) {
  if (assets.length !== state.images.length)
    throw new Error("附图不完整，无法导出");
  const zip = new AdmZip(
    await generateDisclosureDocumentFromTemplate(state.sections),
  );
  let document = zip.readAsText("word/document.xml");
  let rels = zip.readAsText("word/_rels/document.xml.rels");
  let types = zip.readAsText("[Content_Types].xml");
  const paragraphs = [
    `<w:p><w:r><w:t>交底书版本：${version}${state.issues.length || state.questions.length ? "（含待复核事项）" : ""}</w:t></w:r></w:p>`,
  ];
  const existingIds = Array.from(
    document.matchAll(/<wp:docPr[^>]*\bid="(\d+)"/g),
    (m) => Number(m[1]),
  );
  const firstId = Math.max(0, ...existingIds) + 1;
  assets.forEach((asset, index) => {
    const { width, height, mime } = imageSize(asset.data);
    const ext = mime === "image/png" ? "png" : "jpg",
      name = `disclosure-${index + 1}.${ext}`;
    let rid = `rIdDisclosure${index + 1}`;
    while (rels.includes(`Id="${rid}"`)) rid += "x";
    zip.addFile(`word/media/${name}`, asset.data);
    rels = rels.replace(
      "</Relationships>",
      `<Relationship Id="${rid}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/${name}"/></Relationships>`,
    );
    types = types.replace(
      "</Types>",
      `<Override PartName="/word/media/${name}" ContentType="${mime}"/></Types>`,
    );
    const scale = Math.min(5200000 / width, 6500000 / height, 9525),
      cx = Math.round(width * scale),
      cy = Math.round(height * scale);
    paragraphs.push(
      `<w:p><w:r><w:drawing><wp:inline xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="${firstId + index}" name="图${index + 1}"/><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="${firstId + index}" name="${name}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:embed="${rid}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`,
    );
    paragraphs.push(
      `<w:p><w:r><w:t>${escapeXml(`图${index + 1} ${state.images[index].caption || state.images[index].name}`)}</w:t></w:r></w:p>`,
    );
  });
  if (state.questions.length || state.issues.length) {
    paragraphs.push("<w:p><w:r><w:t>待补充与复核事项</w:t></w:r></w:p>");
    [...state.questions, ...state.issues.map((issue) => issue.message)].forEach(
      (text) =>
        paragraphs.push(`<w:p><w:r><w:t>${escapeXml(text)}</w:t></w:r></w:p>`),
    );
  }
  // 正文末尾、节属性之前插入，保持 Word 的节结构有效。
  const marker = document.lastIndexOf("<w:sectPr");
  document =
    marker >= 0
      ? document.slice(0, marker) + paragraphs.join("") + document.slice(marker)
      : document.replace("</w:body>", paragraphs.join("") + "</w:body>");
  zip.addFile("word/document.xml", Buffer.from(document));
  zip.addFile("word/_rels/document.xml.rels", Buffer.from(rels));
  zip.addFile("[Content_Types].xml", Buffer.from(types));
  return zip.toBuffer();
}
