export const callStreamAPI = async (
  url: string,
  body: any,
  onProgress?: (chunk: string) => void,
) => {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => null);
    throw new Error(
      typeof error?.error === "string" ? error.error : "API调用失败",
    );
  }

  const reader = response.body?.getReader();
  const decoder = new TextDecoder();
  let result = "";

  if (reader) {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value, { stream: true });
      result += chunk;
      onProgress?.(chunk);
    }
  }

  return result;
};

export const fileToBase64 = (file: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = (error) => reject(error);
  });
};

export const detectImage = async (imageBase64: string) => {
  try {
    const response = await fetch("/api/disclosure/image-detection", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ imageUrl: imageBase64 }),
    });

    if (!response.ok) {
      throw new Error("图片检测失败");
    }

    return await response.json();
  } catch (error) {
    console.error("图片检测失败:", error);
    throw error;
  }
};
