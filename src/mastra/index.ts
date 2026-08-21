import { Mastra } from "@mastra/core/mastra";

import { patentCopilot } from "./agents/patent-copilot";
import { mastraStorage } from "./storage";
import {
  ipcSearchTool,
  keywordRecommendationTool,
  searchFormulaTool,
} from "./tools";
import { disclosureWorkflow } from "./workflows/disclosure";

export const mastra = new Mastra({
  storage: mastraStorage,
  agents: { patentCopilot },
  workflows: { disclosureWorkflow },
  tools: {
    ipcSearchTool,
    keywordRecommendationTool,
    searchFormulaTool,
  },
});
