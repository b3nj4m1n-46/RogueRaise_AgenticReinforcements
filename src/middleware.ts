/**
 * Auth guardrail for the WR staff console. Real admin auth (Better Auth `admin`
 * plugin) is its own story; until it lands, `/admin/*` carries privileged,
 * externally-visible actions with NO identity check. So this middleware hard-
 * refuses every `/admin` request unless `RR_ADMIN_DEV_OPEN === "true"` — which is
 * set ONLY in local `.env`. See HANDOFF.md: this must NOT deploy publicly before
 * the auth story.
 */
import { NextResponse } from "next/server";

export const config = { matcher: "/admin/:path*" };

export function middleware() {
  if (process.env.RR_ADMIN_DEV_OPEN === "true") {
    return NextResponse.next();
  }
  return new NextResponse(
    "The Rogue Raise admin console is disabled in this environment.",
    { status: 403, headers: { "content-type": "text/plain; charset=utf-8" } },
  );
}
