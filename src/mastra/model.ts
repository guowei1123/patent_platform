import { createOpenAI } from "@ai-sdk/openai";

const openAICompatible = createOpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  baseURL: process.env.OPENAI_BASE_URL,
  name: "patent-platform-openai-compatible",
});

export const patentModel = openAICompatible.chat(
  process.env.OPENAI_CHAT_MODEL || "gpt-4o-mini",
);
