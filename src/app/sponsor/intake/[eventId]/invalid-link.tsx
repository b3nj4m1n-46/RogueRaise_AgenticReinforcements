import Link from "next/link";

import { intakeAccessMessage } from "@/lib/rogue-raise/intake/form-state";

/**
 * Shown when a magic link doesn't open this intake. The copy differs by reason
 * (expired reads differently from wrong-event), but every reason that could be
 * reached WITHOUT a genuine token has already collapsed into `invalid` upstream
 * in `redeemIntakeToken` — so nothing here tells a stranger anything.
 */
export function InvalidLink({ reason }: { reason: string }) {
  return (
    <main className="mx-auto flex min-h-full max-w-2xl flex-col justify-center gap-6 px-6 py-24">
      <p className="eyebrow font-mono text-xs uppercase tracking-widest text-wr-olive-green">
        White Rabbit · Ashland, OR
      </p>
      <h1 className="font-serif text-4xl font-semibold text-ink sm:text-5xl">
        We couldn&rsquo;t open your intake form
      </h1>
      <p className="max-w-prose text-lg text-ink/80">{intakeAccessMessage(reason)}</p>
      <p className="max-w-prose text-ink/70">
        Nothing you&rsquo;ve already filled in is lost &mdash; it&rsquo;s saved
        against your Rogue Raise and will be waiting when you&rsquo;re back in.
      </p>
      <div>
        <Link
          href="/rogue-raise"
          className="inline-flex min-h-11 items-center rounded-md border border-wr-olive-green px-4 py-2 text-sm font-medium text-ink underline-offset-4 hover:underline"
        >
          Back to Rogue Raise
        </Link>
      </div>
    </main>
  );
}
