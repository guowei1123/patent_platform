import { randomUUID } from "node:crypto";
import { cookies } from "next/headers";

const COOKIE_NAME = "patent_anon_id";

export async function getAnonymousResourceId() {
  const cookieStore = await cookies();
  const existing = cookieStore.get(COOKIE_NAME)?.value;
  if (existing && /^[0-9a-f-]{36}$/i.test(existing)) return existing;
  const resourceId = randomUUID();
  cookieStore.set(COOKIE_NAME, resourceId, {
    httpOnly: true,
    sameSite: "lax",
    secure:
      process.env.ANONYMOUS_COOKIE_SECURE === "true" ||
      process.env.NODE_ENV === "production",
    maxAge: 60 * 60 * 24 * 30,
    path: "/",
  });
  return resourceId;
}
