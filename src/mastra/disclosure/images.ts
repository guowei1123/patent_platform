export function imageSize(data: Buffer): {
  mime: string;
  width: number;
  height: number;
} {
  if (
    data.length > 24 &&
    data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  ) {
    return validate("image/png", data.readUInt32BE(16), data.readUInt32BE(20));
  }
  if (data[0] === 255 && data[1] === 216) {
    let offset = 2;
    while (offset + 4 < data.length) {
      if (data[offset] !== 255) break;
      const marker = data[offset + 1];
      const length = data.readUInt16BE(offset + 2);
      if (length < 2 || offset + 2 + length > data.length) break;
      if ([192, 193, 194].includes(marker) && length >= 7)
        return validate(
          "image/jpeg",
          data.readUInt16BE(offset + 7),
          data.readUInt16BE(offset + 5),
        );
      offset += 2 + length;
    }
  }
  throw new Error("只支持有效的 PNG 或 JPEG 图片");
}
function validate(mime: string, width: number, height: number) {
  if (!width || !height || width * height > 40000000)
    throw new Error("图片尺寸无效或超过 4000 万像素");
  return { mime, width, height };
}
