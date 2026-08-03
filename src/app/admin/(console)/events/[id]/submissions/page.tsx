import Link from "next/link";
import { notFound } from "next/navigation";

import { loadAdminEvent } from "@/lib/rogue-raise/events/queries";
import { listSubmissionsWithTeams } from "@/lib/rogue-raise/judging/queries";
import { isSubmissionWindowOpen } from "@/lib/rogue-raise/submissions/invite";

import { InviteButton } from "./invite-button";

export const metadata = { title: "Submissions · Rogue Raise" };

// Submissions arrive while this page is open — never cached.
export const dynamic = "force-dynamic";

function formatTime(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default async function SubmissionsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [event, submissions] = await Promise.all([
    loadAdminEvent(id),
    listSubmissionsWithTeams(id),
  ]);
  if (!event) notFound();

  const open = isSubmissionWindowOpen(event.status);

  return (
    <main className="mx-auto flex min-h-full max-w-4xl flex-col gap-8 px-6 py-16">
      <header className="flex flex-col gap-3">
        <p className="eyebrow font-mono text-xs uppercase tracking-widest text-wr-olive-green">
          WR Admin
        </p>
        <h1 className="font-serif text-4xl font-semibold text-ink">Submissions</h1>
        <p className="text-lg text-ink/80">{event.title}</p>
        <p className="flex flex-wrap gap-4 text-sm">
          <Link
            href={`/admin/events/${id}`}
            className="font-medium text-ink underline underline-offset-4"
          >
            ← Back to the event
          </Link>
          <Link
            href={`/admin/events/${id}/results`}
            className="font-medium text-ink underline underline-offset-4"
          >
            Results &amp; awards →
          </Link>
        </p>
      </header>

      <section aria-labelledby="invite" className="flex flex-col gap-3">
        <h2 id="invite" className="font-serif text-2xl font-semibold text-wr-olive-green">
          Open the submission window
        </h2>
        <p className="max-w-prose text-ink/80">
          Emails every registered builder a link to submit their team&rsquo;s
          project. Safe to press twice — anyone who already has a live link is
          skipped rather than emailed again.
        </p>
        <InviteButton
          eventId={id}
          disabledReason={
            open
              ? undefined
              : `Submissions open while the event is live — this one is "${event.status}".`
          }
        />
      </section>

      <section aria-labelledby="list" className="flex flex-col gap-3">
        <h2 id="list" className="font-serif text-2xl font-semibold text-wr-olive-green">
          {submissions.length} project{submissions.length === 1 ? "" : "s"} in
        </h2>
        {submissions.length === 0 ? (
          <p className="text-ink/70">
            Nothing submitted yet. Teams appear here the moment they submit.
          </p>
        ) : (
          <ul className="flex flex-col gap-3">
            {submissions.map((submission) => (
              <li
                key={submission.id}
                className="flex flex-col gap-2 rounded-lg border border-wr-olive-green/25 p-4"
              >
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <h3 className="font-serif text-lg font-semibold text-ink">
                    {submission.teamName}
                  </h3>
                  <span className="font-mono text-xs text-ink/60">
                    {formatTime(submission.submittedAt)}
                  </span>
                </div>
                {submission.members.length > 0 ? (
                  <p className="text-sm text-ink/60">
                    {submission.members.join(", ")}
                  </p>
                ) : null}
                <p className="whitespace-pre-wrap text-ink/85">
                  {submission.projectSummary}
                </p>
                <p className="flex flex-wrap gap-4 text-sm">
                  <a
                    href={submission.repoUrl}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="font-medium text-ink underline underline-offset-4"
                  >
                    Repository
                  </a>
                  {submission.pitchMaterialsUrl ? (
                    <a
                      href={submission.pitchMaterialsUrl}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="font-medium text-ink underline underline-offset-4"
                    >
                      Slides / demo
                    </a>
                  ) : null}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
