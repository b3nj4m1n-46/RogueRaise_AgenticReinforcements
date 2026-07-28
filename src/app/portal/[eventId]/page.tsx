import type { Metadata } from "next";
import Link from "next/link";

import {
  redeemStakeholderToken,
  stakeholderAccessMessage,
} from "@/lib/rogue-raise/portal/access";
import { isPortalOpen } from "@/lib/rogue-raise/portal/invite";
import { loadPortal } from "@/lib/rogue-raise/portal/queries";
import { stewardshipLabel } from "@/lib/rogue-raise/portal/stewardship";

import { Prose } from "./prose";
import { StewardshipControl } from "./stewardship-control";

/**
 * Stakeholder handoff portal (PRD §8) — the payoff of the whole model, and the
 * one screen designed so that **no follow-up with White Rabbit is required**.
 *
 * Everything here is scoped by the stakeholder's own token: their event, their
 * projects, their teams' contact details. There is no event picker, because
 * there is nothing else they may see.
 */
export const metadata: Metadata = {
  title: "Handoff portal",
  referrer: "no-referrer",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

function Shell({ title, children }: { title: string; children: React.ReactNode }) {
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

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div className="flex flex-col gap-1 rounded-lg border border-wr-olive-green/25 p-4">
      <span className="font-serif text-3xl font-semibold text-ink">{value}</span>
      <span className="text-sm text-ink/70">{label}</span>
    </div>
  );
}

export default async function PortalPage({
  params,
  searchParams,
}: {
  params: Promise<{ eventId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { eventId } = await params;
  const query = await searchParams;
  const token = typeof query.token === "string" ? query.token : "";

  const access = await redeemStakeholderToken({ rawToken: token, eventId });
  if (!access.ok) {
    return (
      <Shell title="We couldn&rsquo;t open your portal">
        <p className="max-w-prose text-lg text-ink/80">
          {stakeholderAccessMessage(access.reason)}
        </p>
      </Shell>
    );
  }

  const { stakeholder, event } = access.access;

  if (!isPortalOpen(event.status)) {
    return (
      <Shell title="Your portal isn&rsquo;t ready yet">
        <p className="max-w-prose text-lg text-ink/80">
          {`We're still finishing up ${event.title}. You'll get an email the moment everything is in here — you don't need to check back.`}
        </p>
      </Shell>
    );
  }

  const portal = await loadPortal(eventId);
  const { stats } = portal;

  return (
    <main className="mx-auto flex min-h-full max-w-4xl flex-col gap-12 px-6 py-16">
      <header className="flex flex-col gap-4">
        <p className="eyebrow font-mono text-xs uppercase tracking-widest text-wr-olive-green">
          {event.organizationName}
        </p>
        <h1 className="font-serif text-4xl font-semibold text-ink sm:text-5xl">
          What got built for you
        </h1>
        <p className="max-w-prose text-lg text-ink/80">
          {`${stakeholder.name.split(" ")[0]}, this is everything from ${event.title}: the code, the people who wrote it, and what the judges thought. It's yours — you don't need to come back to us for any of it.`}
        </p>
      </header>

      {/* --- Dashboard (§8.1) ------------------------------------------- */}
      <section aria-labelledby="stats" className="flex flex-col gap-4">
        <h2 id="stats" className="sr-only">
          Summary
        </h2>
        <div className="grid gap-3 sm:grid-cols-3">
          <Stat
            value={String(stats.submissionCount)}
            label={`project${stats.submissionCount === 1 ? "" : "s"} submitted`}
          />
          <Stat
            value={
              stats.totalLinesOfCode === null
                ? "—"
                : stats.totalLinesOfCode.toLocaleString("en-US")
            }
            label="lines of code"
          />
          <Stat
            value={String(stats.categories.length)}
            label={`kind${stats.categories.length === 1 ? "" : "s"} of tool built`}
          />
        </div>

        {stats.totalLinesOfCode !== null ? (
          <p className="max-w-prose text-sm text-ink/60">
            {stats.countedRepos < stats.submissionCount
              ? `Counted across ${stats.countedRepos} of ${stats.submissionCount} repositories — the others are private or GitHub hadn't finished computing their statistics. `
              : ""}
            Line counts come from GitHub&rsquo;s own history and include
            everything committed, so they describe scale rather than effort.
          </p>
        ) : null}

        {stats.categories.length > 0 ? (
          <ul className="flex flex-wrap gap-2">
            {stats.categories.map((category) => (
              <li
                key={category.label}
                className="rounded-full border border-wr-olive-green/40 px-3 py-1 text-sm text-ink"
              >
                {category.label}
                <span className="ml-2 font-mono text-xs text-ink/60">
                  ×{category.count}
                </span>
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      {portal.summaryDocument ? (
        <section aria-labelledby="overview" className="flex flex-col gap-3">
          <h2
            id="overview"
            className="font-serif text-2xl font-semibold text-wr-olive-green"
          >
            The weekend in short
          </h2>
          <Prose source={portal.summaryDocument} />
        </section>
      ) : null}

      {portal.awards.length > 0 ? (
        <section aria-labelledby="awards" className="flex flex-col gap-3">
          <h2
            id="awards"
            className="font-serif text-2xl font-semibold text-wr-olive-green"
          >
            Winners
          </h2>
          <ul className="flex flex-col gap-2">
            {portal.awards.map((award) => (
              <li
                key={award.label}
                className="flex flex-wrap items-baseline justify-between gap-2 rounded-lg border border-wr-olive-green/25 px-4 py-3"
              >
                <span className="font-medium text-ink">{award.label}</span>
                <span className="font-serif text-lg text-ink">
                  {award.teamName ?? "—"}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {/* --- Submission cards (§8.2, §8.3) ------------------------------- */}
      <section aria-labelledby="projects" className="flex flex-col gap-4">
        <h2
          id="projects"
          className="font-serif text-2xl font-semibold text-wr-olive-green"
        >
          The projects
        </h2>

        {portal.submissions.length === 0 ? (
          <p className="text-ink/70">
            Nothing was submitted for this event. If that&rsquo;s a surprise,
            reply to our email and we&rsquo;ll look into it.
          </p>
        ) : (
          <ul className="flex flex-col gap-6">
            {portal.submissions.map((submission) => (
              <li
                key={submission.id}
                className="flex flex-col gap-5 rounded-lg border border-wr-olive-green/25 p-5"
              >
                <div className="flex flex-col gap-2">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <h3 className="font-serif text-2xl font-semibold text-ink">
                      {submission.teamName}
                    </h3>
                    <span className="rounded-full border border-wr-olive-green/40 px-3 py-0.5 font-mono text-xs uppercase tracking-wide text-ink/70">
                      {stewardshipLabel(submission.stewardship)}
                    </span>
                  </div>
                  {submission.awards.length > 0 ? (
                    <p className="text-sm font-medium text-wr-olive-green">
                      {submission.awards.join(" · ")}
                    </p>
                  ) : null}
                  {submission.category ? (
                    <p className="font-medium text-ink/80">{submission.category}</p>
                  ) : null}
                  <p className="whitespace-pre-wrap text-ink/85">
                    {submission.categorySummary ?? submission.projectSummary}
                  </p>
                  {submission.categorySummary ? (
                    <details className="text-sm">
                      <summary className="cursor-pointer text-ink/70 underline-offset-4 hover:underline">
                        What the team wrote themselves
                      </summary>
                      <p className="mt-2 whitespace-pre-wrap text-ink/80">
                        {submission.projectSummary}
                      </p>
                    </details>
                  ) : null}
                  <p className="font-mono text-xs text-ink/60">
                    {submission.linesOfCode === null
                      ? "Lines not counted"
                      : `${submission.linesOfCode.toLocaleString("en-US")} lines`}
                    {submission.averageScore !== null
                      ? ` · judges' average ${submission.averageScore.toFixed(2)} of 5`
                      : ""}
                  </p>
                </div>

                <div className="flex flex-wrap gap-3">
                  <a
                    href={submission.repoUrl}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="inline-flex min-h-11 items-center rounded-md border border-wr-olive-green px-4 py-2 text-sm font-medium text-ink underline-offset-4 hover:underline"
                  >
                    View the code
                  </a>
                  {submission.downloadUrl ? (
                    <a
                      href={submission.downloadUrl}
                      className="inline-flex min-h-11 items-center rounded-md border border-wr-olive-green px-4 py-2 text-sm font-medium text-ink underline-offset-4 hover:underline"
                    >
                      Download it (.zip)
                    </a>
                  ) : null}
                  {submission.pitchMaterialsUrl ? (
                    <a
                      href={submission.pitchMaterialsUrl}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="inline-flex min-h-11 items-center rounded-md border border-wr-olive-green px-4 py-2 text-sm font-medium text-ink underline-offset-4 hover:underline"
                    >
                      Slides / demo
                    </a>
                  ) : null}
                </div>

                {submission.members.length > 0 ? (
                  <div className="flex flex-col gap-2">
                    <h4 className="font-medium text-ink">
                      Who built it &mdash; reach them directly
                    </h4>
                    <ul className="flex flex-col gap-1 text-sm">
                      {submission.members.map((member) => (
                        <li key={member.email} className="text-ink/85">
                          {member.name} &middot;{" "}
                          <a
                            href={`mailto:${member.email}`}
                            className="text-ink underline underline-offset-4"
                          >
                            {member.email}
                          </a>
                          {member.githubUsername ? (
                            <>
                              {" "}
                              &middot;{" "}
                              <a
                                href={`https://github.com/${member.githubUsername}`}
                                target="_blank"
                                rel="noreferrer noopener"
                                className="font-mono text-ink/70 underline underline-offset-4"
                              >
                                @{member.githubUsername}
                              </a>
                            </>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}

                {submission.evaluations.length > 0 ? (
                  <details className="rounded-md border border-wr-olive-green/20 p-3">
                    <summary className="cursor-pointer font-medium text-ink">
                      What the judges said ({submission.evaluations.length})
                    </summary>
                    <ul className="mt-3 flex flex-col gap-3">
                      {submission.evaluations.map((evaluation) => (
                        <li key={evaluation.judgeName} className="text-sm">
                          <p className="font-medium text-ink">
                            {evaluation.judgeName}
                            {evaluation.finalScore !== null ? (
                              <span className="ml-2 font-mono text-ink/70">
                                {evaluation.finalScore.toFixed(2)} of 5
                              </span>
                            ) : null}
                          </p>
                          <p className="text-ink/70">
                            {evaluation.perCriterion
                              .map(
                                (c) => `${c.label} ${c.score === null ? "—" : c.score}`,
                              )
                              .join(" · ")}
                          </p>
                          {evaluation.notes ? (
                            <p className="mt-1 whitespace-pre-wrap text-ink/85">
                              {evaluation.notes}
                            </p>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  </details>
                ) : null}

                <StewardshipControl
                  eventId={eventId}
                  token={token}
                  submissionId={submission.id}
                  teamName={submission.teamName}
                  current={submission.stewardship}
                />
              </li>
            ))}
          </ul>
        )}
      </section>

      <footer className="border-t border-wr-olive-green/20 pt-6">
        <p className="max-w-prose text-ink/70">
          Keep this link &mdash; it stays open. If you need anything at all, reply
          to the email that brought you here.
        </p>
      </footer>
    </main>
  );
}
