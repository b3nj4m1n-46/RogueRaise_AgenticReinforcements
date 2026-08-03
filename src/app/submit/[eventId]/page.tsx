import type { Metadata } from "next";
import Link from "next/link";

import {
  participantAccessMessage,
  redeemParticipantToken,
} from "@/lib/rogue-raise/participants/access";
import { isSubmissionWindowOpen } from "@/lib/rogue-raise/submissions/invite";

import { SubmissionForm } from "./submission-form";

/**
 * Project submission (PRD §7.1), opened by the magic link in the submission
 * email. Same token-in-URL posture as the other external forms.
 */
export const metadata: Metadata = {
  title: "Submit your project",
  referrer: "no-referrer",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

function Shell({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <main className="mx-auto flex min-h-full max-w-2xl flex-col justify-center gap-6 px-6 py-24">
      <p className="eyebrow font-mono text-xs uppercase tracking-widest text-wr-olive-green">
        White Rabbit · Ashland, OR
      </p>
      <h1 className="font-serif text-4xl font-semibold text-ink sm:text-5xl">
        {title}
      </h1>
      {children}
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

export default async function SubmitPage({
  params,
  searchParams,
}: {
  params: Promise<{ eventId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { eventId } = await params;
  const query = await searchParams;
  const token = typeof query.token === "string" ? query.token : "";

  const access = await redeemParticipantToken({ rawToken: token, eventId });
  if (!access.ok) {
    return (
      <Shell title="We couldn&rsquo;t open the submission form">
        <p className="max-w-prose text-lg text-ink/80">
          {participantAccessMessage(access.reason)}
        </p>
      </Shell>
    );
  }

  const { participant, event } = access.access;

  if (!isSubmissionWindowOpen(event.status)) {
    return (
      <Shell title="Submissions are closed">
        <p className="max-w-prose text-lg text-ink/80">
          {/*
           * One template literal rather than JSX text around an expression:
           * a multi-line JSX text node that begins right after `{...}` loses
           * its leading space at compile time, which reads as a typo.
           */}
          {`The submission window for ${event.title} isn’t open. If you think that’s wrong, find an organizer — don’t just walk away.`}
        </p>
      </Shell>
    );
  }

  return (
    <main className="mx-auto flex min-h-full max-w-2xl flex-col gap-8 px-6 py-16 sm:py-20">
      <header className="flex flex-col gap-4">
        <p className="eyebrow font-mono text-xs uppercase tracking-widest text-wr-olive-green">
          {event.organizationName}
        </p>
        <h1 className="font-serif text-4xl font-semibold text-ink sm:text-5xl">
          Submit your project
        </h1>
        <p className="max-w-prose text-lg text-ink/80">
          One submission per team. Whoever fills this in lists the rest of the
          team, so everyone gets called up and credited.
        </p>
      </header>

      <SubmissionForm
        eventId={eventId}
        token={token}
        submitter={{
          firstName: participant.firstName,
          lastName: participant.lastName,
          email: participant.email,
        }}
      />
    </main>
  );
}
