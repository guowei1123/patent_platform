"use server";

import { createClient, type RedisClientType } from "redis";

import { embedIPCQuery, getIPCEmbeddingConfig } from "./ipc-embeddings.ts";

const IPC_HASH_KEY = "classifications:ipc";
const IPC_VECTOR_HASH_KEY =
  process.env.IPC_VECTOR_REDIS_KEY ||
  "classifications:ipc:vectors:embeddinggemma";
const IPC_VECTOR_META_KEY = `${IPC_VECTOR_HASH_KEY}:meta`;
const CACHE_TTL_MS = 5 * 60 * 1000;

export interface ClassificationIPC {
  code: string;
  level: string;
  description_zh: string;
  description_en?: string;
  note?: string;
  created_at?: string;
  updated_at?: string;
  similarity?: string;
}

export interface IPCSearchResult {
  pageContent: string;
  metadata: ClassificationIPC;
}

interface RedisIPCRecord {
  code_norm: string;
  code: string;
  source_code?: string;
  version: string;
  section?: string;
  class_code?: string;
  subclass?: string;
  main_group?: string;
  subgroup?: string;
  level: number | null;
  title_en: string;
  title_zh: string | null;
  title_zh_source?: string;
  source_file?: string;
  created_at?: string;
  updated_at?: string;
}

interface CachedIPCRecord extends RedisIPCRecord {
  searchableText: string;
}

interface VectorIndex {
  dimensions: number;
  codes: string[];
  matrix: Float32Array;
}

let clientPromise: Promise<RedisClientType<{}, {}, {}, 2>> | undefined;
let metadataCache:
  | {
      expiresAt: number;
      records: CachedIPCRecord[];
      byCode: Map<string, CachedIPCRecord>;
    }
  | undefined;
let metadataCachePromise:
  | Promise<{
      records: CachedIPCRecord[];
      byCode: Map<string, CachedIPCRecord>;
    }>
  | undefined;
let vectorCache: { expiresAt: number; index: VectorIndex } | undefined;
let vectorCachePromise: Promise<VectorIndex | undefined> | undefined;

function getRedisClient() {
  if (!clientPromise) {
    const client = createClient({
      url: process.env.REDIS_URL || "redis://127.0.0.1:6379/0",
      RESP: 2,
      socket: {
        connectTimeout: 5_000,
        reconnectStrategy: (retries) =>
          retries >= 3 ? false : Math.min(200 * 2 ** retries, 2_000),
      },
    });
    client.on("error", (error) => {
      console.error("Classification Redis connection error", error);
    });
    clientPromise = client
      .connect()
      .then(() => client)
      .catch((error) => {
        clientPromise = undefined;
        client.destroy();
        throw error;
      });
  }
  return clientPromise;
}

function parseRecord(value: string): RedisIPCRecord | undefined {
  try {
    const record = JSON.parse(value) as Partial<RedisIPCRecord>;
    if (!record.code_norm || !record.code) return undefined;
    return {
      ...record,
      code_norm: record.code_norm,
      code: record.code,
      version: record.version || "",
      level: typeof record.level === "number" ? record.level : null,
      title_en: record.title_en || "",
      title_zh: record.title_zh || null,
    };
  } catch {
    return undefined;
  }
}

function toCachedRecord(record: RedisIPCRecord): CachedIPCRecord {
  return {
    ...record,
    searchableText:
      `${record.code_norm} ${record.code} ${record.title_zh || ""} ${record.title_en}`.toLocaleLowerCase(),
  };
}

function invalidateCaches() {
  metadataCache = undefined;
  vectorCache = undefined;
}

async function loadMetadataCache() {
  if (metadataCache && metadataCache.expiresAt > Date.now())
    return metadataCache;
  if (metadataCachePromise) return metadataCachePromise;
  metadataCachePromise = (async () => {
    const client = await getRedisClient();
    const records: CachedIPCRecord[] = [];
    const byCode = new Map<string, CachedIPCRecord>();
    let cursor = "0";
    do {
      const page = await client.hScan(IPC_HASH_KEY, cursor, { COUNT: 1_000 });
      cursor = page.cursor;
      for (const entry of page.entries) {
        const record = parseRecord(entry.value);
        if (!record) continue;
        const cached = toCachedRecord(record);
        records.push(cached);
        byCode.set(cached.code_norm, cached);
      }
    } while (cursor !== "0");
    records.sort((left, right) =>
      left.code_norm.localeCompare(right.code_norm),
    );
    metadataCache = { expiresAt: Date.now() + CACHE_TTL_MS, records, byCode };
    return { records, byCode };
  })().finally(() => {
    metadataCachePromise = undefined;
  });
  return metadataCachePromise;
}

function normalizeVector(vector: number[]) {
  let magnitudeSquared = 0;
  for (const value of vector) magnitudeSquared += value * value;
  const magnitude = Math.sqrt(magnitudeSquared) || 1;
  return Float32Array.from(vector, (value) => value / magnitude);
}

function encodeVector(vector: Float32Array) {
  return Buffer.from(
    vector.buffer,
    vector.byteOffset,
    vector.byteLength,
  ).toString("base64");
}

function decodeVector(value: string, dimensions: number) {
  const buffer = Buffer.from(value, "base64");
  if (buffer.byteLength !== dimensions * Float32Array.BYTES_PER_ELEMENT) {
    return undefined;
  }
  return new Float32Array(buffer.buffer, buffer.byteOffset, dimensions).slice();
}

async function loadVectorIndex() {
  if (vectorCache && vectorCache.expiresAt > Date.now())
    return vectorCache.index;
  if (vectorCachePromise) return vectorCachePromise;
  vectorCachePromise = (async () => {
    const client = await getRedisClient();
    const [classificationCount, vectorCount, dimensionValue] =
      await Promise.all([
        client.hLen(IPC_HASH_KEY),
        client.hLen(IPC_VECTOR_HASH_KEY),
        client.hGet(IPC_VECTOR_META_KEY, "dimensions"),
      ]);
    if (classificationCount === 0 || vectorCount < classificationCount) {
      return undefined;
    }
    const dimensions = Number.parseInt(dimensionValue || "", 10);
    if (!Number.isInteger(dimensions) || dimensions <= 0) return undefined;

    const codes: string[] = [];
    const matrix = new Float32Array(vectorCount * dimensions);
    let cursor = "0";
    let index = 0;
    do {
      const page = await client.hScan(IPC_VECTOR_HASH_KEY, cursor, {
        COUNT: 250,
      });
      cursor = page.cursor;
      for (const entry of page.entries) {
        const vector = decodeVector(entry.value, dimensions);
        if (!vector) continue;
        codes.push(entry.field);
        matrix.set(vector, index * dimensions);
        index++;
      }
    } while (cursor !== "0");

    const result = {
      dimensions,
      codes,
      matrix:
        index === vectorCount ? matrix : matrix.slice(0, index * dimensions),
    };
    vectorCache = { expiresAt: Date.now() + CACHE_TTL_MS, index: result };
    return result;
  })().finally(() => {
    vectorCachePromise = undefined;
  });
  return vectorCachePromise;
}

function toClassificationIPC(
  record: RedisIPCRecord,
  similarity?: number,
): ClassificationIPC {
  return {
    code: record.code,
    level: record.level === null ? "" : String(record.level),
    description_zh: record.title_zh || record.title_en,
    description_en: record.title_en || undefined,
    note: record.version ? `IPC ${record.version}` : undefined,
    created_at: record.created_at,
    updated_at: record.updated_at,
    similarity:
      typeof similarity === "number"
        ? `${(Math.max(-1, Math.min(1, similarity)) * 100).toFixed(1)}%`
        : undefined,
  };
}

function toSearchResult(
  record: RedisIPCRecord,
  similarity?: number,
): IPCSearchResult {
  const ipc = toClassificationIPC(record, similarity);
  return { pageContent: ipc.description_zh, metadata: ipc };
}

function normalizeCode(value: string) {
  return value.replace(/\s+/g, "").toUpperCase();
}

function looksLikeIPCCode(value: string) {
  return /^[A-HY]\d{2}[A-Z][0-9/]*$/i.test(normalizeCode(value));
}

function lexicalSearch(
  records: CachedIPCRecord[],
  query: string,
  limit: number,
) {
  const queryText = query.toLocaleLowerCase();
  const terms = queryText
    .split(/[\s,，、;；]+/)
    .map((term) => term.trim())
    .filter((term) => term.length >= 2);
  const effectiveTerms = terms.length > 0 ? terms : [queryText];
  const matches: Array<{ record: CachedIPCRecord; score: number }> = [];
  for (const record of records) {
    let score = record.searchableText.includes(queryText) ? 70 : 0;
    for (const term of effectiveTerms) {
      if (record.searchableText.includes(term)) score += 10;
    }
    if (score > 0) matches.push({ record, score });
  }
  return matches
    .sort(
      (left, right) =>
        right.score - left.score ||
        left.record.code_norm.localeCompare(right.record.code_norm),
    )
    .slice(0, limit)
    .map(({ record, score }) => ({ record, similarity: score / 100 }));
}

async function vectorSearch(query: string, limit: number) {
  const [index, metadata] = await Promise.all([
    loadVectorIndex(),
    loadMetadataCache(),
  ]);
  if (!index) return undefined;

  const queryVector = normalizeVector(await embedIPCQuery(query));
  if (queryVector.length !== index.dimensions) return undefined;
  const best: Array<{ code: string; similarity: number }> = [];
  for (let row = 0; row < index.codes.length; row++) {
    let similarity = 0;
    const offset = row * index.dimensions;
    for (let column = 0; column < index.dimensions; column++) {
      similarity += queryVector[column] * index.matrix[offset + column];
    }
    best.push({ code: index.codes[row], similarity });
  }
  best.sort((left, right) => right.similarity - left.similarity);
  return best
    .slice(0, limit)
    .map(({ code, similarity }) => {
      const record = metadata.byCode.get(code);
      return record ? { record, similarity } : undefined;
    })
    .filter((value): value is { record: CachedIPCRecord; similarity: number } =>
      Boolean(value),
    );
}

export async function searchRedisIPCs(
  query: string,
  limit: number = 5,
): Promise<IPCSearchResult[]> {
  const normalizedQuery = query.trim();
  const safeLimit = Math.min(Math.max(Math.trunc(limit), 1), 10);
  if (!normalizedQuery) return [];

  const client = await getRedisClient();
  if (looksLikeIPCCode(normalizedQuery)) {
    const exactValue = await client.hGet(
      IPC_HASH_KEY,
      normalizeCode(normalizedQuery),
    );
    const exactRecord = exactValue ? parseRecord(exactValue) : undefined;
    if (exactRecord) return [toSearchResult(exactRecord, 1)];
  }

  const semanticMatches = await vectorSearch(normalizedQuery, safeLimit);
  if (semanticMatches) {
    return semanticMatches.map(({ record, similarity }) =>
      toSearchResult(record, similarity),
    );
  }
  const metadata = await loadMetadataCache();
  return lexicalSearch(metadata.records, normalizedQuery, safeLimit).map(
    ({ record, similarity }) => toSearchResult(record, similarity),
  );
}

export async function getRedisIPCList(
  page: number = 1,
  pageSize: number = 10,
  query?: string,
) {
  const metadata = await loadMetadataCache();
  const normalizedQuery = query?.trim().toLocaleLowerCase();
  const filtered = normalizedQuery
    ? metadata.records.filter((record) =>
        record.searchableText.includes(normalizedQuery),
      )
    : metadata.records;
  const safePage = Math.max(Math.trunc(page), 1);
  const safePageSize = Math.min(Math.max(Math.trunc(pageSize), 1), 100);
  const offset = (safePage - 1) * safePageSize;
  return {
    data: filtered
      .slice(offset, offset + safePageSize)
      .map((record) => toClassificationIPC(record)),
    total: filtered.length,
  };
}

export async function saveRedisIPC(data: ClassificationIPC) {
  const client = await getRedisClient();
  const codeNorm = normalizeCode(data.code);
  const existingValue = await client.hGet(IPC_HASH_KEY, codeNorm);
  const existing = existingValue ? parseRecord(existingValue) : undefined;
  const now = new Date().toISOString();
  const level = Number.parseInt(data.level, 10);
  const record: RedisIPCRecord = {
    ...existing,
    code_norm: codeNorm,
    code: data.code,
    source_code: existing?.source_code || codeNorm.replace(/\//g, ""),
    version: existing?.version || "custom",
    level: Number.isNaN(level) ? null : level,
    title_zh: data.description_zh,
    title_en: data.description_en || "",
    title_zh_source: existing?.title_zh_source || "patent-platform",
    created_at: existing?.created_at || now,
    updated_at: now,
  };
  const vector = normalizeVector(
    await embedIPCQuery(
      `${record.code} ${record.title_zh || ""} ${record.title_en}`,
    ),
  );
  await Promise.all([
    client.hSet(IPC_HASH_KEY, codeNorm, JSON.stringify(record)),
    client.hSet(IPC_VECTOR_HASH_KEY, codeNorm, encodeVector(vector)),
    client.hSet(IPC_VECTOR_META_KEY, {
      model: getIPCEmbeddingConfig().model,
      dimensions: String(vector.length),
      updatedAt: now,
    }),
  ]);
  invalidateCaches();
  return codeNorm;
}

export async function deleteRedisIPC(code: string) {
  const client = await getRedisClient();
  const codeNorm = normalizeCode(code);
  await Promise.all([
    client.hDel(IPC_HASH_KEY, codeNorm),
    client.hDel(IPC_VECTOR_HASH_KEY, codeNorm),
  ]);
  invalidateCaches();
}

export async function getRedisIPCVector(code: string) {
  const client = await getRedisClient();
  const [value, dimensionValue] = await Promise.all([
    client.hGet(IPC_VECTOR_HASH_KEY, normalizeCode(code)),
    client.hGet(IPC_VECTOR_META_KEY, "dimensions"),
  ]);
  if (!value) return null;
  const dimensions = Number.parseInt(dimensionValue || "", 10);
  const vector = decodeVector(value, dimensions);
  return vector ? Array.from(vector) : null;
}

export async function getRedisIPCVectorStatus() {
  const client = await getRedisClient();
  const [total, vectors, model, dimensions] = await Promise.all([
    client.hLen(IPC_HASH_KEY),
    client.hLen(IPC_VECTOR_HASH_KEY),
    client.hGet(IPC_VECTOR_META_KEY, "model"),
    client.hGet(IPC_VECTOR_META_KEY, "dimensions"),
  ]);
  return {
    total,
    vectors,
    complete: total > 0 && vectors >= total,
    model: model || undefined,
    dimensions: dimensions ? Number.parseInt(dimensions, 10) : undefined,
  };
}
