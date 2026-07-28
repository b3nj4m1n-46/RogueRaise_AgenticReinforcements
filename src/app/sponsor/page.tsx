import type { Metadata } from "next";

import { getSpamGuard } from "@/lib/rogue-raise/integrations/spam";

import { SponsorForm } from "./sponsor-form";

export const metadata: Metadata = {
  title: "Sponsor a Rogue Raise",
  description:
    "Tell White Rabbit about your organization and the problem you'd like a Rogue Raise to help solve.",
};

// The signed spam challenge is minted per request, so this page must not be
// statically cached (a stale challenge would fail the min-elapsed check).
export const dynamic = "force-dynamic";

export default function SponsorSignUpPage() {
  // Mint the honeypot + signed-timestamp challenge server-side; the form echoes
  // `renderedAt`/`sig` back as hidden inputs for `getSpamGuard().verify(...)`.
  const challenge = getSpamGuard().issueChallenge();

  return (
    <main className="mx-auto flex min-h-full max-w-2xl flex-col gap-8 px-6 py-16 sm:py-24">
      <header className="flex flex-col gap-4">
        <p className="eyebrow font-mono text-xs uppercase tracking-widest text-wr-olive-green">
          White Rabbit · Ashland, OR
        </p>
        <h1 className="font-serif text-4xl font-semibold text-ink sm:text-5xl">
          Sponsor a Rogue Raise
        </h1>
        <p className="max-w-prose text-lg text-ink/80">
          Rogue Raise is a community build event modeled on a barn raise. Tell us
          about your organization and the problem you&rsquo;re facing, and
          we&rsquo;ll review your interest and reach out about standing up a Rogue
          Raise for you.
        </p>
        <p className="max-w-prose text-sm text-ink/60">
          Fields marked <span className="font-medium text-ink">(required)</span>{" "}
          must be filled in. This form takes about five minutes.
        </p>
      </header>

      <SponsorForm
        challengeTs={challenge.renderedAt}
        challengeSig={challenge.sig}
      />
    </main>
  );
}
