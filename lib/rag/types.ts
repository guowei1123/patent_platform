export interface RagSource {
  id: string;
  number: number;
  knowledgeBaseId: string;
  knowledgeId: string;
  title: string;
  content: string;
  score: number;
}

export interface RagResult {
  status: "disabled" | "ready" | "empty";
  query: string;
  sources: RagSource[];
  context: string;
}

export type RagHistory = Array<{ role: "user" | "assistant"; content: string }>;
