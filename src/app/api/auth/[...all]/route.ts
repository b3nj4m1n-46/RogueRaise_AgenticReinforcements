/**
 * Better Auth's own HTTP surface (sign-in, sign-out, session). Mounted at
 * `/api/auth/*` — the one route in this app outside the movable
 * `app/rogue-raise/*` + `app/admin/*` segments, because Better Auth's client
 * expects it there. When this merges into whiterabbitashland.com, WR's existing
 * handler already occupies this path and this file is deleted.
 */
import { toNextJsHandler } from "better-auth/next-js";

import { getAuth } from "@/lib/rogue-raise/integrations/auth";
import { isDevOpen } from "@/lib/rogue-raise/admin/guard";

function unavailable(): Response {
  return new Response("Authentication is not configured in this environment.", {
    status: 503,
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}

/**
 * Resolved per request rather than at module load: in a dev-open environment
 * Better Auth may be unconfigured entirely, and throwing at import time would
 * take down every route in the app rather than just this one.
 */
async function handle(
  request: Request,
  method: "GET" | "POST",
): Promise<Response> {
  try {
    const handlers = toNextJsHandler(getAuth());
    return await handlers[method](request);
  } catch (err) {
    if (isDevOpen()) return unavailable();
    console.error("[auth] handler failed", err);
    return unavailable();
  }
}

export async function GET(request: Request) {
  return handle(request, "GET");
}

export async function POST(request: Request) {
  return handle(request, "POST");
}
