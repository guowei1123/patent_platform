import { OpenAIEmbeddings } from "@langchain/openai";

export interface IPCEmbeddingConfig {
  provider: "ollama" | "openai-compatible";
  model: string;
}

export function getIPCEmbeddingConfig(): IPCEmbeddingConfig {
  const provider = (
    process.env.IPC_EMBEDDING_PROVIDER || "ollama"
  ).toLowerCase();
  if (provider === "ollama") {
    return {
      provider: "ollama",
      model: process.env.OLLAMA_EMBEDDING_MODEL || "embeddinggemma:latest",
    };
  }
  if (provider === "openai-compatible") {
    return {
      provider: "openai-compatible",
      model: process.env.OPENAI_EMBEDDING_MODEL || "",
    };
  }
  throw new Error(`Unsupported IPC embedding provider: ${provider}`);
}

async function embedWithOllama(texts: string[]) {
  const config = getIPCEmbeddingConfig();
  const baseURL = (
    process.env.OLLAMA_BASE_URL || "http://127.0.0.1:11434"
  ).replace(/\/$/, "");
  const response = await fetch(`${baseURL}/api/embed`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: config.model, input: texts }),
    signal: AbortSignal.timeout(120_000),
  });
  if (!response.ok) {
    throw new Error(`Ollama embedding request failed: ${response.status}`);
  }
  const data = (await response.json()) as { embeddings?: number[][] };
  if (!data.embeddings || data.embeddings.length !== texts.length) {
    throw new Error("Ollama embedding response count does not match request");
  }
  return data.embeddings;
}

async function embedWithOpenAICompatible(texts: string[]) {
  const embeddings = new OpenAIEmbeddings({
    modelName: process.env.OPENAI_EMBEDDING_MODEL,
    openAIApiKey:
      process.env.OPENAI_EMBEDDING_API_KEY || process.env.OPENAI_API_KEY,
    configuration: {
      baseURL:
        process.env.OPENAI_EMBEDDING_BASE_URL || process.env.OPENAI_BASE_URL,
    },
  });
  return embeddings.embedDocuments(texts);
}

export async function embedIPCDocuments(texts: string[]) {
  if (texts.length === 0) return [];
  return getIPCEmbeddingConfig().provider === "ollama"
    ? embedWithOllama(texts)
    : embedWithOpenAICompatible(texts);
}

export async function embedIPCQuery(text: string) {
  const [vector] = await embedIPCDocuments([text]);
  return vector;
}
