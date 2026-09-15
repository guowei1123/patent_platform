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
import { disclosureAgent } from "./agents/disclosure-agent";
import { disclosureWorkflow } from "./workflows/disclosure-workflow";
import { checkDisclosureTool } from "./tools/disclosure-tools";

export const mastra = new Mastra({
  storage: mastraStore,
  agents: {
    supervisorAgent,
    qaAgent,
    searchAgent,
    reportAgent,
    disclosureAgent,
  },
  workflows: { reportWorkflow, disclosureWorkflow },
  tools: {
    recommendKeywordsTool,
    recommendIpcTool,
    generateSearchFormulaTool,
    searchPatentsTool,
    ...reportTools,
    checkDisclosureTool,
  },
});
