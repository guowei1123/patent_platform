"use server";

import { OpenAIEmbeddings } from "@langchain/openai";
import { CallbackHandler } from "@langfuse/langchain";
import { RunnableLambda } from "@langchain/core/runnables";

const langfuseHandler = new CallbackHandler();

/**
 * 创建 OpenAI Compatible Embedding 模型实例
 * 支持与 Chat 模型独立的 API Key 和 Base URL 配置
 * 优先使用 OPENAI_EMBEDDING_API_KEY / OPENAI_EMBEDDING_BASE_URL,
 * 未配置时回退到 OPENAI_API_KEY / OPENAI_BASE_URL 以保持向后兼容
 */
const embeddings = new OpenAIEmbeddings({
  modelName: process.env.OPENAI_EMBEDDING_MODEL,
  openAIApiKey:
    process.env.OPENAI_EMBEDDING_API_KEY || process.env.OPENAI_API_KEY,
  configuration: {
    baseURL:
      process.env.OPENAI_EMBEDDING_BASE_URL || process.env.OPENAI_BASE_URL,
  },
});

/**
 * 获取文本的 Embedding 向量
 * @param text 输入文本
 * @returns Promise<number[]> Embedding 向量
 */
export async function getEmbedding(text: string): Promise<number[]> {
  try {
    return await RunnableLambda.from((t: string) =>
      embeddings.embedQuery(t),
    ).invoke(text, { callbacks: [langfuseHandler] });
  } catch (error) {
    console.error("Embedding generation failed:", error);
    throw new Error("Failed to generate embedding");
  }
}

/**
 * 批量获取文本的 Embedding 向量
 * @param texts 输入文本数组
 * @returns Promise<number[][]> Embedding 向量数组
 */
export async function getEmbeddings(texts: string[]): Promise<number[][]> {
  try {
    return await RunnableLambda.from((t: string[]) =>
      embeddings.embedDocuments(t),
    ).invoke(texts, { callbacks: [langfuseHandler] });
  } catch (error) {
    console.error("Batch embedding generation failed:", error);
    throw new Error("Failed to generate embeddings");
  }
}

export async function getImageEmbedding(image: string): Promise<number[]> {
  try {
    // 图像 Embedding 同属 Embedding 服务,优先使用独立的 Embedding API Key
    const apiKey =
      process.env.OPENAI_EMBEDDING_API_KEY || process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error(
        "Missing API Key (OPENAI_EMBEDDING_API_KEY or OPENAI_API_KEY)",
      );
    }

    const model = process.env.OPENAI_IMAGE_EMBEDDING_MODEL || "";

    // Construct the API endpoint
    let endpoint = process.env.OPENAI_IMAGE_EMBEDDING_BASE_URL || "";

    // If we want to reuse OPENAI_BASE_URL but no specific image embedding url is provided:
    // We assume the user configures OPENAI_IMAGE_EMBEDDING_BASE_URL if they need a custom path.
    // Otherwise we stick to the default DashScope endpoint or the one explicitly provided in env.

    // Validate image format based on DashScope requirements:
    // 1. Public URL
    // 2. Base64 Data URI: data:image/{format};base64,{data}
    if (!image.startsWith("http") && !image.startsWith("data:image/")) {
      console.warn(
        "Image input does not appear to be a URL or Data URI. DashScope requires 'data:image/{format};base64,{data}' for Base64 inputs.",
      );
    }

    const payload = {
      model: model,
      input: {
        // DashScope Multimodal Embedding Input Format:
        // contents: array of objects or strings.
        // For image: { "image": "url_or_data_uri" }
        // For fused embedding (text+image), put them in the same object: { "text": "...", "image": "..." }
        // For independent embeddings, put them in separate objects: [ { "text": "..." }, { "image": "..." } ]
        // Here we only generate embedding for a single image.
        contents: [{ image: image }],
      },
      parameters: {
        dimension: 1024,
      },
    };

    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("DashScope API Error:", response.status, errorText);
      throw new Error(
        `DashScope API request failed: ${response.status} ${errorText}`,
      );
    }

    const data = await response.json();

    if (
      data.output &&
      data.output.embeddings &&
      data.output.embeddings.length > 0
    ) {
      return data.output.embeddings[0].embedding;
    } else {
      console.error("Unexpected DashScope response format:", data);
      throw new Error("Invalid response format from DashScope");
    }
  } catch (error) {
    console.error("Image embedding generation failed:", error);
    throw new Error("Failed to generate image embedding");
  }
}
