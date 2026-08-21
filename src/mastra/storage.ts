import { PostgresStore } from "@mastra/pg";

const postgresPort = Number.parseInt(process.env.POSTGRES_PORT || "5432", 10);
const configuredSchema =
  process.env.MASTRA_POSTGRES_SCHEMA || process.env.POSTGRES_SCHEMA || "public";
const postgresSchema = /^[A-Za-z_][A-Za-z0-9_]{0,62}$/.test(configuredSchema)
  ? configuredSchema
  : "public";

export const mastraStorage = new PostgresStore({
  id: "patent-platform-mastra-storage",
  host: process.env.POSTGRES_HOST || "localhost",
  port: Number.isNaN(postgresPort) ? 5432 : postgresPort,
  user: process.env.POSTGRES_USER || "postgres",
  password: process.env.POSTGRES_PASSWORD || "password",
  database: process.env.POSTGRES_DB || "vectordb",
  schemaName: postgresSchema,
  ssl:
    process.env.POSTGRES_SSL === "true"
      ? { rejectUnauthorized: false }
      : false,
  max: 10,
  idleTimeoutMillis: 30_000,
});
