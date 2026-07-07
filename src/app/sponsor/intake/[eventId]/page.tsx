import type { Metadata } from "next";
import Link from "next/link";

/**
 * Intake stub. The approval email links here with a raw magic-link token in the
 * query string; the intake form itself (token validation + the real form) is the
 * NEXT story, so this route must NOT hard-404 in the meantime.
 *
 * `referrer: "no-referrer"` sets `<meta name="referrer" content="no-referrer">`
 * so the token in `?token=…` can never leak to third parties (or our own logs)
 * via the Referer header when the POC clicks an outbound link from this page.
 */
export const metadata: Metadata = {
  title: "Your intake form is almost ready",
  description:
    "Your Rogue Raise is approved — the intake form opens soon and your link will keep working.",
  referrer: "no-referrer",
};

export default function SponsorIntakeStubPage() {
  return (
    <main className="mx-auto flex min-h-full max-w-2xl flex-col justify-center gap-6 px-6 py-24">
      <p className="eyebrow font-mono text-xs uppercase tracking-widest text-wr-olive-green">
        White Rabbit · Ashland, OR
      </p>
      <h1 className="font-serif text-4xl font-semibold text-ink sm:text-5xl">
        Your intake form is almost ready
      </h1>
      <p className="max-w-prose text-lg text-ink/80">
        Good news — your Rogue Raise has been approved. The intake form where
        you&rsquo;ll shape the details of your build is opening soon.
      </p>
      <p className="max-w-prose text-ink/80">
        The personal link in your email will keep working. Hold onto that email
        and come back shortly — there&rsquo;s nothing you need to do right now.
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
