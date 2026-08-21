import { createNextRouteHandler } from "@mastra/next";

import { mastra } from "@/src/mastra";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const { GET, POST, PUT, DELETE, PATCH, OPTIONS, HEAD } =
  createNextRouteHandler({ mastra, prefix: "/api" });
