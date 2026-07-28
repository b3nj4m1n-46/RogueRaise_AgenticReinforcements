import Link from "next/link";
import { redirect } from "next/navigation";

import { checkAdmin } from "@/lib/rogue-raise/admin/guard";
import { signOutAdmin } from "@/lib/rogue-raise/admin/sign-in-actions";

/**
 * Server-side gate for every admin page (PRD §9, §12).
 *
 * A layout is the right place for the *page* check: it runs on the server for
 * every route beneath it, and unlike the middleware it can reach the database
 * and read the role. It is still not the whole boundary — Server Actions don't
 * render layouts — which is why each privileged action calls `requireAdmin()`
 * for itself.
 *
 * The console lives in a `(console)` route group so this guard covers every
 * page beneath it WITHOUT covering `/admin/sign-in` — a guarded sign-in page
 * redirects to itself forever. Route groups don't affect URLs, so every admin
 * route still lives under one movable `app/admin/*` directory (CLAUDE.md).
 */
export const dynamic = "force-dynamic";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const check = await checkAdmin();

  if (!check.ok) {
    // The middleware already redirects most of these; this catches the rest
    // (a stale cookie, a revoked account, a non-admin user with a session).
    redirect("/admin/sign-in");
  }

  const isDev = check.admin.userId === "dev";

  return (
    <>
      {/* A landmark, so the sign-out control is reachable by landmark
          navigation rather than only by tabbing from the top. */}
      <header className="border-b border-wr-olive-green/20 bg-muted/40">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 px-6 py-2 text-sm">
          <Link
            href="/admin/events"
            className="font-mono text-xs uppercase tracking-widest text-wr-olive-green underline-offset-4 hover:underline"
          >
            Rogue Raise admin
          </Link>
          <div className="flex flex-wrap items-center gap-4">
            {isDev ? (
              // Loud on purpose: it should be impossible to mistake a dev-open
              // console for a real one.
              <span className="rounded-full border border-destructive px-3 py-0.5 font-mono text-xs uppercase tracking-wide text-destructive">
                Dev-open · no sign-in
              </span>
            ) : (
              <>
                <span className="text-ink/70">{check.admin.email}</span>
                <form action={signOutAdmin}>
                  <button
                    type="submit"
                    className="min-h-11 font-medium text-ink underline underline-offset-4"
                  >
                    Sign out
                  </button>
                </form>
              </>
            )}
          </div>
        </div>
      </header>
      {children}
    </>
  );
}
