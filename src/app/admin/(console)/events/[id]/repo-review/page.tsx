import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";

import { loadAdminEvent } from "@/lib/rogue-raise/events/queries";
import { eventStatusLabel } from "@/lib/rogue-raise/events/status";
import { canReviewRepo, loadRepoReview } from "@/lib/rogue-raise/repo/review";

import { FileCommentForm, RepoDecisions } from "./repo-review-controls";

export const metadata = { title: "Repo review · Rogue Raise" };
export const dynamic = "force-dynamic";

function formatWhen(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default async function RepoReviewPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();

  const event = await loadAdminEvent(id);
  if (!event) notFound();

  const review = await loadRepoReview(id);
  if (!review) notFound();

  return (
    <main className="mx-auto flex min-h-full max-w-4xl flex-col gap-10 px-6 py-16">
      <div className="flex flex-wrap items-center gap-4">
        <Link
          href={`/admin/events/${id}`}
          className="text-sm font-medium text-ink underline underline-offset-4"
        >
          ← {event.organizationName}
        </Link>
        <Link
          href={`/admin/events/${id}/agents`}
          className="text-sm font-medium text-ink underline underline-offset-4"
        >
          Agents &amp; drafts →
        </Link>
      </div>

      <header className="flex flex-col gap-3">
        <p className="eyebrow font-mono text-xs uppercase tracking-widest text-wr-olive-green">
          WR Admin
        </p>
        <h1 className="font-serif text-4xl font-semibold text-ink">Repo review</h1>
        <p className="max-w-prose text-ink/80">
          What participants will read. Comment on any file, then approve to
          publish or send it back to the agent.
        </p>
        <p className="text-sm text-ink/60">
          Event status: {eventStatusLabel(event.status)} ·{" "}
          {review.isPublic ? "public" : "private"} · {review.files.length} files
        </p>
        {review.repoUrl ? (
          <p className="text-sm text-ink/80">
            <a href={review.repoUrl} className="underline underline-offset-4 break-all">
              {review.repoUrl}
            </a>
            {review.pullRequestUrl ? (
              <>
                {" · "}
                <a
                  href={review.pullRequestUrl}
                  className="underline underline-offset-4 break-all"
                >
                  pull request
                </a>
              </>
            ) : null}
          </p>
        ) : (
          <p className="text-sm text-ink/70">
            No repository has been built yet — build it from the agents page first.
          </p>
        )}
        <p className="max-w-prose text-sm text-ink/60">
          PRD §5.3.2 also calls for a stakeholder-facing review view.{" "}
          <strong className="text-ink/80">That doesn&rsquo;t exist yet</strong> —
          every comment here is recorded as WR Admin.
        </p>
      </header>

      <RepoDecisions
        eventId={id}
        canApprove={event.status === "repo_review" && Boolean(review.repoUrl)}
        isPublic={review.isPublic}
      />

      {review.generalComments.length > 0 ? (
        <section aria-labelledby="general" className="flex flex-col gap-3">
          <h2
            id="general"
            className="font-serif text-2xl font-semibold text-wr-olive-green"
          >
            Overall feedback
          </h2>
          <ul className="flex flex-col gap-2 text-sm">
            {review.generalComments.map((comment) => (
              <li
                key={comment.id}
                className="border-l-2 border-wr-olive-green/30 pl-3 text-ink/90"
              >
                <p className="whitespace-pre-wrap">{comment.body}</p>
                <p className="mt-1 text-xs text-ink/60">
                  {comment.authorRole.replace(/_/g, " ")} ·{" "}
                  {formatWhen(comment.createdAt)}
                  {comment.decision ? ` · ${comment.decision.replace(/_/g, " ")}` : ""}
                </p>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section aria-labelledby="files" className="flex flex-col gap-4">
        <h2 id="files" className="font-serif text-2xl font-semibold text-wr-olive-green">
          Files
        </h2>
        {!canReviewRepo(event.status) ? (
          <p className="text-sm text-ink/60">
            This event isn&rsquo;t in repo review, so what&rsquo;s shown here is the
            tree as it would be built today.
          </p>
        ) : null}

        <ul className="flex flex-col gap-4">
          {review.files.map((file) => (
            <li
              key={file.path}
              className="flex flex-col gap-2 rounded-lg border border-wr-olive-green/25 p-4"
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h3 className="font-mono text-sm font-semibold text-ink">{file.path}</h3>
                {file.sourceAssetId ? (
                  <Link
                    href={`/admin/events/${id}/assets/${file.sourceAssetId}`}
                    className="text-sm text-ink underline underline-offset-4"
                  >
                    Edit the draft →
                  </Link>
                ) : (
                  <span className="text-xs text-ink/60">Generated by the platform</span>
                )}
              </div>

              <details>
                <summary className="cursor-pointer text-sm text-ink/70">
                  View file
                </summary>
                <div className="mt-2 overflow-x-auto rounded-md border border-input bg-background p-3">
                  <pre className="whitespace-pre-wrap font-mono text-xs text-ink">
                    {file.content}
                  </pre>
                </div>
              </details>

              {file.comments.length > 0 ? (
                <ul className="flex flex-col gap-2 text-sm">
                  {file.comments.map((comment) => (
                    <li
                      key={comment.id}
                      className="border-l-2 border-wr-olive-green/30 pl-3 text-ink/90"
                    >
                      <p className="whitespace-pre-wrap">{comment.body}</p>
                      <p className="mt-1 text-xs text-ink/60">
                        {comment.authorRole.replace(/_/g, " ")} ·{" "}
                        {formatWhen(comment.createdAt)}
                      </p>
                    </li>
                  ))}
                </ul>
              ) : null}

              <FileCommentForm eventId={id} filePath={file.path} />
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
