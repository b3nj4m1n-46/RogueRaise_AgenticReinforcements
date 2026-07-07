import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Thanks — we received your application",
  description:
    "White Rabbit received your Rogue Raise sponsorship interest and will be in touch.",
};

// PRG target: the action `redirect()`s here after a successful submit. The
// redirect carries no query params, so this page stays generic (no email echo).
export default function SponsorThanksPage() {
  return (
    <main className="mx-auto flex min-h-full max-w-2xl flex-col justify-center gap-6 px-6 py-24">
      <p className="eyebrow font-mono text-xs uppercase tracking-widest text-wr-olive-green">
        White Rabbit · Ashland, OR
      </p>

      {/*
        `role="status"` + a focusable (tabindex -1) heading: on arrival, the
        success is announced and keyboard/AT focus starts at the confirmation.
      */}
      <div role="status">
        <h1
          tabIndex={-1}
          className="font-serif text-4xl font-semibold text-ink outline-none sm:text-5xl"
        >
          Thanks — we&rsquo;ve got your application
        </h1>
      </div>

      <p className="max-w-prose text-lg text-ink/80">
        White Rabbit received your Rogue Raise sponsorship interest. We&rsquo;ve
        sent an acknowledgment to the email address you provided.
      </p>

      <div className="max-w-prose text-ink/80">
        <h2 className="font-serif text-xl font-semibold text-ink">
          What happens next
        </h2>
        <ol className="mt-3 list-decimal space-y-2 pl-5">
          <li>
            Our team reviews your application and the problem you described.
          </li>
          <li>
            We reach out to your primary contact to talk through scope and fit.
          </li>
          <li>
            If it&rsquo;s a match, we begin standing up a Rogue Raise for your
            organization.
          </li>
        </ol>
      </div>

      <p className="text-sm text-ink/60">
        Didn&rsquo;t get the acknowledgment email? Check your spam folder, or
        reply to this message once we&rsquo;re in touch.
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
