import { Mastra } from "@mastra/core/mastra";
import { qaAgent } from "./agents/qa-agent";
import { searchAgent } from "./agents/search-agent";
import { supervisorAgent } from "./agents/supervisor";
import { reportAgent } from "./agents/report-agent";
import { mastraStore } from "./storage";
import {
  generateSearchFormulaTool,
  recommendIpcTool,
  recommendKeywordsTool,
  searchPatentsTool,
} from "./tools/search-tools";
import { reportTools } from "./tools/report-tools";
import { reportWorkflow } from "./workflows/report-workflow";

export const mastra = new Mastra({
  storage: mastraStore,
  agents: { supervisorAgent, qaAgent, searchAgent, reportAgent },
  workflows: { reportWorkflow },
  tools: {
    recommendKeywordsTool,
    recommendIpcTool,
    generateSearchFormulaTool,
    searchPatentsTool,
    ...reportTools,
  },
});
