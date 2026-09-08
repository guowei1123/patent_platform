import { createOpenAI } from "@ai-sdk/openai";

const provider = createOpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  baseURL: process.env.OPENAI_BASE_URL,
  name: "patent-platform-openai-compatible",
});

export const patentAgentModel = provider.chat(
  process.env.OPENAI_CHAT_MODEL || "gpt-4o-mini",
);
