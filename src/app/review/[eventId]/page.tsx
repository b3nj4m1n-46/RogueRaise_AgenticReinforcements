import type { Metadata } from "next";
import Link from "next/link";

import {
  redeemStakeholderReviewToken,
  reviewAccessMessage,
} from "@/lib/rogue-raise/stakeholders/access";
import { loadReviewableAssets } from "@/lib/rogue-raise/stakeholders/review";
import { Prose } from "@/app/portal/[eventId]/prose";

import { ReviewForm } from "./review-form";

/**
 * Stakeholder review of the drafts written about their own organization
 * (PRD §11.2, `admin_and_stakeholders`).
 *
 * This surface was owed by three earlier stories. It exists because these
 * documents describe the sponsor's problem back to them and then go to every
 * volunteer — getting them wrong in public is worse than getting them late.
 */
export const metadata: Metadata = {
  title: "Review the drafts",
  referrer: "no-referrer",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

const TYPE_LABELS: Record<string, string> = {
  research_doc: "What we understand about the problem",
  stakeholder_preferences: "What you told us you need",
  example_prd: "An example brief for the teams",
  setup_agent_instructions: "Technical setup notes",
};

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

export default async function StakeholderReviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ eventId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { eventId } = await params;
  const query = await searchParams;
  const token = typeof query.token === "string" ? query.token : "";

  const access = await redeemStakeholderReviewToken({ rawToken: token, eventId });
  if (!access.ok) {
    return (
      <Shell title="We couldn&rsquo;t open the review">
        <p className="max-w-prose text-lg text-ink/80">
          {reviewAccessMessage(access.reason)}
        </p>
      </Shell>
    );
  }

  const { stakeholder, event } = access.access;
  const assets = await loadReviewableAssets(eventId, stakeholder.name);

  if (assets.length === 0) {
    return (
      <Shell title="Nothing to review yet">
        <p className="max-w-prose text-lg text-ink/80">
          {`We haven't drafted anything for ${event.title} yet. We'll email you the moment there is something to read — you don't need to check back.`}
        </p>
      </Shell>
    );
  }

  return (
    <main className="mx-auto flex min-h-full max-w-3xl flex-col gap-10 px-6 py-16">
      <header className="flex flex-col gap-4">
        <p className="eyebrow font-mono text-xs uppercase tracking-widest text-wr-olive-green">
          {event.organizationName}
        </p>
        <h1 className="font-serif text-4xl font-semibold text-ink sm:text-5xl">
          Have we got this right?
        </h1>
        <p className="max-w-prose text-lg text-ink/80">
          {`${stakeholder.name.split(" ")[0]}, this is what we've written about your problem for ${event.title}. Every team will build from it, so anything we've misunderstood is cheapest to fix now.`}
        </p>
        <p className="max-w-prose text-ink/70">
          Read what you have time for. A comment on one document is more useful
          than silence on all four, and nothing is held up by you taking your
          time.
        </p>
      </header>

      <div className="flex flex-col gap-10">
        {assets.map((asset) => (
          <section
            key={asset.id}
            aria-labelledby={`asset-${asset.id}`}
            className="flex flex-col gap-5 rounded-lg border border-wr-olive-green/25 p-5"
          >
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2
                id={`asset-${asset.id}`}
                className="font-serif text-2xl font-semibold text-ink"
              >
                {TYPE_LABELS[asset.type] ?? asset.title ?? asset.type}
              </h2>
              {asset.ownDecision ? (
                <span className="rounded-full border border-wr-olive-green bg-wr-olive-green/10 px-3 py-0.5 font-mono text-xs uppercase tracking-wide text-ink">
                  {asset.ownDecision === "approve"
                    ? "You said this looks right"
                    : "You asked for changes"}
                </span>
              ) : null}
            </div>

            {asset.body ? (
              <div className="max-h-[28rem] overflow-y-auto rounded-md border border-wr-olive-green/20 bg-muted/30 p-4">
                <Prose source={asset.body} />
              </div>
            ) : (
              <p className="text-ink/70">This draft is empty.</p>
            )}

            {asset.comments.length > 0 ? (
              <details className="rounded-md border border-wr-olive-green/20 p-3">
                <summary className="cursor-pointer font-medium text-ink">
                  What&rsquo;s been said so far ({asset.comments.length})
                </summary>
                <ul className="mt-3 flex flex-col gap-3 text-sm">
                  {asset.comments.map((comment) => (
                    <li key={comment.id}>
                      <p className="font-medium text-ink">
                        {comment.authorLabel ??
                          (comment.authorRole === "stakeholder"
                            ? "A colleague"
                            : "White Rabbit")}
                        {comment.decision ? (
                          <span className="ml-2 font-normal text-ink/70">
                            {comment.decision === "approve"
                              ? "· said it looks right"
                              : "· asked for changes"}
                          </span>
                        ) : null}
                      </p>
                      {comment.body ? (
                        <p className="whitespace-pre-wrap text-ink/85">
                          {comment.body}
                        </p>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </details>
            ) : null}

            <ReviewForm eventId={eventId} token={token} asset={asset} />
          </section>
        ))}
      </div>

      <footer className="border-t border-wr-olive-green/20 pt-6">
        <p className="max-w-prose text-ink/70">
          Keep this link &mdash; you can come back and add to it. If anything is
          easier said than typed, reply to the email that brought you here.
        </p>
      </footer>
    </main>
  );
}
