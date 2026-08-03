import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { checkAdmin } from "@/lib/rogue-raise/admin/guard";

import { SignInForm } from "./sign-in-form";

export const metadata: Metadata = {
  title: "Sign in · Rogue Raise",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

function safeNext(raw: string | undefined): string {
  return raw && raw.startsWith("/admin") && !raw.startsWith("//")
    ? raw
    : "/admin/events";
}

export default async function AdminSignInPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string | string[] }>;
}) {
  const { next } = await searchParams;
  const target = safeNext(Array.isArray(next) ? next[0] : next);

  // Already signed in — don't make staff look at a form they don't need.
  const check = await checkAdmin();
  if (check.ok) redirect(target);

  return (
    <main className="mx-auto flex min-h-full max-w-sm flex-col justify-center gap-8 px-6 py-24">
      <header className="flex flex-col gap-3">
        <p className="eyebrow font-mono text-xs uppercase tracking-widest text-wr-olive-green">
          WR Admin
        </p>
        <h1 className="font-serif text-3xl font-semibold text-ink">
          Sign in
        </h1>
        <p className="text-ink/70">
          The Rogue Raise console. Accounts are created by White Rabbit &mdash;
          there&rsquo;s no sign-up here.
        </p>
      </header>

      <SignInForm next={target} />

      {check.reason === "unconfigured" ? (
        <p className="rounded-lg border border-wr-olive-green/40 bg-muted p-3 text-sm text-ink/80">
          Authentication isn&rsquo;t configured in this environment. Set{" "}
          <code className="font-mono text-xs">BETTER_AUTH_SECRET</code> and{" "}
          <code className="font-mono text-xs">BETTER_AUTH_URL</code>, then run{" "}
          <code className="font-mono text-xs">npm run db:auth-migrate</code>.
        </p>
      ) : null}
    </main>
  );
}
