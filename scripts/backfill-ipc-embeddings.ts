import { createClient } from "redis";

import {
  embedIPCDocuments,
  getIPCEmbeddingConfig,
} from "../lib/service/ipc-embeddings.ts";

const IPC_HASH_KEY = "classifications:ipc";
const IPC_VECTOR_HASH_KEY =
  process.env.IPC_VECTOR_REDIS_KEY ||
  "classifications:ipc:vectors:embeddinggemma";
const IPC_VECTOR_META_KEY = `${IPC_VECTOR_HASH_KEY}:meta`;

interface SourceRecord {
  code_norm: string;
  code: string;
  title_zh?: string | null;
  title_en?: string | null;
}

function readNumberArgument(name: string, fallback: number) {
  const prefix = `--${name}=`;
  const value = process.argv.find((argument) => argument.startsWith(prefix));
  const parsed = Number.parseInt(value?.slice(prefix.length) || "", 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function normalizeVector(vector: number[]) {
  let magnitudeSquared = 0;
  for (const value of vector) magnitudeSquared += value * value;
  const magnitude = Math.sqrt(magnitudeSquared) || 1;
  return Float32Array.from(vector, (value) => value / magnitude);
}

function encodeVector(vector: number[]) {
  const normalized = normalizeVector(vector);
  return Buffer.from(
    normalized.buffer,
    normalized.byteOffset,
    normalized.byteLength,
  ).toString("base64");
}

async function withRetry<T>(operation: () => Promise<T>, attempts = 4) {
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (attempt < attempts) {
        await new Promise((resolve) =>
          setTimeout(resolve, Math.min(1_000 * 2 ** (attempt - 1), 8_000)),
        );
      }
    }
  }
  throw lastError;
}

const batchSize = readNumberArgument("batch-size", 10);
const concurrency = readNumberArgument("concurrency", 3);
const limit = readNumberArgument("limit", Number.MAX_SAFE_INTEGER);
const force = process.argv.includes("--force");

const redis = createClient({
  url: process.env.REDIS_URL || "redis://127.0.0.1:6379/0",
  RESP: 2,
  socket: { connectTimeout: 5_000, reconnectStrategy: false },
});
redis.on("error", (error) => console.error("Redis error", error));

async function main() {
  await redis.connect();
  try {
    const existingCodes = force
      ? new Set<string>()
      : new Set(await redis.hKeys(IPC_VECTOR_HASH_KEY));
    const pending: SourceRecord[] = [];
    let cursor = "0";
    do {
      const page = await redis.hScan(IPC_HASH_KEY, cursor, { COUNT: 1_000 });
      cursor = page.cursor;
      for (const entry of page.entries) {
        if (!force && existingCodes.has(entry.field)) continue;
        try {
          const record = JSON.parse(entry.value) as SourceRecord;
          if (record.code_norm && record.code) pending.push(record);
        } catch {
          // Ignore malformed classification records and continue the resumable job.
        }
        if (pending.length >= limit) break;
      }
    } while (cursor !== "0" && pending.length < limit);

    const batches: SourceRecord[][] = [];
    for (let index = 0; index < pending.length; index += batchSize) {
      batches.push(pending.slice(index, index + batchSize));
    }

    let nextBatch = 0;
    let completed = 0;
    let dimensions = 0;
    const startedAt = Date.now();

    async function worker() {
      while (true) {
        const batchIndex = nextBatch++;
        if (batchIndex >= batches.length) return;
        const batch = batches[batchIndex];
        const texts = batch.map(
          (record) =>
            `${record.code} ${record.title_zh || ""} ${record.title_en || ""}`,
        );
        const vectors = await withRetry(() => embedIPCDocuments(texts));
        if (vectors.length !== batch.length) {
          throw new Error(
            "Embedding response count does not match request count",
          );
        }
        dimensions ||= vectors[0]?.length || 0;
        const values: Record<string, string> = {};
        for (let index = 0; index < batch.length; index++) {
          if (vectors[index].length !== dimensions) {
            throw new Error("Embedding dimensions changed during backfill");
          }
          values[batch[index].code_norm] = encodeVector(vectors[index]);
        }
        await redis.hSet(IPC_VECTOR_HASH_KEY, values);
        completed += batch.length;
        if (completed % 100 === 0 || completed === pending.length) {
          const elapsedSeconds = Math.max((Date.now() - startedAt) / 1_000, 1);
          console.log(
            JSON.stringify({
              completed,
              pending: pending.length,
              vectorsPerSecond: Number((completed / elapsedSeconds).toFixed(2)),
            }),
          );
        }
      }
    }

    await Promise.all(
      Array.from({ length: Math.min(concurrency, batches.length) }, () =>
        worker(),
      ),
    );
    const vectorCount = await redis.hLen(IPC_VECTOR_HASH_KEY);
    await redis.hSet(IPC_VECTOR_META_KEY, {
      model: getIPCEmbeddingConfig().model,
      provider: getIPCEmbeddingConfig().provider,
      dimensions: String(dimensions),
      vectorCount: String(vectorCount),
      updatedAt: new Date().toISOString(),
    });
    console.log(
      JSON.stringify({
        success: true,
        generated: completed,
        vectorCount,
        dimensions,
      }),
    );
  } finally {
    redis.destroy();
  }
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
