"use server";

import { searchCNIPAIPCs } from "./cnipa-ipc";
import {
  deleteRedisIPC,
  getRedisIPCList,
  getRedisIPCVector,
  saveRedisIPC,
  searchRedisIPCs,
  type ClassificationIPC,
} from "./redis-ipc";

function getStore() {
  return (process.env.CLASSIFICATION_STORE || "redis").toLowerCase();
}

export async function searchClassificationIPCs(
  query: string,
  limit: number = 5,
) {
  const store = getStore();
  if (store === "postgres") return searchCNIPAIPCs(query, limit);
  if (store === "redis") return searchRedisIPCs(query, limit);

  throw new Error(`Unsupported classification store: ${store}`);
}

export async function getClassificationIPCList(
  page: number = 1,
  pageSize: number = 10,
  query?: string,
) {
  if (getStore() === "redis") return getRedisIPCList(page, pageSize, query);
  throw new Error(
    "IPC management currently requires CLASSIFICATION_STORE=redis",
  );
}

export async function saveClassificationIPC(data: ClassificationIPC) {
  if (getStore() === "redis") return saveRedisIPC(data);
  throw new Error(
    "IPC management currently requires CLASSIFICATION_STORE=redis",
  );
}

export async function deleteClassificationIPC(code: string) {
  if (getStore() === "redis") return deleteRedisIPC(code);
  throw new Error(
    "IPC management currently requires CLASSIFICATION_STORE=redis",
  );
}

export async function getClassificationIPCVector(code: string) {
  if (getStore() === "redis") return getRedisIPCVector(code);
  throw new Error(
    "IPC management currently requires CLASSIFICATION_STORE=redis",
  );
}

export type { ClassificationIPC } from "./redis-ipc";
