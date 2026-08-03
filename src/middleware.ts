/**
 * Fast rejection for unauthenticated `/admin` page loads.
 *
 * **This is not the security boundary.** Middleware runs on the Edge, cannot
 * reach the database, and — critically — a Server Action can execute without
 * passing through a matched route. The boundary is `requireAdmin()` at the top
 * of every privileged action (`lib/rogue-raise/admin/guard.ts`). This exists so
 * a signed-out person gets a sign-in page instead of a console shell that then
 * fails on every button.
 *
 * It therefore only checks for the PRESENCE of a session cookie, never its
 * validity: validating it here would mean either duplicating Better Auth's
 * verification on the Edge or a database round-trip per request, and getting
 * that subtly wrong is worse than the redirect being optimistic.
 */
import { NextResponse, type NextRequest } from "next/server";
import { getSessionCookie } from "better-auth/cookies";

export const config = {
  // The sign-in page itself must stay reachable while signed out.
  matcher: ["/admin/:path*"],
};

export function middleware(request: NextRequest) {
  // Local development, explicitly opted into. Production ignores this — see
  // `isDevOpen()`, which also refuses it when NODE_ENV is production.
  if (
    process.env.NODE_ENV !== "production" &&
    process.env.RR_ADMIN_DEV_OPEN === "true"
  ) {
    return NextResponse.next();
  }

  if (request.nextUrl.pathname.startsWith("/admin/sign-in")) {
    return NextResponse.next();
  }

  if (getSessionCookie(request)) return NextResponse.next();

  const signIn = new URL("/admin/sign-in", request.url);
  // So a bookmarked deep link survives the round trip.
  signIn.searchParams.set("next", request.nextUrl.pathname);
  return NextResponse.redirect(signIn);
}
