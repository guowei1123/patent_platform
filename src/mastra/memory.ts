import { Memory } from "@mastra/memory";

import { mastraStorage } from "./storage";

export const patentMemory = new Memory({
  storage: mastraStorage,
  vector: false,
  options: {
    lastMessages: 30,
    generateTitle: false,
  },
});
