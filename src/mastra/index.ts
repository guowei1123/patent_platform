import { Mastra } from "@mastra/core/mastra";
import { qaAgent } from "./agents/qa-agent";
import { searchAgent } from "./agents/search-agent";
import { supervisorAgent } from "./agents/supervisor";
import { mastraStore } from "./storage";
import {
  generateSearchFormulaTool,
  recommendIpcTool,
  recommendKeywordsTool,
  searchPatentsTool,
} from "./tools/search-tools";

export const mastra = new Mastra({
  storage: mastraStore,
  agents: { supervisorAgent, qaAgent, searchAgent },
  tools: {
    recommendKeywordsTool,
    recommendIpcTool,
    generateSearchFormulaTool,
    searchPatentsTool,
  },
});
