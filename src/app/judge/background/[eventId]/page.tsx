import type { Metadata } from "next";
import Link from "next/link";

import { judgeAccessMessage, redeemJudgeToken } from "@/lib/rogue-raise/judges/access";

import { JudgeForm } from "./judge-form";

/**
 * The judge background form (PRD §5.3.4), opened by the magic link in the
 * invitation email.
 *
 * Same token-in-URL posture as the sponsor intake, and the same mitigations:
 * `referrer: no-referrer`, `robots: noindex`, the token never logged or echoed,
 * and every write re-verifying it server-side.
 */
export const metadata: Metadata = {
  title: "Judging a Rogue Raise",
  description: "Tell us how to introduce you, and ask anything about the criteria.",
  referrer: "no-referrer",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function JudgeBackgroundPage({
  params,
  searchParams,
}: {
  params: Promise<{ eventId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { eventId } = await params;
  const query = await searchParams;
  const token = typeof query.token === "string" ? query.token : "";

  const access = await redeemJudgeToken({ rawToken: token, eventId });
  if (!access.ok) {
    return (
      <main className="mx-auto flex min-h-full max-w-2xl flex-col justify-center gap-6 px-6 py-24">
        <p className="eyebrow font-mono text-xs uppercase tracking-widest text-wr-olive-green">
          White Rabbit · Ashland, OR
        </p>
        <h1 className="font-serif text-4xl font-semibold text-ink sm:text-5xl">
          We couldn&rsquo;t open your judge form
        </h1>
        <p className="max-w-prose text-lg text-ink/80">
          {judgeAccessMessage(access.reason)}
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

  const { judge, event } = access.access;

  return (
    <main className="mx-auto flex min-h-full max-w-2xl flex-col gap-8 px-6 py-16 sm:py-20">
      <header className="flex flex-col gap-4">
        <p className="eyebrow font-mono text-xs uppercase tracking-widest text-wr-olive-green">
          {event.organizationName}
        </p>
        <h1 className="font-serif text-4xl font-semibold text-ink sm:text-5xl">
          Thanks for judging
        </h1>
        <p className="max-w-prose text-lg text-ink/80">
          You&rsquo;re judging <strong>{event.title}</strong>. Two things: tell us
          how you&rsquo;d like to be introduced at kickoff, and ask anything you
          want about how the work will be judged.
        </p>
        <p className="max-w-prose text-sm text-ink/60">
          This takes about three minutes. You can come back to this link and
          change anything until the event.
        </p>
      </header>

      <JudgeForm
        eventId={eventId}
        token={token}
        organizationName={event.organizationName}
        initial={{
          name: judge.name,
          title: judge.title ?? "",
          bio: judge.bio ?? "",
          expertiseTags: judge.expertiseTags,
          introPreference: judge.introPreference ?? "",
          criteriaQuestions: judge.criteriaQuestions ?? "",
          complete: judge.backgroundCompletedAt !== null,
        }}
      />
    </main>
  );
}
