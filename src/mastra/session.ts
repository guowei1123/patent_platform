import { randomUUID } from "node:crypto";

const RESOURCE_COOKIE_NAME = "patent_agent_resource";
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function readCookie(request: Request, name: string) {
  const cookieHeader = request.headers.get("cookie");
  if (!cookieHeader) return undefined;

  for (const entry of cookieHeader.split(";")) {
    const separatorIndex = entry.indexOf("=");
    if (separatorIndex === -1) continue;

    const key = entry.slice(0, separatorIndex).trim();
    if (key === name) {
      return decodeURIComponent(entry.slice(separatorIndex + 1).trim());
    }
  }

  return undefined;
}

export function resolveAgentResource(request: Request) {
  const existingResourceId = readCookie(request, RESOURCE_COOKIE_NAME);
  if (existingResourceId && UUID_PATTERN.test(existingResourceId)) {
    return { resourceId: existingResourceId };
  }

  const resourceId = randomUUID();
  const forwardedProtocol = request.headers.get("x-forwarded-proto");
  const isSecure =
    forwardedProtocol === "https" || new URL(request.url).protocol === "https:";
  const secureAttribute = isSecure ? "; Secure" : "";

  return {
    resourceId,
    setCookie: `${RESOURCE_COOKIE_NAME}=${encodeURIComponent(resourceId)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=31536000${secureAttribute}`,
  };
}
