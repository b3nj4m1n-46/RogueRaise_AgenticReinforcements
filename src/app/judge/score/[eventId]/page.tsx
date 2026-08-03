import type { Metadata } from "next";
import Link from "next/link";

import {
  judgeAccessMessage,
  redeemJudgeToken,
} from "@/lib/rogue-raise/judges/access";
import {
  isJudgingOpen,
  loadJudgingPacket,
} from "@/lib/rogue-raise/judging/queries";
import { describeMethod } from "@/lib/rogue-raise/judging/scoring";

import { Scorecard } from "./scorecard";

/**
 * Judge scoring (PRD §7.2), opened by the magic link in the scoring email. The
 * token is scoped to one judge and one event, so a judge for Event A can never
 * reach Event B's projects.
 */
export const metadata: Metadata = {
  title: "Score the projects",
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

export default async function JudgeScoringPage({
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
      <Shell title="We couldn&rsquo;t open your scorecards">
        <p className="max-w-prose text-lg text-ink/80">
          {judgeAccessMessage(access.reason)}
        </p>
      </Shell>
    );
  }

  const { judge, event } = access.access;

  if (!isJudgingOpen(event.status)) {
    return (
      <Shell title="Scoring isn&rsquo;t open">
        <p className="max-w-prose text-lg text-ink/80">
          {event.status === "completed" || event.status === "archived"
            ? `Scoring for ${event.title} has closed. Thank you for judging.`
            : `Scoring for ${event.title} hasn't opened yet — we'll email you the moment it does.`}
        </p>
      </Shell>
    );
  }

  const packet = await loadJudgingPacket({ eventId, judgeId: judge.id });

  if (packet.criteria.length === 0) {
    return (
      <Shell title="No criteria yet">
        <p className="max-w-prose text-lg text-ink/80">
          {`The judging criteria for ${event.title} haven’t been set, so there isn’t anything to score against yet. An organizer needs to sort that out — please tell them rather than waiting.`}
        </p>
      </Shell>
    );
  }

  if (packet.submissions.length === 0) {
    return (
      <Shell title="Nothing submitted yet">
        <p className="max-w-prose text-lg text-ink/80">
          No teams have submitted their projects yet. Refresh this page once
          submissions are in.
        </p>
      </Shell>
    );
  }

  const done = packet.submissions.filter(
    (s) => s.card && !s.card.isDraft,
  ).length;

  return (
    <main className="mx-auto flex min-h-full max-w-3xl flex-col gap-8 px-6 py-12 sm:py-16">
      <header className="flex flex-col gap-3">
        <p className="eyebrow font-mono text-xs uppercase tracking-widest text-wr-olive-green">
          {event.organizationName}
        </p>
        <h1 className="font-serif text-4xl font-semibold text-ink sm:text-5xl">
          Score the projects
        </h1>
        <p className="max-w-prose text-lg text-ink/80">
          Thanks for judging, {judge.name.split(" ")[0]}.{" "}
          {packet.submissions.length} project
          {packet.submissions.length === 1 ? "" : "s"} to score.
        </p>
        <p className="max-w-prose text-sm text-ink/70">
          {describeMethod(packet.criteria)} Save a card part-finished and come
          back to it — nothing is lost. A card counts once you submit it, and
          you can change it while scoring is open.
        </p>
        <p
          role="status"
          className="font-mono text-sm text-ink/60"
          aria-live="polite"
        >
          {done} of {packet.submissions.length} submitted
        </p>
      </header>

      <div className="flex flex-col gap-6">
        {packet.submissions.map((submission, index) => (
          <Scorecard
            key={submission.id}
            eventId={eventId}
            token={token}
            submission={submission}
            criteria={packet.criteria}
            index={index}
          />
        ))}
      </div>
    </main>
  );
}
