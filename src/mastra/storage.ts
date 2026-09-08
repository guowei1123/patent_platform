import { PostgresStore } from "@mastra/pg";

function postgresConfig() {
  if (process.env.MASTRA_DATABASE_URL) {
    return {
      id: "patent-agent-store",
      connectionString: process.env.MASTRA_DATABASE_URL,
      schemaName: "mastra_agent",
    };
  }
  return {
    id: "patent-agent-store",
    host: process.env.POSTGRES_HOST || "localhost",
    port: Number(process.env.POSTGRES_PORT || 5432),
    database: process.env.POSTGRES_DB || "vectordb",
    user: process.env.POSTGRES_USER || "postgres",
    password: process.env.POSTGRES_PASSWORD || "password",
    ssl:
      process.env.POSTGRES_SSL === "true"
        ? { rejectUnauthorized: false }
        : false,
    schemaName: "mastra_agent",
  };
}

export const mastraStore = new PostgresStore(postgresConfig());

let initialized: Promise<void> | undefined;

export function ensureMastraStore() {
  if (!initialized) initialized = mastraStore.init();
  return initialized;
}
