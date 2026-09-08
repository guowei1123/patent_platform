import { Memory } from "@mastra/memory";
import { mastraStore } from "./storage";

export const patentMemory = new Memory({
  storage: mastraStore,
  options: {
    lastMessages: 20,
  },
});
